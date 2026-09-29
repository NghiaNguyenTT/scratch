import { useCallback, useEffect, useRef, useState } from "react";
import { Graph, LinkStyle } from "@cosmos.gl/graph";
import { LabelRenderer } from "@cosmograph/vis-labels";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useNotes } from "../../context/NotesContext";
import { useTheme } from "../../context/ThemeContext";
import { getLinkGraph, type LinkGraph } from "../../services/graph";
import { ArrowLeftIcon, MinusIcon, PlusIcon } from "../icons";
import { IconButton } from "../ui";
import { isWindows } from "../../lib/platform";

type GNode = LinkGraph["nodes"][number];

// Labels are screen-space HTML (never scale with zoom), so they are capped in
// characters like the SVG version was.
const MAX_LABEL_CHARS = 28;

// Reading a CSS custom property can yield any CSS color format (oklch, hex,
// rgb…). Painting it on a 1x1 canvas and sampling the pixel converts it to
// RGBA components no matter the format.
const colorCanvas = document.createElement("canvas");
colorCanvas.width = 1;
colorCanvas.height = 1;
const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true })!;

function cssColorToRgba(
  value: string,
  fallback: string,
  alpha = 1,
): [number, number, number, number] {
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = value.trim() || fallback;
  colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255, (a / 255) * alpha];
}

function readCssColor(name: string, fallback: string, alpha = 1) {
  return cssColorToRgba(
    getComputedStyle(document.documentElement).getPropertyValue(name),
    fallback,
    alpha,
  );
}

function sizeFor(node: GNode, degree: Map<string, number>) {
  if (node.unresolved) return 2.5;
  return Math.min(2.5 + Math.sqrt(degree.get(node.id) ?? 0) * 1.3, 9);
}

function truncateTitle(title: string) {
  return title.length > MAX_LABEL_CHARS ? `${title.slice(0, MAX_LABEL_CHARS)}…` : title;
}

