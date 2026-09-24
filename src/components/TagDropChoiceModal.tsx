import { useEffect, type ReactNode } from "react";

import type { TaglistSwapTarget } from "../lib/tauri";

export type TagDropChoiceMode = "swap" | "move";

interface TagDropChoiceModalProps {
  title: string;
  sublistLabel: string;
  partitionLabel: string;
  entryTagValue: string | null;
  swapPartner: TaglistSwapTarget;
  mode: TagDropChoiceMode;
  onModeChange: (mode: TagDropChoiceMode) => void;
  error: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function RadioOption({
  name,
  value,
  checked,
  disabled,
  onChange,
  label,
  description,
}: {
  name: string;
  value: TagDropChoiceMode;
  checked: boolean;
  disabled: boolean;
  onChange: (mode: TagDropChoiceMode) => void;
  label: ReactNode;
  description: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${
        checked ? "border-accent bg-accent/10" : "border-border bg-background"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 text-sm">
        <span className="block text-foreground">{label}</span>
        <span className="mt-1 block text-xs text-muted">{description}</span>
      </span>
    </label>
  );
}

export function TagDropChoiceModal({
  title,
  sublistLabel,
  partitionLabel,
  entryTagValue,
  swapPartner,
  mode,
  onModeChange,
  error,
  busy,
  onConfirm,
  onCancel,
}: TagDropChoiceModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const confirmLabel = mode === "swap" ? (busy ? "Swapping…" : "Swap") : busy ? "Moving…" : "Move";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-drop-choice-title"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="tag-drop-choice-title" className="text-sm font-semibold text-foreground">
            {title}
          </h2>
        </div>

        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-muted">
            {sublistLabel} &ldquo;{partitionLabel}&rdquo; already has a track with
            entry &ldquo;{entryTagValue ?? ""}&rdquo;. How should this move be
            applied?
          </p>

          <div
            role="radiogroup"
            aria-label="Move action"
            className="space-y-2"
          >
            <RadioOption
              name="tag-drop-choice"
              value="swap"
              checked={mode === "swap"}
              disabled={busy}
              onChange={onModeChange}
              label={<>Swap tracks with &ldquo;{swapPartner.track_title}&rdquo;</>}
              description={
                <>
                  Exchange partition tags between the two tracks. Both files&apos;
                  metadata will be updated.
                </>
              }
            />
            <RadioOption
              name="tag-drop-choice"
              value="move"
              checked={mode === "move"}
              disabled={busy}
              onChange={onModeChange}
              label={
                <>Add to {sublistLabel} &ldquo;{partitionLabel}&rdquo;</>
              }
              description={
                <>
                  Move only this track into the target sublist. This file&apos;s
                  metadata will be updated.
                </>
              }
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-sm text-foreground hover:bg-surface-hover disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
