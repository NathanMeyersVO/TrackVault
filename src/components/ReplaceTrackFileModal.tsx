import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  api,
  formatDuration,
  type ReplaceTrackFilePreview,
  type Track,
} from "../lib/tauri";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { useLibrary } from "../hooks/usePlayer";
import { usePhoneUploadSettings } from "../hooks/usePhoneUploadSettings";
import { usePlayerStore } from "../store/playerStore";
import { LocalFileAudioPreview } from "./LocalFileAudioPreview";
import { RemoteUploadPanel } from "./RemoteUploadPanel";

const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "mp4", "aiff"];

interface ReplaceTrackFileModalProps {
  track: Track;
  onClose: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function tagValueMap(tags: { key: string; value: string }[]): Map<string, string> {
  return new Map(tags.map((tag) => [tag.key, tag.value]));
}

function libraryDirectory(fullPath: string): string {
  const slash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
  return slash >= 0 ? fullPath.slice(0, slash) : fullPath;
}

export function ReplaceTrackFileModal({ track, onClose }: ReplaceTrackFileModalProps) {
  const { refresh } = useLibrary();
  const { phoneUploadReady } = usePhoneUploadSettings();
  const patchTrack = usePlayerStore((state) => state.patchTrack);
  const [preview, setPreview] = useState<ReplaceTrackFilePreview | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteUploadUrl, setRemoteUploadUrl] = useState<string | null>(null);
  const [remoteWaiting, setRemoteWaiting] = useState(false);
  const [remoteStarting, setRemoteStarting] = useState(false);
  const [remoteLogPath, setRemoteLogPath] = useState<string | null>(null);
  const remoteStartInFlight = useRef(false);

  const handleClose = useCallback(() => {
    void api.stopReplaceRemoteUpload();
    onClose();
  }, [onClose]);

  const tagKeys = useMemo(() => {
    if (!preview) return [];
    const keys = new Set<string>();
    for (const tag of preview.existing.tags) keys.add(tag.key);
    for (const tag of preview.replacement.tags) keys.add(tag.key);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [preview]);

  const existingTags = useMemo(
    () => (preview ? tagValueMap(preview.existing.tags) : new Map()),
    [preview],
  );
  const replacementTags = useMemo(
    () => (preview ? tagValueMap(preview.replacement.tags) : new Map()),
    [preview],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !committing) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [committing, handleClose]);

  useEffect(() => {
    void api.getReplaceRemoteUploadLogPath().then(setRemoteLogPath).catch(() => {});
  }, []);

  const openLogsFolder = useCallback(async () => {
    try {
      const dir = await api.getReplaceRemoteUploadLogsDir();
      await openPath(dir);
    } catch {
      setError("Could not open the diagnostics log folder.");
    }
  }, []);

  const applySourcePath = useCallback(
    async (selected: string) => {
      setError(null);
      setLoading(true);
      setSourcePath(selected);
      try {
        const result = await api.previewReplaceLibraryTrackFile(track.id, selected);
        setPreview(result);
        setRemoteWaiting(false);
        setRemoteUploadUrl(null);
      } catch (err) {
        setSourcePath(null);
        setPreview(null);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [track.id],
  );

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<{ trackId: number; sourcePath: string }>(
      "replace-remote-upload-ready",
      (event) => {
        if (cancelled || event.payload.trackId !== track.id) return;
        void applySourcePath(event.payload.sourcePath);
      },
    );
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applySourcePath, track.id]);

