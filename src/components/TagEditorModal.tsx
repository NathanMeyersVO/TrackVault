import { useCallback, useEffect, useState } from "react";

import {
  api,
  COMMON_TAG_KEYS,
  type Track,
  type TrackTagInfo,
} from "../lib/tauri";
import { invalidateTrackTags } from "../lib/trackTagsCache";
import { usePlayerStore } from "../store/playerStore";

interface EditableField {
  key: string;
  value: string;
  editable: boolean;
}

interface TagEditorModalProps {
  trackId: number;
  onClose: () => void;
}

export function TagEditorModal({ trackId, onClose }: TagEditorModalProps) {
  const patchTrack = usePlayerStore((state) => state.patchTrack);
  const [info, setInfo] = useState<TrackTagInfo | null>(null);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTagKey, setNewTagKey] = useState("");
  const [newTagValue, setNewTagValue] = useState("");

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getTrackTags(trackId)
      .then((tagInfo) => {
        setInfo(tagInfo);
        setFields(
          tagInfo.fields.map((field) => ({
            key: field.key,
            value: field.value,
            editable: field.editable,
          })),
        );
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [trackId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const existingKeys = new Set(fields.map((field) => field.key));
  const availableKeys = COMMON_TAG_KEYS.filter((key) => !existingKeys.has(key));

  const updateField = (index: number, value: string) => {
    setFields((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, value } : field,
      ),
    );
  };

  const addField = () => {
    const key = newTagKey.trim();
    if (!key || existingKeys.has(key)) return;
    setFields((current) => [...current, { key, value: newTagValue, editable: true }]);
    setNewTagKey("");
    setNewTagValue("");
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = fields
        .filter((field) => field.editable)
        .map((field) => ({ key: field.key, value: field.value }));

      const updated: Track = await api.updateTrackTags(trackId, payload);
      patchTrack(updated);
      invalidateTrackTags(trackId);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [fields, onClose, patchTrack, trackId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-editor-title"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 id="tag-editor-title" className="text-sm font-semibold text-white">
            Edit Tags
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading && <div className="text-sm text-neutral-500">Loading tags…</div>}

          {!loading && info && (
            <>
              <div className="mb-3 text-xs text-neutral-500">
                File: <span className="text-neutral-300">{info.file_name}</span>
                {info.tag_type && (
                  <>
                    {" "}
                    · Tag type: <span className="text-neutral-300">{info.tag_type}</span>
                  </>
                )}
              </div>

              <div className="space-y-2">
                {fields.map((field, index) => (
                  <label key={field.key} className="block text-xs">
                    <span className="mb-1 block text-neutral-500">{field.key}</span>
                    {field.editable ? (
                      <input
                        value={field.value}
                        onChange={(event) => updateField(index, event.target.value)}
                        disabled={saving}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                      />
                    ) : (
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-400">
                        {field.value}
                      </div>
                    )}
                  </label>
                ))}
              </div>

              {availableKeys.length > 0 && (
                <div className="mt-4 border-t border-neutral-800 pt-3">
                  <div className="mb-2 text-xs font-medium text-neutral-400">Add tag</div>
                  <div className="flex gap-2">
                    <select
                      value={newTagKey}
                      onChange={(event) => setNewTagKey(event.target.value)}
                      disabled={saving}
                      className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                    >
                      <option value="">Select key…</option>
                      {availableKeys.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                    <input
                      value={newTagValue}
                      onChange={(event) => setNewTagValue(event.target.value)}
                      disabled={saving}
                      placeholder="Value"
                      className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={addField}
                      disabled={saving || !newTagKey}
                      className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
