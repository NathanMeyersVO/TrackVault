import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";

import { ConfirmDialog } from "./ConfirmDialog";
import { RemoteUploadPanel } from "./RemoteUploadPanel";
import { api } from "../lib/tauri";
import {
  fileNameFromPath,
  formatCollectionConflictMessage,
  formatLibraryConflictMessage,
  formatUploadResult,
} from "../lib/uploadFeedback";
import { useLibrary } from "../hooks/usePlayer";
import { usePlayerStore } from "../store/playerStore";

export type RemoteImportMode = "library" | "collection";

interface RemoteImportFromPhoneModalProps {
  mode: RemoteImportMode;
  collectionId?: number;
  collectionName?: string | null;
  onClose: () => void;
  onUploaded: (message: string) => void;
}

export function RemoteImportFromPhoneModal({
  mode,
  collectionId,
  collectionName,
  onClose,
  onUploaded,
}: RemoteImportFromPhoneModalProps) {
  const { refresh } = useLibrary();
  const setScanning = usePlayerStore((state) => state.setScanning);
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [remoteUploadUrl, setRemoteUploadUrl] = useState<string | null>(null);
  const [remoteAlternateUrls, setRemoteAlternateUrls] = useState<string[]>([]);
  const [remoteLocalhostUrl, setRemoteLocalhostUrl] = useState<string | null>(null);
  const [remoteWaiting, setRemoteWaiting] = useState(false);
  const [remoteStarting, setRemoteStarting] = useState(true);
  const [remoteLogPath, setRemoteLogPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    sourcePaths: string[];
    conflicts: string[];
  } | null>(null);
  const startInFlight = useRef(false);

  const title =
    mode === "library"
      ? "Upload to library from phone"
      : collectionName
        ? `Upload to ${collectionName} from phone`
        : "Upload to collection from phone";

  const handleClose = useCallback(() => {
    void api.stopReplaceRemoteUpload();
    onClose();
  }, [onClose]);

  const startSession = useCallback(async () => {
    if (startInFlight.current) return;
    startInFlight.current = true;
    setError(null);
    setRemoteStarting(true);
    try {
      const info =
        mode === "library"
          ? await api.startLibraryRemoteUpload()
          : await api.startCollectionRemoteUpload(collectionId!);
      setRemoteUploadUrl(info.uploadUrl);
      setRemoteAlternateUrls(info.alternateUrls);
      setRemoteLocalhostUrl(info.localhostTestUrl);
      setRemoteLogPath(info.logFilePath);
      setRemoteWaiting(true);
    } catch (err) {
      setRemoteUploadUrl(null);
      setRemoteAlternateUrls([]);
      setRemoteLocalhostUrl(null);
      setRemoteLogPath(null);
      setRemoteWaiting(false);
      setError(String(err));
    } finally {
      startInFlight.current = false;
      setRemoteStarting(false);
    }
  }, [collectionId, mode]);

  useEffect(() => {
    void startSession();
    return () => {
      void api.stopReplaceRemoteUpload();
    };
  }, [startSession]);

  useEffect(() => {
    void api.getReplaceRemoteUploadLogPath().then(setRemoteLogPath).catch(() => {});
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !importing) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleClose, importing]);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<{
      mode: string;
      collectionId: number | null;
      sourcePaths: string[];
    }>("remote-import-upload-updated", (event) => {
      if (cancelled) return;
      if (event.payload.mode !== mode) return;
      if (
        mode === "collection" &&
        collectionId != null &&
        event.payload.collectionId !== collectionId
      ) {
        return;
      }
      setSourcePaths(event.payload.sourcePaths);
      setError(null);
    });
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [collectionId, mode]);

  useEffect(() => {
    if (!remoteWaiting) return;

    const interval = window.setInterval(() => {
      void api.getReplaceRemoteUploadStatus().then((status) => {
        if (status.sourcePaths.length > 0) {
          setSourcePaths(status.sourcePaths);
        }
        if (status.status === "failed" && status.error) {
          setError(status.error);
          setRemoteWaiting(false);
        }
        if (status.status === "expired") {
          setError(status.error ?? "Upload session expired.");
          setRemoteWaiting(false);
        }
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [remoteWaiting]);

  const openLogsFolder = useCallback(async () => {
    try {
      const dir = await api.getReplaceRemoteUploadLogsDir();
      await openPath(dir);
    } catch {
      setError("Could not open the diagnostics log folder.");
    }
  }, []);

  const runImport = useCallback(
    async (paths: string[], overwrite: boolean) => {
      setImporting(true);
      setScanning(true);
      setError(null);
      try {
        const result =
          mode === "library"
            ? await api.uploadTracks(paths, overwrite)
            : await api.uploadCollectionTracks(collectionId!, paths, overwrite);
        await refresh();
        const message = formatUploadResult(result);
        if (result.errors.length > 0 && result.uploaded === 0) {
          setError(message);
        } else {
          void api.stopReplaceRemoteUpload();
          onUploaded(message);
          onClose();
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setImporting(false);
        setScanning(false);
      }
    },
    [collectionId, mode, onClose, onUploaded, refresh, setScanning],
  );

  const beginImport = useCallback(async () => {
    if (sourcePaths.length === 0) return;
    setError(null);
    try {
      const conflicts =
        mode === "library"
          ? await api.checkUploadConflicts(sourcePaths)
          : await api.checkCollectionUploadConflicts(collectionId!, sourcePaths);
      if (conflicts.length > 0) {
        setPendingImport({ sourcePaths, conflicts });
        return;
      }
      await runImport(sourcePaths, false);
    } catch (err) {
      setError(String(err));
    }
  }, [collectionId, mode, runImport, sourcePaths]);

  const busy = remoteStarting || importing;

  const uploadLabel =
    mode === "library"
      ? `Upload ${sourcePaths.length} file${sourcePaths.length === 1 ? "" : "s"} to library`
      : `Upload ${sourcePaths.length} file${sourcePaths.length === 1 ? "" : "s"} to collection`;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div
          className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remote-import-title"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id="remote-import-title" className="text-sm font-semibold text-foreground">
              {title}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-md px-2 py-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm text-foreground">
            <p className="text-muted">
              Send audio from your phone over Wi‑Fi. When you are done, tap Upload here to add
              the received files{mode === "library" ? " to your library" : " to this collection"}.
            </p>
            {remoteLogPath && (
              <p className="text-xs text-muted">
                Diagnostics log:{" "}
                <span className="break-all text-foreground">{remoteLogPath}</span>{" "}
                <button
                  type="button"
                  onClick={() => void openLogsFolder()}
                  className="text-accent hover:underline"
                >
                  Open log folder
                </button>
              </p>
            )}
            {remoteStarting && !remoteUploadUrl && (
              <p className="text-muted">Starting upload server…</p>
            )}
            <RemoteUploadPanel
              uploadUrl={remoteUploadUrl}
              alternateUrls={remoteAlternateUrls}
              localhostTestUrl={remoteLocalhostUrl}
              waiting={remoteWaiting && sourcePaths.length === 0}
              busy={busy}
              multipleFiles
              onCopyError={setError}
            />
            {sourcePaths.length > 0 && (
              <div className="rounded-md border border-border bg-background/40 p-3">
                <p className="mb-2 font-medium text-foreground">
                  Received ({sourcePaths.length})
                </p>
                <ul className="max-h-40 list-inside list-disc overflow-y-auto text-xs text-muted">
                  {sourcePaths.map((path) => (
                    <li key={path} className="break-all">
                      {fileNameFromPath(path)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-sm text-foreground hover:bg-surface-hover disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void beginImport()}
              disabled={busy || sourcePaths.length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {importing ? "Uploading…" : uploadLabel}
            </button>
          </div>
        </div>
      </div>

      {pendingImport ? (
        <ConfirmDialog
          title="Replace existing files?"
          message={
            mode === "library"
              ? formatLibraryConflictMessage(pendingImport.conflicts)
              : formatCollectionConflictMessage(pendingImport.conflicts)
          }
          confirmLabel="Overwrite"
          secondaryLabel="Keep both"
          cancelLabel="Cancel"
          destructive
          busy={importing}
          onConfirm={() => {
            const { sourcePaths: paths } = pendingImport;
            setPendingImport(null);
            void runImport(paths, true);
          }}
          onSecondary={() => {
            const { sourcePaths: paths } = pendingImport;
            setPendingImport(null);
            void runImport(paths, false);
          }}
          onCancel={() => {
            if (importing) return;
            setPendingImport(null);
          }}
        />
      ) : null}
    </>
  );
}
