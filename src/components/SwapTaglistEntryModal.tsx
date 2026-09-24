import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  formatDuration,
  type SwapTaglistPreview,
  type Taglist,
  type TaglistSwapTarget,
} from "../lib/tauri";
import {
  formatFileSize,
  SWAP_FILE_NAME_KEY,
  swapSelectionState,
  swapTagKeysForCommit,
} from "../lib/trackSwapApproval";
import {
  formatTaglistLabel,
  getTaglistValueSingularLabel,
} from "../lib/taglistLabels";

interface SwapTaglistEntryModalProps {
  taglist: Taglist;
  taglistId: number;
  partitionValue: string | null;
  trackId: number;
  trackTitle: string;
  onClose: () => void;
  onSwapped: () => void;
}

type SwapStep = "select" | "approve";

function tagValueMap(tags: { key: string; value: string }[]): Map<string, string> {
  return new Map(tags.map((tag) => [tag.key, tag.value]));
}

export function SwapTaglistEntryModal({
  taglist,
  taglistId,
  partitionValue,
  trackId,
  trackTitle,
  onClose,
  onSwapped,
}: SwapTaglistEntryModalProps) {
  const [step, setStep] = useState<SwapStep>("select");
  const [targets, setTargets] = useState<TaglistSwapTarget[]>([]);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [preview, setPreview] = useState<SwapTaglistPreview | null>(null);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSwapTags, setSelectedSwapTags] = useState<Set<string>>(() => new Set());
  const [swapLibraryPaths, setSwapLibraryPaths] = useState(true);
  const [swapBasenames, setSwapBasenames] = useState(true);
  const swapHeaderRef = useRef<HTMLInputElement>(null);
  const previewSessionKeyRef = useRef<string | null>(null);

  const lockedPartitionKey = taglist.tag_key;

  const forceLibraryPathSwap = Boolean(preview?.different_parent_dirs);
  const effectiveSwapLibraryPaths = forceLibraryPathSwap || swapLibraryPaths;

  useEffect(() => {
    setLoadingTargets(true);
    setError(null);
    api
      .listTaglistSwapTargets(taglistId, partitionValue, trackId)
      .then((loaded) => {
        setTargets(loaded);
        setSelectedValue(loaded[0]?.partition_value ?? null);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingTargets(false));
  }, [partitionValue, taglistId, trackId]);

  useEffect(() => {
    if (step !== "approve" || selectedValue == null) return;
    let cancelled = false;
    setLoadingPreview(true);
    setError(null);
    void api
      .previewSwapTaglistEntries(
        taglistId,
        partitionValue,
        selectedValue,
        trackId,
        effectiveSwapLibraryPaths,
        swapBasenames,
      )
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setPreview(null);
          setError(String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    partitionValue,
    selectedValue,
    step,
    effectiveSwapLibraryPaths,
    swapBasenames,
    taglistId,
    trackId,
  ]);

  useEffect(() => {
    if (step !== "approve" || !preview) return;
    const sessionKey = `${preview.source_library_path}|${preview.partner_library_path}`;
    if (previewSessionKeyRef.current === sessionKey) return;
    previewSessionKeyRef.current = sessionKey;
    setSelectedSwapTags(new Set(preview.source.tags.map((tag) => tag.key)));
  }, [preview, step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        if (step === "approve") {
          setStep("select");
          setPreview(null);
          setError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving, step]);

  const tagKeys = useMemo(() => {
    if (!preview) return [];
    const keys = new Set<string>();
    for (const tag of preview.source.tags) keys.add(tag.key);
    for (const tag of preview.partner.tags) keys.add(tag.key);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [preview]);

  const sourceTags = useMemo(
    () => (preview ? tagValueMap(preview.source.tags) : new Map()),
    [preview],
  );
  const partnerTags = useMemo(
    () => (preview ? tagValueMap(preview.partner.tags) : new Map()),
    [preview],
  );

  const swappableTagKeys = useMemo(() => {
    if (!preview) return [];
    return [...new Set(preview.source.tags.map((tag) => tag.key))].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [preview]);

  const toggleableSwapTagKeys = useMemo(
    () => swappableTagKeys.filter((key) => key !== lockedPartitionKey),
    [lockedPartitionKey, swappableTagKeys],
  );

  const canOfferPathSwap = useMemo(() => {
    if (!preview) return false;
    return (
      preview.different_parent_dirs ||
      preview.source.file_name !== preview.partner.file_name ||
      preview.source_library_path !== preview.partner_library_path
    );
  }, [preview]);

  const swappableItemKeys = useMemo(() => {
    const keys = [...toggleableSwapTagKeys];
    if (canOfferPathSwap) {
      keys.unshift(SWAP_FILE_NAME_KEY);
    }
    return keys;
  }, [canOfferPathSwap, toggleableSwapTagKeys]);

  const selectedSwapItems = useMemo(() => {
    const selected = new Set(selectedSwapTags);
    if (swapBasenames && canOfferPathSwap && preview) {
      if (
        preview.different_parent_dirs ||
        preview.source.file_name !== preview.partner.file_name
      ) {
        selected.add(SWAP_FILE_NAME_KEY);
      }
    }
    return selected;
  }, [canOfferPathSwap, preview, selectedSwapTags, swapBasenames]);

  const { all: allSwapSelected, some: someSwapSelected } = useMemo(
    () => swapSelectionState(swappableItemKeys, selectedSwapItems),
    [selectedSwapItems, swappableItemKeys],
  );

  const afterFileName = useMemo(() => {
    if (!preview) return "";
    if (!effectiveSwapLibraryPaths) return preview.source.file_name;
    if (preview.different_parent_dirs) {
      if (swapBasenames) return preview.partner.file_name;
      return preview.source.file_name;
    }
    if (swapBasenames) return preview.partner.file_name;
    return preview.source.file_name;
  }, [effectiveSwapLibraryPaths, preview, swapBasenames]);

  const afterLibraryPath = useMemo(() => {
    if (!preview) return "";
    if (!effectiveSwapLibraryPaths) return preview.source_library_path;
    return preview.source_path_after;
  }, [effectiveSwapLibraryPaths, preview]);

  const afterPartnerFileName = useMemo(() => {
    if (!preview) return "";
    if (!effectiveSwapLibraryPaths) return preview.partner.file_name;
    if (preview.different_parent_dirs) {
      if (swapBasenames) return preview.source.file_name;
      return preview.partner.file_name;
    }
    if (swapBasenames) return preview.source.file_name;
    return preview.partner.file_name;
  }, [effectiveSwapLibraryPaths, preview, swapBasenames]);

  const afterPartnerLibraryPath = useMemo(() => {
    if (!preview) return "";
    if (!effectiveSwapLibraryPaths) return preview.partner_library_path;
    return preview.partner_path_after;
  }, [effectiveSwapLibraryPaths, preview]);

  const swapExchangesAudioBodies = useMemo(() => {
    if (!preview || !effectiveSwapLibraryPaths) return false;
    if (!preview.different_parent_dirs) {
      return (
        swapBasenames && preview.source.file_name !== preview.partner.file_name
      );
    }
    return swapBasenames;
  }, [effectiveSwapLibraryPaths, preview, swapBasenames]);

  const afterSourceDurationMs = useMemo(() => {
    if (!preview) return 0;
    return swapExchangesAudioBodies
      ? preview.partner.duration_ms
      : preview.source.duration_ms;
  }, [preview, swapExchangesAudioBodies]);

  const afterPartnerDurationMs = useMemo(() => {
    if (!preview) return 0;
    return swapExchangesAudioBodies
      ? preview.source.duration_ms
      : preview.partner.duration_ms;
  }, [preview, swapExchangesAudioBodies]);

  const afterSourceFileSize = useMemo(() => {
    if (!preview) return 0;
    return swapExchangesAudioBodies
      ? preview.partner.file_size_bytes
      : preview.source.file_size_bytes;
  }, [preview, swapExchangesAudioBodies]);

  const afterPartnerFileSize = useMemo(() => {
    if (!preview) return 0;
    return swapExchangesAudioBodies
      ? preview.source.file_size_bytes
      : preview.partner.file_size_bytes;
  }, [preview, swapExchangesAudioBodies]);

  useEffect(() => {
    const el = swapHeaderRef.current;
    if (el) {
      el.indeterminate = someSwapSelected && !allSwapSelected;
    }
  }, [allSwapSelected, someSwapSelected]);

  const beginApproval = useCallback(() => {
    if (selectedValue == null) return;
    previewSessionKeyRef.current = null;
    setStep("approve");
    setPreview(null);
    setSwapLibraryPaths(true);
    setSwapBasenames(true);
    setError(null);
  }, [selectedValue]);

  const goBackToSelect = useCallback(() => {
    previewSessionKeyRef.current = null;
    setStep("select");
    setPreview(null);
    setError(null);
  }, []);

  const handleConfirmSwap = useCallback(async () => {
    if (preview == null || selectedValue == null) return;

    setSaving(true);
    setError(null);
    try {
      const effectiveLibraryPaths = preview.different_parent_dirs
        ? true
        : swapLibraryPaths &&
          canOfferPathSwap &&
          (swapBasenames ||
            preview.source_library_path !== preview.partner_library_path);
      const effectiveBasenames =
        swapBasenames &&
        (preview.different_parent_dirs || preview.source.file_name !== preview.partner.file_name);

      await api.swapTaglistEntries(
        taglistId,
        partitionValue,
        selectedValue,
        trackId,
        swapTagKeysForCommit(selectedSwapTags, lockedPartitionKey, swappableTagKeys),
        effectiveLibraryPaths,
        effectiveBasenames,
      );
      onSwapped();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [
    canOfferPathSwap,
    lockedPartitionKey,
    onClose,
    onSwapped,
    partitionValue,
    preview,
    selectedSwapTags,
    selectedValue,
    swapBasenames,
    swapLibraryPaths,
    swappableTagKeys,
    taglistId,
    trackId,
  ]);

  const entryLabel = taglist.entry_tag_key.trim() || "entry tag";
  const sublistLabel = getTaglistValueSingularLabel(taglist);
  const busy = loadingPreview || saving;
  const confirmBlockedByCollision =
    preview?.path_swap_collision && effectiveSwapLibraryPaths;

  const selectedTarget = targets.find(
    (target) => target.partition_value === selectedValue,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-taglist-entry-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="swap-taglist-entry-title"
            className="text-sm font-semibold text-foreground"
          >
            Swap {sublistLabel}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto space-y-3 px-4 py-3">
          {step === "select" ? (
            <>
              <p className="text-sm text-muted">
                Choose a track in another {sublistLabel} with the same {entryLabel} to
                swap with &ldquo;{trackTitle}&rdquo;.
              </p>

              {loadingTargets ? (
                <div className="text-sm text-muted">
                  Loading matching {sublistLabel}s…
                </div>
              ) : targets.length === 0 ? (
                <div className="text-sm text-muted">
                  No other {sublistLabel} has exactly one track with the same{" "}
                  {entryLabel}.
                </div>
              ) : (
                <div className="text-xs text-muted">
                  <span className="mb-1 block">Target {sublistLabel}</span>
                  <div
                    role="listbox"
                    aria-label={`Target ${sublistLabel}`}
                    className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1"
                  >
                    {targets.map((target) => {
                      const selected = selectedValue === target.partition_value;
                      return (
                        <button
                          key={`${target.partition_value ?? "NO-TAG"}:${target.track_id}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => setSelectedValue(target.partition_value)}
                          className={`w-full rounded px-3 py-2 text-left text-sm text-foreground ${
                            selected
                              ? "bg-accent/20 ring-1 ring-accent"
                              : "hover:bg-surface-hover"
                          }`}
                        >
                          {formatTaglistLabel(
                            target.partition_value,
                            target.partition_display_title,
                          )}
                          <span className="text-muted"> → </span>
                          {target.track_title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {selectedTarget && (
                <p className="text-sm text-muted">
                  Swapping &ldquo;{trackTitle}&rdquo; with &ldquo;
                  {selectedTarget.track_title}&rdquo; (
                  {formatTaglistLabel(
                    selectedTarget.partition_value,
                    selectedTarget.partition_display_title,
                  )}
                  ).
                </p>
              )}

              {loadingPreview && (
                <p className="text-sm text-muted">Loading swap preview…</p>
              )}

              {preview && !loadingPreview && (
                <div className="space-y-3 text-sm text-foreground">
                  <div>
                    <p className="mb-2 font-medium">What will happen</p>
                    <ul className="list-disc space-y-1.5 pl-5 text-muted">
                      <li>
                        The {preview.partition_key} tag will always be exchanged (required).
                      </li>
                      <li>
                        Taglist order slots in each {sublistLabel} follow the swapped tracks.
                      </li>
                      {preview.different_parent_dirs ? (
                        <li>
                          Project library folders are always exchanged when tracks live in
                          different directories; only file names are optional below.
                        </li>
                      ) : null}
                    </ul>
                  </div>

                  {preview.path_swap_collision &&
                    preview.collision_message &&
                    effectiveSwapLibraryPaths && (
                      <p className="text-sm text-red-400">{preview.collision_message}</p>
                    )}

                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full min-w-[28rem] text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-background/50">
                          <th className="px-3 py-2 font-medium text-muted">Field</th>
                          <th className="px-3 py-2 font-medium text-foreground">
                            This track (after swap)
                          </th>
                          <th className="px-3 py-2 font-medium text-foreground">
                            Targeted track (after swap)
                          </th>
                          <th className="w-28 px-3 py-2 font-medium text-foreground">
                            <label className="flex items-center justify-center gap-1.5 text-xs font-medium">
                              <input
                                ref={swapHeaderRef}
                                type="checkbox"
                                checked={allSwapSelected}
                                disabled={swappableItemKeys.length === 0 || busy}
                                onChange={() => {
                                  const selectAll = !allSwapSelected;
                                  if (selectAll) {
                                    setSwapLibraryPaths(true);
                                    setSwapBasenames(true);
                                    setSelectedSwapTags(new Set(swappableTagKeys));
                                  } else {
                                    if (!preview?.different_parent_dirs) {
                                      setSwapLibraryPaths(false);
                                    }
                                    setSwapBasenames(false);
                                    setSelectedSwapTags(
                                      new Set(
                                        swappableTagKeys.includes(lockedPartitionKey)
                                          ? [lockedPartitionKey]
                                          : [],
                                      ),
                                    );
                                  }
                                }}
                                className="shrink-0"
                                aria-label="Swap all selected fields"
                              />
                              Swap
                            </label>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border">
                          <td className="px-3 py-2 text-muted">File name</td>
                          <td className="px-3 py-2">{afterFileName}</td>
                          <td className="px-3 py-2">{afterPartnerFileName}</td>
                          <td className="px-3 py-2 text-center">
                            {canOfferPathSwap &&
                            (preview.different_parent_dirs ||
                              preview.source.file_name !== preview.partner.file_name) ? (
                              <input
                                type="checkbox"
                                checked={swapBasenames}
                                disabled={busy}
                                onChange={() => setSwapBasenames((prev) => !prev)}
                                className="shrink-0"
                                aria-label="Swap file names between tracks"
                              />
                            ) : (
                              <span className="text-muted" aria-hidden>
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                        <tr className="border-b border-border">
                          <td className="px-3 py-2 text-muted">Project library path</td>
                          <td className="px-3 py-2 break-all">{afterLibraryPath}</td>
                          <td className="px-3 py-2 break-all">{afterPartnerLibraryPath}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-muted" aria-hidden>
                              —
                            </span>
                          </td>
                        </tr>
                        <tr className="border-b border-border">
                          <td className="px-3 py-2 text-muted">Length</td>
                          <td className="px-3 py-2">
                            {formatDuration(afterSourceDurationMs)}
                          </td>
                          <td className="px-3 py-2">
                            {formatDuration(afterPartnerDurationMs)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-muted" aria-hidden>
                              —
                            </span>
                          </td>
                        </tr>
                        <tr className="border-b border-border">
                          <td className="px-3 py-2 text-muted">File size</td>
                          <td className="px-3 py-2">
                            {formatFileSize(afterSourceFileSize)}
                          </td>
                          <td className="px-3 py-2">
                            {formatFileSize(afterPartnerFileSize)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-muted" aria-hidden>
                              —
                            </span>
                          </td>
                        </tr>
                        {tagKeys.map((key) => {
                          const isLockedPartition = key === lockedPartitionKey;
                          const canSwap =
                            swappableTagKeys.includes(key) && !isLockedPartition;
                          const swapChecked =
                            isLockedPartition || selectedSwapTags.has(key);
                          const afterThisValue = swapChecked
                            ? (partnerTags.get(key) ?? "—")
                            : (sourceTags.get(key) ?? "—");
                          const afterPartnerValue = swapChecked
                            ? (sourceTags.get(key) ?? "—")
                            : (partnerTags.get(key) ?? "—");
                          return (
                            <tr
                              key={key}
                              className="border-b border-border last:border-b-0"
                            >
                              <td className="px-3 py-2 text-muted">{key}</td>
                              <td className="px-3 py-2">{afterThisValue}</td>
                              <td className="px-3 py-2">{afterPartnerValue}</td>
                              <td className="px-3 py-2 text-center">
                                {isLockedPartition ? (
                                  <input
                                    type="checkbox"
                                    checked
                                    disabled
                                    className="shrink-0"
                                    title="Required for this swap"
                                    aria-label={`Swap tag ${key} (required)`}
                                  />
                                ) : canSwap ? (
                                  <input
                                    type="checkbox"
                                    checked={swapChecked}
                                    disabled={busy}
                                    onChange={() => {
                                      setSelectedSwapTags((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(key)) next.delete(key);
                                        else next.add(key);
                                        return next;
                                      });
                                    }}
                                    className="shrink-0"
                                    aria-label={`Swap tag ${key} with partner track`}
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
                </div>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          {step === "approve" ? (
            <button
              type="button"
              onClick={goBackToSelect}
              disabled={saving}
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-40"
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          {step === "select" ? (
            <button
              type="button"
              onClick={beginApproval}
              disabled={saving || selectedValue == null || targets.length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-foreground hover:bg-accent-hover disabled:opacity-40"
            >
              Swap…
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleConfirmSwap()}
              disabled={
                saving ||
                preview == null ||
                loadingPreview ||
                confirmBlockedByCollision
              }
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-foreground hover:bg-accent-hover disabled:opacity-40"
            >
              {saving ? "Swapping…" : "OK"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