export function GraphView({ onBack }: { onBack: () => void }) {
  const { selectNote, selectedNoteId } = useNotes();
  const { resolvedTheme } = useTheme();

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const labelsHostRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const labelsRef = useRef<LabelRenderer | null>(null);

  // Mutable mirrors for stable callbacks (the Graph instance is created once
  // and updated in place, so its callbacks must read state through refs)
  const nodesRef = useRef<GNode[]>([]);
  const rawDataRef = useRef<LinkGraph | null>(null);
  const selectedNoteIdRef = useRef<string | null>(selectedNoteId);
  selectedNoteIdRef.current = selectedNoteId;
  const hideOrphansRef = useRef(false);
  const labelsDirtyRef = useRef(false);
  // Last known simulation-space position per node id, refreshed from the
  // live instance before every data rebuild
  const prevPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Link indices touching each node id, for hover highlighting. The library's
  // getConnectedLinkIndices only returns links whose BOTH endpoints are in the
  // given set — for a single hovered node that is always empty.
  const linksByNodeIdRef = useRef<Map<string, number[]>>(new Map());
  // One extra fit once the entrance simulation has settled — fitting too
  // early captures the wide scatter, then gravity contracts the cluster
  const fitOnSettleRef = useRef(true);

  const [counts, setCounts] = useState<{ notes: number; links: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideOrphans, setHideOrphans] = useState(false);

  // ---- interaction callbacks (defined before applyData uses them) ----

  const handlePointClick = useCallback(
    (index?: number) => {
      if (index == null) return;
      const node = nodesRef.current[index];
      if (!node) return;
      if (node.unresolved) {
        toast.info(`Note "${node.title}" does not exist yet`);
        return;
      }
      void selectNote(node.id).then(() => onBack());
    },
    [selectNote, onBack],
  );

  const handleHover = useCallback((index: number | null) => {
    const g = graphRef.current;
    if (!g || !g.isReady) return;
    if (index == null) {
      g.setConfigPartial({
        highlightedPointIndices: undefined,
        highlightedLinkIndices: undefined,
      });
      return;
    }
    // Native grey-out: everything not listed dims to the configured opacity.
    // Highlighted links = the ones touching the hovered node.
    const node = nodesRef.current[index];
    const neighbors = g.getNeighboringPointIndices(index);
    const touchingLinks = node
      ? (linksByNodeIdRef.current.get(node.id) ?? [])
      : [];
    g.setConfigPartial({
      highlightedPointIndices: [index, ...neighbors],
      highlightedLinkIndices: touchingLinks,
    });
  }, []);

  // ---- data application ----

  const applyData = useCallback((data: LinkGraph, isFirst: boolean) => {
    const degree = new Map<string, number>();
    for (const e of data.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    const nodes = hideOrphansRef.current
      ? data.nodes.filter((n) => (degree.get(n.id) ?? 0) > 0)
      : data.nodes;
    const keptIds = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));

    const n = nodes.length;
    const g = graphRef.current;

    // Snapshot live space positions by node id so rebuilds (file changes,
    // orphan toggle) keep the layout the user has arranged
    if (g && g.isReady) {
      const pos = g.getPointPositions();
      for (let i = 0; i < nodesRef.current.length; i++) {
        const node = nodesRef.current[i];
        const x = pos[i * 2];
        const y = pos[i * 2 + 1];
        if (x != null && y != null) {
          prevPositions.current.set(node.id, { x, y });
        }
      }
    }
    const indexById = new Map(nodes.map((node, i) => [node.id, i] as const));

    const accent = readCssColor("--color-accent", "#6366f1", 0.9);
    const ghost = readCssColor("--color-text-muted", "#888888", 0.5);

    const sizes = new Float32Array(n);
    const colors = new Float32Array(n * 4);
    nodes.forEach((node, i) => {
      sizes[i] = sizeFor(node, degree);
      colors.set(node.unresolved ? ghost : accent, i * 4);
    });

    const links = new Float32Array(edges.length * 2);
    // Links touching unresolved targets render dashed, echoing the old
    // dashed hollow nodes for notes that don't exist yet
    const linkStyles = new Float32Array(edges.length);
    const linksByNodeId = new Map<string, number[]>();
    edges.forEach((e, i) => {
      links[i * 2] = indexById.get(e.source) ?? 0;
      links[i * 2 + 1] = indexById.get(e.target) ?? 0;
      for (const endpoint of [e.source, e.target]) {
        const indices = linksByNodeId.get(endpoint);
        if (indices) indices.push(i);
        else linksByNodeId.set(endpoint, [i]);
      }
      const unresolved =
        nodes[indexById.get(e.source) ?? 0]?.unresolved ||
        nodes[indexById.get(e.target) ?? 0]?.unresolved;
      linkStyles[i] = unresolved ? LinkStyle.Dashed : LinkStyle.Solid;
    });
    linksByNodeIdRef.current = linksByNodeId;

    const currentIdx = selectedNoteIdRef.current
      ? indexById.get(selectedNoteIdRef.current)
      : undefined;

    if (!g && canvasHostRef.current && n > 0) {
      const instance = new Graph(canvasHostRef.current, {
        spaceSize: 4096,
        backgroundColor: readCssColor("--color-bg-secondary", "#1a1a1a"),
        enableDrag: true,
        hoveredPointCursor: "pointer",
        renderHoveredPointRing: false,
        scalePointsOnZoom: false,
        fitViewOnInit: true,
        fitViewDelay: 2500,
        fitViewPadding: 0.15,
        fitViewDuration: 500,
        linkDefaultArrows: true,
        // Arrowheads widen from the link itself (width × 2 × this scale); on
        // 1px links the default 1× triangle is ~2px and hides under the
        // target node sprite entirely. 3 ≈ 6px — visible but proportionate.
        linkArrowsSizeScale: 3,
        linkDefaultWidth: 1,
        linkOpacity: 0.4,
        linkGreyoutOpacity: 0.06,
        pointGreyoutOpacity: 0.15,
        simulationCollision: 1,
        simulationCollisionPadding: 2,
        outlinedPointIndices: currentIdx != null ? [currentIdx] : undefined,
        outlinedPointRingColor: readCssColor("--color-selection", "#3b82f6"),
        attribution: "",
        onSimulationEnd: () => {
          if (fitOnSettleRef.current) {
            fitOnSettleRef.current = false;
            graphRef.current?.fitView();
          }
        },
        onClick: (index) => handlePointClick(index),
        onPointMouseOver: (index) => handleHover(index),
        onPointMouseOut: () => handleHover(null),
        onSimulationTick: () => {
          labelsDirtyRef.current = true;
        },
        onZoom: () => {
          labelsDirtyRef.current = true;
        },
      });
      graphRef.current = instance;
      labelsRef.current = new LabelRenderer(labelsHostRef.current!, {
        pointerEvents: "none",
        fontSize: 10,
      });
    }

    const graph = graphRef.current;
    if (!graph) return;

    // Positions are mandatory: unlike d3-force, cosmos.gl does not generate
    // initial positions itself — without an explicit positions array it
    // treats the graph as empty and renders nothing.
    const positions = new Float32Array(n * 2);
    // Entrance scatter radius grows sub-linearly with the node count so big
    // vaults don't start at the space edge
    const spread = Math.min(400 + Math.sqrt(n) * 120, 1600);
    nodes.forEach((node, i) => {
      const prev = prevPositions.current.get(node.id);
      if (prev) {
        positions[i * 2] = prev.x;
        positions[i * 2 + 1] = prev.y;
      } else {
        // New node: start near the middle so it joins the cluster instead
        // of spawning at the space edge
        positions[i * 2] = 2048 + (Math.random() - 0.5) * spread;
        positions[i * 2 + 1] = 2048 + (Math.random() - 0.5) * spread;
      }
    });

    graph.setLinks(links);
    graph.setLinkStyles(linkStyles);
    graph.setPointPositions(positions);
    graph.setPointSizes(sizes);
    graph.setPointColors(colors);
    graph.setConfigPartial({
      outlinedPointIndices: currentIdx != null ? [currentIdx] : undefined,
    });

    // render() is what processes the raw inputs into a renderable graph;
    // start() refuses to run before the first render ("no-op before the
    // first render()" in cosmos.gl), so render must come first.
    graph.render();
    graph.unpause();
    graph.start(isFirst ? 1 : 0.35);
    labelsDirtyRef.current = true;
    nodesRef.current = nodes;
  }, [handlePointClick, handleHover]);

  // ---- loading ----

  const loadGraph = useCallback(async () => {
    try {
      const data = await getLinkGraph();
      rawDataRef.current = data;
      applyData(data, nodesRef.current.length === 0);
      setCounts({ notes: data.nodes.length, links: data.edges.length });
    } catch (err) {
      console.error("Failed to load link graph:", err);
      toast.error("Failed to load link graph");
    } finally {
      setLoading(false);
    }
  }, [applyData]);

  // Initial load + teardown
  useEffect(() => {
    void loadGraph();
    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
      labelsRef.current?.destroy();
      labelsRef.current = null;
    };
  }, [loadGraph]);

  // Stay live: refetch (debounced) when files change on disk while the view is open
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: number | null = null;
    let cancelled = false;
    listen("file-change", () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (!cancelled) void loadGraph();
      }, 1000);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, [loadGraph]);

  // Re-apply theme-derived colors after a light/dark switch. The provider
  // (a parent) applies the theme class after child effects run, so the
  // re-read must wait for the next paint.
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const graph = graphRef.current;
        if (!graph || !graph.isReady) return;
        const n = nodesRef.current.length;
        const accent = readCssColor("--color-accent", "#6366f1", 0.9);
        const ghost = readCssColor("--color-text-muted", "#888888", 0.5);
        const colors = new Float32Array(n * 4);
        nodesRef.current.forEach((node, i) => {
          colors.set(node.unresolved ? ghost : accent, i * 4);
        });
        graph.setPointColors(colors);
        graph.setConfigPartial({
          backgroundColor: readCssColor("--color-bg-secondary", "#1a1a1a"),
          outlinedPointRingColor: readCssColor("--color-selection", "#3b82f6"),
        });
        graph.render();
        labelsDirtyRef.current = true;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [resolvedTheme]);

  // Outline ring follows the currently open note
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph || !graph.isReady) return;
    const idx = selectedNoteId
      ? nodesRef.current.findIndex((n) => n.id === selectedNoteId)
      : -1;
    graph.setConfigPartial({
      outlinedPointIndices: idx >= 0 ? [idx] : undefined,
    });
    labelsDirtyRef.current = true;
  }, [selectedNoteId, counts]);

  // ---- label overlay (screen-space HTML, driven by sim ticks + zoom) ----

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = requestAnimationFrame(update);
      if (!labelsDirtyRef.current) return;
      labelsDirtyRef.current = false;
      const graph = graphRef.current;
      const renderer = labelsRef.current;
      if (!graph || !renderer || !graph.isReady) return;
      const nodes = nodesRef.current;
      if (nodes.length === 0) {
        renderer.setLabels([]);
        renderer.draw();
        return;
      }
      const pos = graph.getPointPositions();
      const currentId = selectedNoteIdRef.current;
      if (pos.length < nodes.length * 2) {
        // Positions not processed by the GPU yet — skip this frame
        renderer.setLabels([]);
        renderer.draw();
        return;
      }
      const labels = nodes.map((node, i) => {
        const [sx, sy] = graph.spaceToScreenPosition([pos[i * 2], pos[i * 2 + 1]]);
        const radius = graph.spaceToScreenRadius(graph.getPointRadiusByIndex(i) ?? 3);
        const isCurrent = node.id === currentId;
        return {
          id: node.id,
          text: truncateTitle(node.title),
          x: sx,
          y: sy + radius + 5,
          placement: "center" as const,
          color: `var(--color-${isCurrent ? "text" : "text-muted"})`,
          opacity: node.unresolved ? 0.5 : isCurrent ? 1 : 0.85,
          style: isCurrent ? "font-weight:700" : undefined,
        };
      });
      renderer.setLabels(labels);
      renderer.draw();
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, []);

  const zoomBy = (factor: number) => {
    const graph = graphRef.current;
    if (!graph || !graph.isReady) return;
    graph.setZoomLevel(graph.getZoomLevel() * factor, 200);
  };

  return (
    <div className="h-full flex bg-bg w-full relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-1 px-3 pt-2 pb-1 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1">
          <IconButton onClick={onBack} title="Back (Esc)">
            <ArrowLeftIcon className="w-4.5 h-4.5 stroke-[1.5]" />
          </IconButton>
          <div className="font-medium text-base">
            Graph
            {counts && (
              <span className="text-text-muted font-normal text-sm ml-2">
                {counts.notes} notes · {counts.links} links
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Canvas (cosmos.gl owns the wheel/pan/drag interaction on its canvas) */}
      <div ref={canvasHostRef} className="relative flex-1 overflow-hidden bg-bg-secondary cursor-grab active:cursor-grabbing">
        {!isWindows && <div className="absolute top-0 left-0 right-0 h-11 z-10" data-tauri-drag-region />}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted/70 text-sm">
            Building graph...
          </div>
        )}

        {!loading && counts?.notes === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
            No notes yet — create a few and link them with [[wikilinks]]
          </div>
        )}

        {/* Screen-space labels overlay */}
        <div ref={labelsHostRef} className="absolute inset-0 pointer-events-none" />

        {/* Floating controls */}
        {counts && counts.notes > 0 && (
          <div
            className="absolute bottom-4 right-4 flex flex-col gap-1 bg-bg border border-border rounded-lg shadow-lg p-1"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IconButton title="Zoom in" onClick={() => zoomBy(1.25)}>
              <PlusIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
            <IconButton title="Zoom out" onClick={() => zoomBy(0.8)}>
              <MinusIcon className="w-4.5 h-4.5 stroke-[1.5]" />
            </IconButton>
            <IconButton title="Fit graph" onClick={() => graphRef.current?.fitView()}>
              <svg
                className="w-4.5 h-4.5 stroke-[1.5]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </IconButton>
            <IconButton
              title={hideOrphans ? "Show orphan notes" : "Hide orphan notes"}
              onClick={() => {
                const next = !hideOrphans;
                hideOrphansRef.current = next;
                setHideOrphans(next);
                if (rawDataRef.current) applyData(rawDataRef.current, false);
              }}
              className={hideOrphans ? "bg-bg-emphasis" : undefined}
            >
              <svg
                className="w-4.5 h-4.5 stroke-[1.5]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="2.5" />
                <path d="M12 9.5V4" />
                <path d="M14.5 12h5.5" />
                <path d="M12 14.5V20" />
                <path d="M9.5 12H4" />
              </svg>
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
