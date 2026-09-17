import { useCallback, useEffect, useState } from "react";

import { api, type Taglist } from "../lib/tauri";
import { getTaglistValueSingularLabel } from "../lib/taglistLabels";
import { useDemoPrivacy } from "../hooks/useDemoPrivacy";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { usePlayerStore } from "../store/playerStore";

interface ChangeTaglistValueModalProps {
  trackId: number;
  taglist: Taglist;
  onClose: () => void;
}

function normalizeTagValue(value: string): string {
  return value.trim();
}

export function ChangeTaglistValueModal({
  trackId,
  taglist,
  onClose,
}: ChangeTaglistValueModalProps) {
  const { shouldBlurTagKey } = useDemoPrivacy();
  const patchTrack = usePlayerStore((state) => state.patchTrack);
  const blurValue = shouldBlurTagKey(taglist.tag_key);
  const singularLabel = getTaglistValueSingularLabel(taglist);
  const [currentValue, setCurrentValue] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getTrackTags(trackId)
      .then((tagInfo) => {
        const field = tagInfo.fields.find((item) => item.key === taglist.tag_key);
        const initial = field?.value ?? "";
        setCurrentValue(initial);
        setValue(initial);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [trackId, taglist.tag_key]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const unchanged =
    normalizeTagValue(value) === normalizeTagValue(currentValue);

  const handleSave = useCallback(async () => {
    if (unchanged) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTrackTags(trackId, [
        { key: taglist.tag_key, value: normalizeTagValue(value) },
      ]);
      patchTrack(updated);
      invalidateTrackTags(trackId);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [currentValue, onClose, patchTrack, taglist.tag_key, trackId, unchanged, value]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-taglist-value-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="change-taglist-value-title"
            className="text-sm font-semibold text-foreground"
          >
            Change {singularLabel}
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

        <div className="px-4 py-3">
          {loading ? (
            <div className="text-sm text-muted">Loading…</div>
          ) : (
            <>
              <label className="mb-1 block text-xs text-muted">
                {singularLabel} (tag: {taglist.tag_key})
              </label>
              <div
                className={blurValue ? "rounded-md" : undefined}
                style={blurValue ? { filter: "blur(6px)" } : undefined}
              >
                <input
                  autoFocus={!blurValue}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  readOnly={blurValue}
                  disabled={blurValue}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !unchanged && !saving && !blurValue) {
                      void handleSave();
                    }
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-100"
                />
              </div>
              <p className="mt-3 text-xs text-muted">
                This updates the file&apos;s metadata.
              </p>
            </>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={loading || saving || unchanged}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-foreground hover:bg-accent-hover disabled:opacity-40"
          >
            {saving ? "Saving…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
