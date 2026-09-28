// PDF export: render a note in a dedicated hidden webview, print it to a PDF
// file via WebView2's native PrintToPdf, then post-process the PDF to add a
// heading outline (bookmarks) built from the tagged structure tree.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PdfExportOptions {
    pub paper: String,       // "a4" | "letter"
    pub orientation: String, // "portrait" | "landscape"
    pub margins: String,     // "narrow" | "normal" | "wide"
    pub include_frontmatter: bool,
    pub page_numbers: bool,
    /// Editor font size in px for this export; None = use the saved setting
    pub font_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfBookmark {
    pub level: u32, // 1..=6 (h1..h6)
    pub text: String,
}

#[tauri::command]
pub async fn export_note_pdf(
    app: AppHandle,
    file_path: String,
    output_path: String,
    title: String,
    options: PdfExportOptions,
    headings: Vec<PdfBookmark>,
) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&app, &file_path, &output_path, &title, &options, &headings);
        return Err("PDF export is currently only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        export_windows(app, file_path, output_path, title, options, headings).await
    }
}

#[cfg(target_os = "windows")]
async fn export_windows(
    app: AppHandle,
    file_path: String,
    output_path: String,
    title: String,
    options: PdfExportOptions,
    headings: Vec<PdfBookmark>,
) -> Result<String, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    (
        file_path.as_str(),
        output_path.as_str(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
    )
        .hash(&mut hasher);
    let label = format!("pdf-{:x}", hasher.finish());

    if app.get_webview_window(&label).is_some() {
        return Err("A PDF export is already in progress".to_string());
    }

    let encoded_path = urlencoding::encode(&file_path);
    let fm = if options.include_frontmatter { 1 } else { 0 };
    let fs_part = options
        .font_size
        .filter(|fs| *fs >= 8 && *fs <= 40)
        .map(|fs| format!("&fs={}", fs))
        .unwrap_or_default();
    let url = format!(
        "pdf.html?mode=pdf&file={}&fm={}{}",
        encoded_path, fm, fs_part
    );

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("Scratch — Exporting PDF")
        // A4 at 96 dpi so async resources (images, mermaid) size like a page
        .inner_size(794.0, 1123.0)
        .decorations(false)
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("Failed to create export window: {}", e))?;

    // Wait for the page to signal it is ready (fonts, images, mermaid settled)
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Vec<PdfBookmark>>();
    let ready_label = label.clone();
    let listener_id = app.listen_any("pdf-ready", move |event| {
        #[derive(serde::Deserialize)]
        struct ReadyPayload {
            label: String,
            headings: Vec<PdfBookmark>,
        }
        if let Ok(payload) = serde_json::from_str::<ReadyPayload>(event.payload()) {
            if payload.label == ready_label {
                ready_tx.send(payload.headings).ok();
            }
        }
    });

    let ready = tauri::async_runtime::spawn_blocking(move || {
        ready_rx.recv_timeout(std::time::Duration::from_secs(15))
    })
    .await
    .map_err(|e| e.to_string());

    let page_headings = match ready {
        Ok(Ok(h)) => h,
        Ok(Err(_)) => {
            app.unlisten(listener_id);
            let _ = window.close();
            return Err("PDF export timed out while rendering the note".to_string());
        }
        Err(e) => {
            app.unlisten(listener_id);
            let _ = window.close();
            return Err(format!("PDF export task failed: {}", e));
        }
    };
    app.unlisten(listener_id);

    // The page-measured headings always match the rendered document; fall back
    // to the caller-provided list only if the page sent nothing.
    let headings = if page_headings.is_empty() {
        headings
    } else {
        page_headings
    };

    // Start PrintToPdf on the main thread; the completion handler reports back
    // through the channel while the normal event loop keeps running.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let print_out = output_path.clone();
    let print_opts = options.clone();
    let print_title = title.clone();
    let start_result = window.with_webview(move |platform| {
        let inner_tx = tx.clone();
        let result = unsafe {
            start_print_to_pdf(
                &platform.controller(),
                &print_out,
                &print_opts,
                &print_title,
                inner_tx,
            )
        };
        if let Err(e) = result {
            tx.send(Err(e)).ok();
        }
    });
    if let Err(e) = start_result {
        let _ = window.close();
        return Err(format!("Failed to access platform webview: {}", e));
    }

    let print_result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(120))
    })
    .await
    .map_err(|e| e.to_string());

    match print_result {
        Ok(Ok(Ok(()))) => {
            let _ = window.close();
        }
        Ok(Ok(Err(e))) => {
            let _ = window.close();
            return Err(format!("PDF printing failed: {}", e));
        }
        Ok(Err(_)) => {
            let _ = window.close();
            return Err("PDF printing timed out".to_string());
        }
        Err(e) => {
            let _ = window.close();
            return Err(format!("PDF printing task failed: {}", e));
        }
    }

    // Bookmarks: build the outline from the /Dests table the print engine
    // wrote for the invisible per-heading anchors. Never fail the export over
    // this — the PDF is already valid on disk.
    if headings.is_empty() {
        return Ok("exported".to_string());
    }
    match add_pdf_outline(&output_path, &headings) {
        Ok(()) => Ok("exported".to_string()),
        Err(e) => {
            eprintln!("PDF outline generation skipped: {}", e);
            Ok(format!("exported-without-bookmarks: {}", e))
        }
    }
}

