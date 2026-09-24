import { useCallback, useEffect, useState } from "react";

import { api, type Taglist, type TaglistSwapTarget } from "../lib/tauri";
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

export function SwapTaglistEntryModal({
  taglist,
  taglistId,
  partitionValue,
  trackId,
  trackTitle,
  onClose,
  onSwapped,
}: SwapTaglistEntryModalProps) {
  const [targets, setTargets] = useState<TaglistSwapTarget[]>([]);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .listTaglistSwapTargets(taglistId, partitionValue, trackId)
      .then((loaded) => {
        setTargets(loaded);
        setSelectedValue(loaded[0]?.partition_value ?? null);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [partitionValue, taglistId, trackId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const selectedTarget = targets.find(
    (target) => target.partition_value === selectedValue,
  );

  const handleSwap = useCallback(async () => {
    if (selectedTarget == null) return;

    setSaving(true);
    setError(null);
    try {
      await api.swapTaglistEntries(
        taglistId,
        partitionValue,
        selectedTarget.partition_value,
        trackId,
      );
      onSwapped();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [
    onClose,
    onSwapped,
    partitionValue,
    selectedTarget,
    taglistId,
    trackId,
  ]);

  const entryLabel = taglist.entry_tag_key.trim() || "entry tag";
  const sublistLabel = getTaglistValueSingularLabel(taglist);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl"
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

        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-muted">
            Exchange partition tags for &ldquo;{trackTitle}&rdquo; with another
            track in a different {sublistLabel} that has the same {entryLabel}.
          </p>

          {loading ? (
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

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSwap()}
            disabled={saving || selectedTarget == null}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-foreground hover:bg-accent-hover disabled:opacity-40"
          >
            {saving ? "Swapping…" : "Swap"}
          </button>
        </div>
      </div>
    </div>
  );
}
