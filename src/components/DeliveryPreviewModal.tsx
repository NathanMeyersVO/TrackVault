import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  type DeliveryChange,
  type DeliveryPreview,
} from "../lib/tauri";

export interface DeliveryPreviewModalProps {
  preview: DeliveryPreview;
  mode: "create" | "update";
  projectName: string;
  applicationId: string;
  onClose: () => void;
  onApplied: () => void;
}

export function DeliveryPreviewModal({
  preview: initialPreview,
  mode,
  projectName,
  applicationId,
  onClose,
  onApplied,
}: DeliveryPreviewModalProps) {
  const [preview, setPreview] = useState(initialPreview);
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(initialPreview.changes.filter((c) => c.default_selected).map((c) => c.change_id)),
  );
  const [applyMode, setApplyMode] = useState<"merge" | "full_replace">("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "update") return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await api.previewDeliveryWithMode(
          initialPreview.staging_session_id,
          applyMode,
        );
        if (!cancelled) {
          setPreview(next);
          setSelected(
            new Set(next.changes.filter((c) => c.default_selected).map((c) => c.change_id)),
          );
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyMode, initialPreview.staging_session_id, mode]);

  const selectedCount = selected.size;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(preview.changes.map((c) => c.change_id)));
  }, [preview.changes]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const grouped = useMemo(() => groupChanges(preview.changes), [preview.changes]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.applyStagedDelivery(
        preview.staging_session_id,
        [...selected],
        applyMode,
        mode === "create" ? projectName : null,
        mode === "create" ? applicationId : null,
      );
      onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {mode === "create" ? "Create project from delivery" : "Apply delivery update"}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {preview.staged_audio_count} files in delivery
            {mode === "update"
              ? ` · ${preview.library_audio_count} in project library`
              : ""}
            {" · "}
            {selectedCount} of {preview.changes.length} changes selected
          </p>
        </div>

        {mode === "update" && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={applyMode === "merge"}
                onChange={() => setApplyMode("merge")}
              />
              Merge (keep tracks not in delivery)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={applyMode === "full_replace"}
                onChange={() => setApplyMode("full_replace")}
              />
              Full replacement (include removals)
            </label>
          </div>
        )}

        <div className="flex gap-2 border-b border-border px-4 py-2 text-xs">
          <button type="button" className="text-accent hover:underline" onClick={selectAll}>
            Select all
          </button>
          <button type="button" className="text-accent hover:underline" onClick={selectNone}>
            Select none
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {Object.entries(grouped).map(([label, items]) =>
            items.length === 0 ? null : (
              <section key={label} className="mb-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {label}
                </h3>
                <ul className="space-y-1">
                  {items.map((change) => (
                    <li key={change.change_id} className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(change.change_id)}
                        onChange={() => toggle(change.change_id)}
                        className="mt-0.5"
                      />
                      <span className="text-foreground">{change.summary}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>

        {error && (
          <p className="border-t border-border px-4 py-2 text-xs text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || selectedCount === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-40"
          >
            {busy ? "Applying…" : `Apply selected changes (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupChanges(changes: DeliveryChange[]): Record<string, DeliveryChange[]> {
  const groups: Record<string, DeliveryChange[]> = {
    Added: [],
    Updated: [],
    Replaced: [],
    Moved: [],
    Removed: [],
    Schedule: [],
  };
  for (const c of changes) {
    const kind = c.kind;
    if (kind === "audio_add") groups.Added.push(c);
    else if (kind === "audio_update") groups.Updated.push(c);
    else if (kind === "audio_replace") groups.Replaced.push(c);
    else if (kind === "audio_move") groups.Moved.push(c);
    else if (kind === "audio_remove") groups.Removed.push(c);
    else groups.Schedule.push(c);
  }
  return groups;
}
