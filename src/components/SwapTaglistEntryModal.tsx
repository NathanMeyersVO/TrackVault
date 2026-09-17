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
            Swap by {entryLabel}
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
            <label className="block text-xs text-muted">
              Target {sublistLabel}
              <select
                value={selectedValue ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedValue(next === "" ? null : next);
                }}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {targets.map((target) => (
                  <option
                    key={`${target.partition_value ?? "NO-TAG"}:${target.track_id}`}
                    value={target.partition_value ?? ""}
                  >
                    {formatTaglistLabel(
                      target.partition_value,
                      null,
                    )}{" "}
                    → {target.track_title}
                  </option>
                ))}
              </select>
            </label>
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
