import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  api,
  formatDuration,
  type ReplaceTrackFilePreview,
  type Track,
} from "../lib/tauri";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { useProject } from "../hooks/usePlayer";
import { usePhoneUploadSettings } from "../hooks/usePhoneUploadSettings";
import { usePlayerStore } from "../store/playerStore";
import { AudioFilesDropZone } from "./AudioFilesDropZone";
import { LocalFileAudioPreview } from "./LocalFileAudioPreview";
import { ReplaceTrackPhoneSection } from "./ReplaceTrackPhoneSection";
import { TrackDeliveryOptionSection } from "./TrackDeliveryOptionSection";
import { AUDIO_FILE_DIALOG_FILTER } from "../lib/audioExtensions";
import { getPartitionTagKey } from "../lib/applicationConfig";
import { trackDeliveryIntro } from "../lib/trackDeliveryCopy";

function replaceTagKeysForCommit(
  selected: Set<string>,
  lockedPartitionTagKey: string | null,
  existingTagKeys: string[],
): string[] {
  const keys = [...selected];
  if (
    lockedPartitionTagKey &&
    existingTagKeys.includes(lockedPartitionTagKey) &&
    !keys.includes(lockedPartitionTagKey)
  ) {
    keys.push(lockedPartitionTagKey);
  }
  return keys;
}

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

function projectDirectory(fullPath: string): string {
  const slash = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
  return slash >= 0 ? fullPath.slice(0, slash) : fullPath;
}

const REPLACE_FILE_NAME_KEY = "__fileName__";

function replaceTagSelectionState(keys: string[], selected: Set<string>) {
  if (keys.length === 0) {
    return { all: false, some: false };
  }
  let count = 0;
  for (const key of keys) {
    if (selected.has(key)) count += 1;
  }
  return {
    all: count === keys.length,
    some: count > 0 && count < keys.length,
  };
}

