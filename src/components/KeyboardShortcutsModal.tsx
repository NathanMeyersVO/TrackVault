import { useEffect } from "react";

import { KEYBOARD_SHORTCUTS } from "../lib/keyboardShortcuts";

function KeyLabel({ label }: { label: string }) {
  return (
    <kbd className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
      {label}
    </kbd>
  );
}

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
      >
        <div className="border-b border-neutral-800 px-4 py-3">
          <h2 id="shortcuts-dialog-title" className="text-sm font-semibold text-white">
            Keyboard shortcuts
          </h2>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          <ul className="space-y-2">
            {KEYBOARD_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.description}
                className="flex items-start gap-2 text-sm text-neutral-300"
              >
                <div className="flex shrink-0 gap-1">
                  {shortcut.keys.map((key) => (
                    <KeyLabel key={key} label={key} />
                  ))}
                </div>
                <span className="min-w-0 leading-5">{shortcut.description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500">
            Shortcuts are ignored while typing in a text field.
          </p>
        </div>
        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