/// Kick off PrintToPdf with settings built from the export options. Returns
/// immediately; the completion handler delivers the outcome on `tx`.
#[cfg(target_os = "windows")]
unsafe fn start_print_to_pdf(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    out_path: &str,
    options: &PdfExportOptions,
    title: &str,
    tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::{Interface, PCWSTR};

    let webview = controller
        .CoreWebView2()
        .map_err(|e| format!("Failed to get CoreWebView2: {}", e))?;
    let webview16: ICoreWebView2_16 = webview
        .cast()
        .map_err(|_| "WebView2 Runtime is too old for direct PDF export".to_string())?;

    // PrintSettings can only be created on the environment; the controller does
    // not expose it, so connect a second environment handle to the same browser
    // process. If that fails, fall back to engine defaults (no backgrounds).
    let settings = match create_print_settings(options, title) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("PDF print settings unavailable, using defaults: {}", e);
            None
        }
    };

    let path_h: windows::core::HSTRING = windows::core::HSTRING::from(out_path);
    let handler = webview2_com::PrintToPdfCompletedHandler::create(Box::new(
        move |error_code, is_successful| {
            let result = if error_code.is_ok() && is_successful {
                Ok(())
            } else {
                Err(format!(
                    "PrintToPdf reported failure (error={:?}, success={})",
                    error_code, is_successful
                ))
            };
            tx.send(result).ok();
            Ok(())
        },
    ));

    match &settings {
        Some(s) => webview16
            .PrintToPdf(PCWSTR(path_h.as_ptr()), s, &handler)
            .map_err(|e| format!("PrintToPdf call failed: {}", e))?,
        None => webview16
            .PrintToPdf(PCWSTR(path_h.as_ptr()), None, &handler)
            .map_err(|e| format!("PrintToPdf call failed: {}", e))?,
    }
    Ok(())
}