export function ReplaceTrackFileModal({ track, onClose }: ReplaceTrackFileModalProps) {
  const { refresh } = useProject();
  const { phoneUploadReady } = usePhoneUploadSettings();
  const patchTrack = usePlayerStore((state) => state.patchTrack);
  const activeProject = usePlayerStore((state) => state.activeProject);
  const [preview, setPreview] = useState<ReplaceTrackFilePreview | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [selectedReplaceTags, setSelectedReplaceTags] = useState<Set<string>>(() => new Set());
  const [replaceFileName, setReplaceFileName] = useState(true);
  const replaceTagsHeaderRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    void api.stopReplaceRemoteUpload();
    void api.cleanupDropStaging();
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

  const replaceableTagKeys = useMemo(() => {
    if (!preview) return [];
    return [...new Set(preview.existing.tags.map((tag) => tag.key))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [preview]);

  const lockedPartitionTagKey = useMemo(
    () => getPartitionTagKey(activeProject?.application_id),
    [activeProject?.application_id],
  );

  const toggleableReplaceTagKeys = useMemo(() => {
    if (!lockedPartitionTagKey) return replaceableTagKeys;
    return replaceableTagKeys.filter((key) => key !== lockedPartitionTagKey);
  }, [lockedPartitionTagKey, replaceableTagKeys]);

  const canReplaceFileName = useMemo(() => {
    if (!preview) return false;
    return preview.existing.file_name !== preview.replacement.file_name;
  }, [preview]);

  const replaceableItemKeys = useMemo(() => {
    const keys = [...toggleableReplaceTagKeys];
    if (canReplaceFileName) keys.unshift(REPLACE_FILE_NAME_KEY);
    return keys;
  }, [canReplaceFileName, toggleableReplaceTagKeys]);

  const selectedReplaceItems = useMemo(() => {
    const selected = new Set(selectedReplaceTags);
    if (replaceFileName && canReplaceFileName) {
      selected.add(REPLACE_FILE_NAME_KEY);
    }
    return selected;
  }, [canReplaceFileName, replaceFileName, selectedReplaceTags]);

  const { all: allReplaceSelected, some: someReplaceSelected } = useMemo(
    () => replaceTagSelectionState(replaceableItemKeys, selectedReplaceItems),
    [replaceableItemKeys, selectedReplaceItems],
  );

  const afterFileName = useMemo(() => {
    if (!preview) return "";
    if (replaceFileName || !canReplaceFileName) return preview.existing.file_name;
    return preview.replacement.file_name;
  }, [canReplaceFileName, preview, replaceFileName]);

  const afterProjectPath = useMemo(() => {
    if (!preview) return "";
    if (replaceFileName || !canReplaceFileName) return preview.project_path_before;
    return preview.project_path_after;
  }, [canReplaceFileName, preview, replaceFileName]);

  useEffect(() => {
    if (!preview) {
      setSelectedReplaceTags(new Set());
      setReplaceFileName(true);
      return;
    }
    setSelectedReplaceTags(new Set(preview.existing.tags.map((tag) => tag.key)));
    setReplaceFileName(true);
  }, [preview]);

  useEffect(() => {
    const el = replaceTagsHeaderRef.current;
    if (el) {
      el.indeterminate = someReplaceSelected && !allReplaceSelected;
    }
  }, [allReplaceSelected, someReplaceSelected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !committing) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [committing, handleClose]);

  const applySourcePath = useCallback(
    async (selected: string, fromDragDrop: boolean) => {
      setError(null);
      setLoading(true);
      setSourcePath(null);
      try {
        const staged = await api.stageDropSourcePath(selected, fromDragDrop);
        setSourcePath(staged);
        const result = await api.previewReplaceProjectTrackFile(track.id, staged);
        setPreview(result);
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
        void applySourcePath(event.payload.sourcePath, true);
      },
    );
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [applySourcePath, track.id]);

  const chooseFile = useCallback(async () => {
    setError(null);
    const selected = await open({
      multiple: false,
      title: "Choose replacement audio file",
      filters: [AUDIO_FILE_DIALOG_FILTER],
    });
    if (selected == null || Array.isArray(selected)) return;

    await applySourcePath(selected, false);
  }, [applySourcePath]);

  const handleConfirm = useCallback(async () => {
    if (!sourcePath) return;
    setCommitting(true);
    setError(null);
    try {
      const updated = await api.replaceProjectTrackFile(
        track.id,
        sourcePath,
        replaceTagKeysForCommit(
          selectedReplaceTags,
          lockedPartitionTagKey,
          replaceableTagKeys,
        ),
        // API flag: use the replacement file's name (inverse of checked "Replace" in the dialog).
        canReplaceFileName && !replaceFileName,
      );
      patchTrack(updated);
      invalidateTrackTags(track.id);
      await refresh();
      handleClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setCommitting(false);
    }
  }, [
    canReplaceFileName,
    handleClose,
    lockedPartitionTagKey,
    patchTrack,
    refresh,
    replaceFileName,
    replaceableTagKeys,
    selectedReplaceTags,
    sourcePath,
    track.id,
  ]);

  const busy = loading || committing || phoneBusy;
  const deliveryOptions = phoneUploadReady ? 3 : 2;
  const confirmBlockedByCollision =
    preview?.path_collision && canReplaceFileName && !replaceFileName;

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
              <div className="space-y-1 text-xs text-muted">
                <p className="text-sm text-foreground">
                  {trackDeliveryIntro(deliveryOptions, false)} Replacing{" "}
                  <span className="font-medium text-foreground">{track.title}</span> in the
                  project.
                </p>
                <p>
                  IceTrackVault will verify the file, then show a confirmation step before the
                  project copy is updated.
                </p>
              </div>

              <TrackDeliveryOptionSection title="Choose file">
                <button
                  type="button"
                  onClick={() => void chooseFile()}
                  disabled={busy}
                  className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  Choose file…
                </button>
              </TrackDeliveryOptionSection>

              <TrackDeliveryOptionSection title="Drag and drop">
                <AudioFilesDropZone
                  label="Drop replacement audio file here"
                  enabled={!busy}
                  multiple={false}
                  onAudioPathsDropped={(paths) => {
                    setDropError(null);
                    void applySourcePath(paths[0], true);
                  }}
                  onRejected={() =>
                    setDropError(
                      "Drop a single audio file (mp3, flac, wav, and similar formats).",
                    )
                  }
                />
                {dropError && <p className="text-sm text-red-400">{dropError}</p>}
                {sourcePath && loading && (
                  <p className="text-muted">Verifying selected file…</p>
                )}
              </TrackDeliveryOptionSection>

              {phoneUploadReady ? (
                <TrackDeliveryOptionSection title="Upload from phone">
                  <ReplaceTrackPhoneSection
                    trackId={track.id}
                    trackTitle={track.title}
                    enabled={!loading}
                    onError={setError}
                    onBusyChange={setPhoneBusy}
                  />
                </TrackDeliveryOptionSection>
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
                      {projectDirectory(preview.project_path_before)}
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
                    Tag values and the project file name you enable below from the current
                    project file will be applied to the copy. Disabled rows keep the
                    replacement file&apos;s values instead.
                  </li>
                  <li>
                    After the copy is ready, the current project file will be removed from
                    disk when the project path changes (see paths below).
                  </li>
                  <li>
                    Project playlists and taglists that include this track keep the same entry.
                  </li>
                </ul>
              </div>

              {preview.path_collision &&
                preview.collision_message &&
                canReplaceFileName &&
                !replaceFileName && (
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
                      <th className="px-3 py-2 font-medium text-muted">Tag</th>
                      <th className="px-3 py-2 font-medium text-foreground">
                        Current project file
                      </th>
                      <th className="px-3 py-2 font-medium text-foreground">
                        New project file (after copy)
                      </th>
                      <th className="w-28 px-3 py-2 font-medium text-foreground">
                        <label className="flex items-center justify-center gap-1.5 text-xs font-medium">
                          <input
                            ref={replaceTagsHeaderRef}
                            type="checkbox"
                            checked={allReplaceSelected}
                            disabled={replaceableItemKeys.length === 0 || busy}
                            onChange={() => {
                              const selectAll = !allReplaceSelected;
                              setReplaceFileName(selectAll && canReplaceFileName);
                              if (selectAll) {
                                setSelectedReplaceTags(new Set(replaceableTagKeys));
                              } else {
                                setSelectedReplaceTags(
                                  new Set(
                                    lockedPartitionTagKey &&
                                      replaceableTagKeys.includes(lockedPartitionTagKey)
                                      ? [lockedPartitionTagKey]
                                      : [],
                                  ),
                                );
                              }
                            }}
                            className="shrink-0"
                            aria-label="Replace all from current project file"
                          />
                          Replace
                        </label>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 text-muted">File name</td>
                      <td className="px-3 py-2">{preview.existing.file_name}</td>
                      <td className="px-3 py-2">{afterFileName}</td>
                      <td className="px-3 py-2 text-center">
                        {canReplaceFileName ? (
                          <input
                            type="checkbox"
                            checked={replaceFileName}
                            disabled={busy}
                            onChange={() => setReplaceFileName((prev) => !prev)}
                            className="shrink-0"
                            aria-label="Replace file name from current project file"
                          />
                        ) : (
                          <span className="text-muted" aria-hidden>
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="px-3 py-2 text-muted">Project path</td>
                      <td className="px-3 py-2 break-all">{preview.project_path_before}</td>
                      <td className="px-3 py-2 break-all">{afterProjectPath}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="text-muted" aria-hidden>
                          —
                        </span>
                      </td>
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
                    {tagKeys.map((key) => {
                      const isLockedPartitionTag =
                        lockedPartitionTagKey != null && key === lockedPartitionTagKey;
                      const canReplace =
                        replaceableTagKeys.includes(key) && !isLockedPartitionTag;
                      const replaceChecked =
                        isLockedPartitionTag || selectedReplaceTags.has(key);
                      const afterValue =
                        replaceChecked
                          ? (existingTags.get(key) ?? "—")
                          : (replacementTags.get(key) ?? "—");
                      return (
                        <tr key={key} className="border-b border-border last:border-b-0">
                          <td className="px-3 py-2 text-muted">{key}</td>
                          <td className="px-3 py-2">{existingTags.get(key) ?? "—"}</td>
                          <td className="px-3 py-2">{afterValue}</td>
                          <td className="px-3 py-2 text-center">
                            {isLockedPartitionTag ? (
                              <input
                                type="checkbox"
                                checked
                                disabled
                                className="shrink-0"
                                title="Always kept from current project file for this application"
                                aria-label={`Replace tag ${key} from current project file (required)`}
                              />
                            ) : canReplace ? (
                              <input
                                type="checkbox"
                                checked={replaceChecked}
                                disabled={busy}
                                onChange={() => {
                                  setSelectedReplaceTags((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                  });
                                }}
                                className="shrink-0"
                                aria-label={`Replace tag ${key} from current project file`}
                              />
                            ) : (
                              <span className="text-muted" aria-hidden>
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {sourcePath && (
                <p className="text-xs text-muted">
                  Selected file:{" "}
                  <span className="break-all text-foreground">{sourcePath}</span>
                  . The “New project file” column shows values after replace, based on your
                  Replace selections.
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
          {preview ? (
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={busy || confirmBlockedByCollision}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {committing ? "Replacing…" : "OK"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
