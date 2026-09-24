import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  type DeliveryChange,
  type DeliveryPreview,
} from "../lib/tauri";
import {
  COLLAPSE_GROUP_THRESHOLD,
  groupDeliveryChanges,
  groupSelectionState,
} from "../lib/deliveryPreviewGroups";
import { getDeliveryCopy } from "../lib/applicationConfig";
import { DeliveryBusyOverlay } from "./DeliveryBusyOverlay";

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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [applyMode, setApplyMode] = useState<"merge" | "full_replace">("merge");
  const [busy, setBusy] = useState(false);
  const [previewRefreshing, setPreviewRefreshing] = useState(mode === "update");
  const [error, setError] = useState<string | null>(null);
  const deliveryCopy = getDeliveryCopy(applicationId);

  const groups = useMemo(() => groupDeliveryChanges(preview.changes), [preview.changes]);

  useEffect(() => {
    setExpandedGroups((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const { def, items } of groups) {
        if (!next.has(def.key) && items.length <= COLLAPSE_GROUP_THRESHOLD) {
          next.add(def.key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [preview.staging_session_id, preview.changes.length, groups]);

  useEffect(() => {
    if (mode !== "update") return;
    let cancelled = false;
    setPreviewRefreshing(true);
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
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setPreviewRefreshing(false);
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

  const toggleGroupExpanded = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setGroupSelected = useCallback((items: DeliveryChange[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (select) next.add(item.change_id);
        else next.delete(item.change_id);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedGroups(new Set(groups.map((g) => g.def.key)));
  }, [groups]);

  const collapseAll = useCallback(() => {
    setExpandedGroups(new Set());
  }, []);

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
      {busy ? (
        <DeliveryBusyOverlay
          title={mode === "create" ? "Creating project…" : deliveryCopy.applyingBusyTitle}
          detail="Copying files and updating the project library."
        />
      ) : null}
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {mode === "create" ? deliveryCopy.previewCreateTitle : deliveryCopy.previewApplyTitle}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {preview.staged_audio_count} files in {deliveryCopy.deliverySingular}
            {mode === "update"
              ? ` · ${preview.library_audio_count} in project library`
              : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {preview.changes.length} change{preview.changes.length === 1 ? "" : "s"} to review
            {preview.unchanged_audio_count > 0
              ? ` · ${preview.unchanged_audio_count} track${
                  preview.unchanged_audio_count === 1 ? "" : "s"
                } unchanged`
              : ""}
            {" · "}
            {selectedCount} of {preview.changes.length} selected
            {previewRefreshing ? " · Updating preview…" : ""}
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
              Merge (keep tracks not in {deliveryCopy.deliverySingular})
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

        <div className="flex flex-wrap gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-xs">
          <button type="button" className="text-accent hover:underline" onClick={selectAll}>
            Select all
          </button>
          <button type="button" className="text-accent hover:underline" onClick={selectNone}>
            Select none
          </button>
          <button type="button" className="text-accent hover:underline" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="text-accent hover:underline" onClick={collapseAll}>
            Collapse all
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {preview.unchanged_audio_count > 0 ? (
            <p className="mb-3 rounded-md border border-border/80 bg-surface-hover/40 px-3 py-2 text-xs text-muted">
              <span className="font-medium text-foreground">Audio: </span>
              {preview.unchanged_audio_count} track
              {preview.unchanged_audio_count === 1 ? "" : "s"} in this{" "}
              {deliveryCopy.deliverySingular} already match the
              project library (same files and metadata). No audio updates to apply.
            </p>
          ) : null}
          {groups.map(({ def, items }) => (
            <DeliveryChangeGroupSection
              key={def.key}
              label={def.label}
              items={items}
              expanded={expandedGroups.has(def.key)}
              selected={selected}
              onToggleExpand={() => toggleGroupExpanded(def.key)}
              onToggleItem={toggle}
              onSetGroupSelected={(select) => setGroupSelected(items, select)}
            />
          ))}
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
            disabled={busy || previewRefreshing || selectedCount === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-40"
          >
            {busy
              ? "Applying…"
              : previewRefreshing
                ? "Updating preview…"
                : `Apply selected changes (${selectedCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface DeliveryChangeGroupSectionProps {
  label: string;
  items: DeliveryChange[];
  expanded: boolean;
  selected: Set<string>;
  onToggleExpand: () => void;
  onToggleItem: (id: string) => void;
  onSetGroupSelected: (select: boolean) => void;
}

function DeliveryChangeGroupSection({
  label,
  items,
  expanded,
  selected,
  onToggleExpand,
  onToggleItem,
  onSetGroupSelected,
}: DeliveryChangeGroupSectionProps) {
  const { all, some } = groupSelectionState(items, selected);
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = checkboxRef.current;
    if (el) el.indeterminate = some && !all;
  }, [all, some]);

  return (
    <section className="mb-2 border-b border-border/60 pb-2 last:border-b-0">
      <div className="flex items-center gap-2 py-1.5">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={all}
          onChange={() => onSetGroupSelected(!all)}
          className="shrink-0"
          aria-label={`Select all ${label}`}
        />
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground hover:text-accent"
        >
          <span className="shrink-0 text-xs text-muted" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
          <span className="truncate">
            {label}
            <span className="ml-1.5 font-normal text-muted">({items.length})</span>
          </span>
        </button>
      </div>
      {expanded && (
        <ul className="ml-6 space-y-1 border-l border-border pl-3">
          {items.map((change) => (
            <li key={change.change_id} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(change.change_id)}
                onChange={() => onToggleItem(change.change_id)}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0 text-foreground">{change.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