  useEffect(() => {
    if (!remoteWaiting || preview) return;

    const interval = window.setInterval(() => {
      void api.getReplaceRemoteUploadStatus().then((status) => {
        if (status.status === "failed" && status.error) {
          setError(status.error);
          setRemoteWaiting(false);
          setRemoteUploadUrl(null);
        }
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [preview, remoteWaiting]);

  const chooseFile = useCallback(async () => {
    setError(null);
    setRemoteUploadUrl(null);
    setRemoteWaiting(false);
    const selected = await open({
      multiple: false,
      title: "Choose replacement audio file",
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (selected == null || Array.isArray(selected)) return;

    await applySourcePath(selected);
  }, [applySourcePath]);

  const startRemoteUpload = useCallback(async () => {
    if (remoteStartInFlight.current) return;
    remoteStartInFlight.current = true;
    setError(null);
    setRemoteStarting(true);
    try {
      const info = await api.startReplaceRemoteUpload(track.id);
      setRemoteUploadUrl(info.uploadUrl);
      setRemoteLogPath(info.logFilePath);
      setRemoteWaiting(true);
    } catch (err) {
      setRemoteUploadUrl(null);
      setRemoteLogPath(null);
      setRemoteWaiting(false);
      setError(String(err));
    } finally {
      remoteStartInFlight.current = false;
      setRemoteStarting(false);
    }
  }, [track.id]);

  const handleConfirm = useCallback(async () => {
    if (!sourcePath) return;
    setCommitting(true);
    setError(null);
    try {
      const updated = await api.replaceLibraryTrackFile(track.id, sourcePath);
      patchTrack(updated);
      invalidateTrackTags(track.id);
      await refresh();
      handleClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setCommitting(false);
    }
  }, [handleClose, patchTrack, refresh, sourcePath, track.id]);

  const busy = loading || committing || remoteStarting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-track-file-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="replace-track-file-title" className="text-sm font-semibold text-foreground">
            Replace file
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!preview ? (
            <div className="space-y-3 text-sm text-foreground">
              <p>
                Choose a new audio file to replace{" "}
                <span className="font-medium">{track.title}</span> in the library.
              </p>
              <p className="text-muted">
                After you select a file, TrackVault will verify it is valid audio. You will
                then see a confirmation step before the library file is changed. The file you
                choose stays where it is on your computer—only a copy in the library folder
                will be updated.
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
              {sourcePath && loading && (
                <p className="text-muted">Verifying selected file…</p>
              )}
              {phoneUploadReady ? (
                <RemoteUploadPanel
                  uploadUrl={remoteUploadUrl}
                  waiting={remoteWaiting && !loading}
                  busy={busy}
                  destinationHint={`Replacing “${track.title}”`}
                  onCopyError={setError}
                />
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 text-sm text-foreground">
              <div>
                <p className="mb-2 font-medium">What will happen</p>
                <ul className="list-disc space-y-1.5 pl-5 text-muted">
                  <li>
                    A copy of the selected file will be written into{" "}
                    <span className="break-all text-foreground">
                      {libraryDirectory(preview.library_path_before)}
                    </span>{" "}
                    (the folder that currently contains this track).
                  </li>
                  {sourcePath && (
                    <li>
                      <span className="break-all text-foreground">{sourcePath}</span> will not
                      be modified, moved, or deleted.
                    </li>
                  )}
                  <li>
                    Tag values from the current library file will be written onto the library
                    copy, replacing tags on the copied file.
                  </li>
                  <li>
                    After the copy is ready, the current library file will be removed from
                    disk (see paths below if the filename changes).
                  </li>
                  <li>
                    Library playlists and taglists that include this track keep the same entry.
                  </li>
                </ul>
              </div>

              {preview.path_collision && preview.collision_message && (
                <p className="text-sm text-red-400">{preview.collision_message}</p>
              )}

              {sourcePath && (
                <LocalFileAudioPreview
                  filePath={sourcePath}
                  durationMs={preview.replacement.duration_ms}
                  label="Listen to new file"
                  disabled={busy}
                />
              )}

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[28rem] text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-background/50">
                      <th className="px-3 py-2 font-medium text-muted"> </th>
                      <th className="px-3 py-2 font-medium text-foreground">
                        Current library file
                      </th>
                      <th className="px-3 py-2 font-medium text-foreground">
                        New library file (after copy)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 text-muted">File name</td>
                      <td className="px-3 py-2">{preview.existing.file_name}</td>
                      <td className="px-3 py-2">{preview.replacement.file_name}</td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 text-muted">Library path</td>
                      <td className="px-3 py-2 break-all">{preview.library_path_before}</td>
                      <td className="px-3 py-2 break-all">{preview.library_path_after}</td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 text-muted">Length</td>
                      <td className="px-3 py-2">{formatDuration(preview.existing.duration_ms)}</td>
                      <td className="px-3 py-2">
                        {formatDuration(preview.replacement.duration_ms)}
                      </td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 text-muted">File size</td>
                      <td className="px-3 py-2">
                        {formatFileSize(preview.existing.file_size_bytes)}
                      </td>
                      <td className="px-3 py-2">
                        {formatFileSize(preview.replacement.file_size_bytes)}
                      </td>
                    </tr>
                    {tagKeys.map((key) => (
                      <tr key={key} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2 text-muted">{key}</td>
                        <td className="px-3 py-2">{existingTags.get(key) ?? "—"}</td>
                        <td className="px-3 py-2">{replacementTags.get(key) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sourcePath && (
                <p className="text-xs text-muted">
                  Selected file (unchanged):{" "}
                  <span className="break-all text-foreground">{sourcePath}</span>
                  . Tag values in the “New library file” column are from the selected file
                  before tags are copied from the current library file.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
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
          {!preview ? (
            <>
              {phoneUploadReady ? (
                <button
                  type="button"
                  onClick={() => void startRemoteUpload()}
                  disabled={busy || remoteWaiting}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-hover disabled:opacity-40"
                >
                  {remoteStarting
                    ? "Starting tunnel…"
                    : remoteWaiting
                      ? "Waiting for phone…"
                      : "Upload from phone…"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void chooseFile()}
                disabled={busy}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Choose file…
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy || preview.path_collision}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {committing ? "Replacing…" : "OK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
