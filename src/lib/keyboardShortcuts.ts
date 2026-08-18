export interface KeyboardShortcut {
  keys: string[];
  description: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { keys: ["↑", "↓"], description: "Select previous / next track" },
  { keys: ["Enter"], description: "Play cursor track" },
  { keys: ["P"], description: "Play / pause" },
  { keys: ["←", "→"], description: "Volume down / up" },
];