/// Create ICoreWebView2PrintSettings from the export options, using a second
/// environment handle connected to the same browser process. Runs on the main
/// thread; pumps messages while waiting for the environment callback.
#[cfg(target_os = "windows")]
unsafe fn create_print_settings(
    options: &PdfExportOptions,
    title: &str,
) -> Result<Option<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2PrintSettings>, String>
{
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{wait_with_pump, CreateCoreWebView2EnvironmentCompletedHandler};
    use windows::core::{Interface, PCWSTR};

    let (tx, rx) = std::sync::mpsc::channel();
    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
        move |error_code, environment| {
            let result = match (error_code, environment) {
                (Ok(()), Some(env)) => Ok(env),
                (Ok(()), None) => Err(windows::core::Error::from(windows::core::HRESULT(
                    -2147467259, // E_FAIL
                ))),
                (Err(e), _) => Err(e),
            };
            tx.send(result).ok();
            Ok(())
        },
    ));
    CreateCoreWebView2EnvironmentWithOptions(
        PCWSTR::null(),
        PCWSTR::null(),
        None::<&ICoreWebView2EnvironmentOptions>,
        &handler,
    )
    .map_err(|e| format!("Environment creation failed: {}", e))?;

    let environment = wait_with_pump(rx)
        .map_err(|e| format!("Environment callback failed: {}", e))?
        .map_err(|e| format!("Environment creation failed: {}", e))?;
    let environment6: ICoreWebView2Environment6 = environment
        .cast()
        .map_err(|_| "WebView2 Runtime too old for print settings".to_string())?;
    let settings = environment6
        .CreatePrintSettings()
        .map_err(|e| format!("CreatePrintSettings failed: {}", e))?;

    let (mut width, mut height): (f64, f64) = match options.paper.as_str() {
        "letter" => (8.5, 11.0),
        _ => (8.27, 11.69), // A4
    };
    if options.orientation == "landscape" {
        std::mem::swap(&mut width, &mut height);
    }
    let margin = match options.margins.as_str() {
        "narrow" => 0.5,
        "wide" => 1.0,
        _ => 0.75,
    };

    settings
        .SetPageWidth(width)
        .map_err(|e| format!("SetPageWidth failed: {}", e))?;
    settings
        .SetPageHeight(height)
        .map_err(|e| format!("SetPageHeight failed: {}", e))?;
    for set_margin in [
        settings.SetMarginTop(margin),
        settings.SetMarginBottom(margin),
        settings.SetMarginLeft(margin),
        settings.SetMarginRight(margin),
    ] {
        set_margin.map_err(|e| format!("SetMargin failed: {}", e))?;
    }
    settings
        .SetShouldPrintBackgrounds(true.into())
        .map_err(|e| format!("SetShouldPrintBackgrounds failed: {}", e))?;
    settings
        .SetShouldPrintHeaderAndFooter(options.page_numbers.into())
        .map_err(|e| format!("SetShouldPrintHeaderAndFooter failed: {}", e))?;
    if options.page_numbers {
        let header: windows::core::HSTRING = windows::core::HSTRING::from(title);
        settings
            .SetHeaderTitle(&header)
            .map_err(|e| format!("SetHeaderTitle failed: {}", e))?;
        settings
            .SetFooterUri(PCWSTR::null())
            .map_err(|e| format!("SetFooterUri failed: {}", e))?;
    }
    Ok(Some(settings))
}

