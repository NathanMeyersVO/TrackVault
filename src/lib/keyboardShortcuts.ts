export interface KeyboardShortcut {
  keys: string[];
  description: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  { keys: ["↑", "↓"], description: "Select previous / next track" },
  { keys: ["Enter"], description: "Start/restart highlighted track" },
  { keys: ["P"], description: "Play / pause" },
  { keys: ["←", "→"], description: "Volume down / up" },
  { keys: ["Home"], description: "Jump to beginning of track" },
  { keys: ["End"], description: "Jump to end of track" },
  { keys: ["PageUp", "PageDown"], description: "Previous / next item in current sidebar group" },
];
