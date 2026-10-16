import { useEffect, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "../ui";
import { SpinnerIcon } from "../icons";
import * as cliService from "../../services/cli";
import type { CliStatus } from "../../services/cli";

type CliState = {
  status: CliStatus | null;
  loaded: boolean;
  error: boolean;
  operating: boolean;
};

type CliAction =
  | { type: "loaded"; status: CliStatus }
  | { type: "error" }
  | { type: "operating" }
  | { type: "operated"; status: CliStatus }
  | { type: "operate_failed" };

const cliInitialState: CliState = {
  status: null,
  loaded: false,
  error: false,
  operating: false,
};

function cliReducer(state: CliState, action: CliAction): CliState {
  switch (action.type) {
    case "loaded":
      return { ...state, status: action.status, loaded: true, error: false };
    case "error":
      return { ...state, error: true };
    case "operating":
      return { ...state, operating: true };
    case "operated":
      return { ...state, status: action.status, operating: false };
    case "operate_failed":
      return { ...state, operating: false };
  }
}

function CliUsageHint() {
  return (
    <p className="text-sm text-text-muted font-mono">
      scratch file.md # open note
      <br />
      scratch . # open folder
      <br />
      scratch # launch app
    </p>
  );
}

export function ToolsSettingsSection() {
  const [cli, dispatchCli] = useReducer(cliReducer, cliInitialState);

  useEffect(() => {
    cliService
      .getCliStatus()
      .then((status) => dispatchCli({ type: "loaded", status }))
      .catch((err) => {
        console.error("Failed to get CLI status:", err);
        dispatchCli({ type: "error" });
      });
  }, []);

  const handleInstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.installCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success(
        "CLI tool installed. Open a new terminal to use `scratch`.",
      );
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to install CLI tool",
      );
    }
  };

  const handleUninstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.uninstallCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success("CLI tool uninstalled.");
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to uninstall CLI tool",
      );
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* CLI Tool (macOS only) */}
      {(cli.loaded && cli.status?.supported) || cli.error ? (
        <>
          <section className="pb-2">
            <h2 className="text-xl font-medium mb-0.5">CLI Tool</h2>
            <p className="text-sm text-text-muted mb-4">
              Open notes from the terminal with the{" "}
              <code className="font-mono text-xs bg-bg-muted px-1.5 py-0.5 rounded">
                scratch
              </code>{" "}
              command
            </p>

            {cli.error ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-sm text-red-500">
                  Failed to check CLI status. Please restart the app.
                </p>
              </div>
            ) : cli.status === null ? (
              <div className="rounded-lg border border-border p-4 flex items-center justify-center">
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin text-text-muted" />
              </div>
            ) : cli.status.installed ? (
              <>
                <div className="rounded-lg border border-border p-4 space-y-3 mb-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text font-medium">
                      Status
                    </span>
                    <span className="text-sm text-text-muted">Installed</span>
                  </div>
                  {cli.status.path && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text font-medium">
                        Path
                      </span>
                      <button
                        type="button"
                        className="text-xs font-mono text-text-muted bg-bg-muted px-2 py-0.5 rounded max-w-48 truncate cursor-pointer hover:bg-bg-hover transition-colors"
                        title="Click to copy path"
                        onClick={async () => {
                          try {
                            await invoke("copy_to_clipboard", { text: cli.status!.path! });
                            toast.success("Path copied to clipboard");
                          } catch {
                            toast.error("Failed to copy path");
                          }
                        }}
                      >
                        {cli.status.path}
                      </button>
                    </div>
                  )}
                  <div className="pt-3 border-t border-border border-dashed">
                    <CliUsageHint />
                  </div>
                </div>
                <Button
                  onClick={handleUninstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Uninstalling...
                    </>
                  ) : (
                    "Uninstall CLI Tool"
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border bg-bg-secondary mb-2.5">
                  <CliUsageHint />
                </div>
                <Button
                  onClick={handleInstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    "Install CLI Tool"
                  )}
                </Button>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