/// Build a hierarchical PDF outline (bookmarks). The export page wraps every
/// heading in an invisible `<a href="#bmk-N">`, so Chromium's print pipeline
/// writes a named destination per heading into the catalog's /Dests table —
/// each mapping to the exact page and Y position of that heading. We zip those
/// destinations with the heading texts (same bmk-N order) into /Outlines.
pub fn add_pdf_outline(path: &str, headings: &[PdfBookmark]) -> Result<(), String> {
    use lopdf::{dictionary, Object};

    let mut doc = lopdf::Document::load(path).map_err(|e| format!("load: {}", e))?;

    let cat_id = doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| "PDF has no catalog".to_string())?;

    let dests_id = get_dict_ref(&doc, cat_id, b"Dests")
        .ok_or("PDF has no /Dests table (headings missing anchors)")?;
    let dests: std::collections::HashMap<String, lopdf::Object> = doc
        .get_object(dests_id)
        .ok()
        .and_then(|o| o.as_dict().ok().cloned())
        .map(|d| {
            d.iter()
                .map(|(k, v)| (String::from_utf8_lossy(k).to_string(), v.clone()))
                .collect()
        })
        .unwrap_or_default();

    // Resolve bmk-N -> destination for as many headings as possible
    let mut items: Vec<(u32, &str, lopdf::Object)> = Vec::new();
    for (i, h) in headings.iter().enumerate() {
        if let Some(dest) = dests.get(&format!("bmk-{}", i)) {
            items.push((h.level.clamp(1, 6), h.text.as_str(), dest.clone()));
        }
    }
    if items.is_empty() {
        return Err("no heading destinations (/Dests bmk-*) found".to_string());
    }

    let outlines_id = doc.add_object(dictionary! {
        "Type" => Object::Name(b"Outlines".to_vec()),
    });

    let mut ancestors: Vec<(u32, lopdf::ObjectId)> = Vec::new();
    let mut first: Option<lopdf::ObjectId> = None;
    let mut last: Option<lopdf::ObjectId> = None;
    let mut total: i64 = 0;

    for (level, title, dest) in &items {
        while ancestors.last().is_some_and(|&(l, _)| l >= *level) {
            ancestors.pop();
        }
        let parent_id = ancestors.last().map(|&(_, id)| id).unwrap_or(outlines_id);

        let prev_id: Option<lopdf::ObjectId> = doc
            .get_object(parent_id)
            .ok()
            .and_then(|o| o.as_dict().ok().cloned())
            .and_then(|d| d.get(b"Last").ok().cloned())
            .and_then(|o| o.as_reference().ok());

        let mut node_dict = dictionary! {
            "Title" => utf16_string(title),
            "Parent" => Object::Reference(parent_id),
            "Dest" => dest.clone(),
        };
        if let Some(p) = prev_id {
            node_dict.set("Prev", Object::Reference(p));
        }
        let node_id = doc.add_object(node_dict);

        if let Some(p) = prev_id {
            if let Ok(obj) = doc.get_object_mut(p) {
                if let Ok(d) = obj.as_dict_mut() {
                    d.set("Next", Object::Reference(node_id));
                }
            }
        }
        if let Ok(obj) = doc.get_object_mut(parent_id) {
            if let Ok(d) = obj.as_dict_mut() {
                if prev_id.is_none() {
                    d.set("First", Object::Reference(node_id));
                }
                d.set("Last", Object::Reference(node_id));
                let child_count = d.get(b"Count").and_then(|o| o.as_i64()).unwrap_or(0);
                d.set("Count", Object::Integer(child_count + 1));
            }
        }

        ancestors.push((*level, node_id));
        if first.is_none() {
            first = Some(node_id);
        }
        last = Some(node_id);
        total += 1;
    }

    if total == 0 {
        return Err("no outline items could be created".to_string());
    }

    if let Ok(root) = doc.get_object_mut(outlines_id) {
        if let Ok(d) = root.as_dict_mut() {
            if let Some(f) = first {
                d.set("First", Object::Reference(f));
            }
            if let Some(l) = last {
                d.set("Last", Object::Reference(l));
            }
            d.set("Count", Object::Integer(total));
        }
    }

    if let Ok(cat) = doc.get_object_mut(cat_id) {
        if let Ok(d) = cat.as_dict_mut() {
            d.set("Outlines", Object::Reference(outlines_id));
            // Open the PDF with the bookmarks panel visible
            d.set("PageMode", Object::Name(b"UseOutlines".to_vec()));
        }
    }

    doc.save(path).map_err(|e| format!("save: {}", e))?;
    Ok(())
}

fn utf16_string(s: &str) -> lopdf::Object {
    let mut bytes: Vec<u8> = vec![0xFE, 0xFF];
    for unit in s.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
    }
    lopdf::Object::String(bytes, lopdf::StringFormat::Hexadecimal)
}

fn get_dict_ref(doc: &lopdf::Document, id: lopdf::ObjectId, key: &[u8]) -> Option<lopdf::ObjectId> {
    let obj = doc.get_object(id).ok()?;
    let dict = obj.as_dict().ok()?;
    let v = dict.get(key).ok()?;
    v.as_reference().ok()
}
