import { useState } from "react";

import { KEYBOARD_SHORTCUTS } from "../lib/keyboardShortcuts";

function KeyLabel({ label }: { label: string }) {
  return (
    <kbd className="rounded border border-neutral-700 bg-neutral-950 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
      {label}
    </kbd>
  );
}

export function KeyboardShortcuts() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left text-xs text-neutral-400 hover:text-white"
        aria-expanded={expanded}
      >
        <span>Keyboard shortcuts</span>
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 px-1">
          <ul className="space-y-1.5">
            {KEYBOARD_SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.description}
                className="flex items-start gap-2 text-xs text-neutral-400"
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
          <p className="text-[10px] leading-4 text-neutral-600">
            Shortcuts are ignored while typing in a text field.
          </p>
        </div>
      )}
    </div>
  );
}
