import { DEFAULT_SCHEME_ID, getSchemeColors } from "./colorSchemes";

export interface AppearanceSettings {
  background: string;
  surface: string;
  surfaceHover: string;
  border: string;
  foreground: string;
  muted: string;
  accent: string;
  accentHover: string;
  accentSubtle: string;
  dropIndicator: string;
  playingText: string;
  cursorBackground: string;
  cursorBackgroundPlaying: string;
  waveformWave: string;
  waveformProgress: string;
  waveformCursor: string;
}

export type AppearanceSettingKey = keyof AppearanceSettings;

export const DEFAULT_APPEARANCE: AppearanceSettings =
  getSchemeColors(DEFAULT_SCHEME_ID);

const CSS_VAR_MAP: Record<AppearanceSettingKey, string> = {
  background: "--tv-background",
  surface: "--tv-surface",
  surfaceHover: "--tv-surface-hover",
  border: "--tv-border",
  foreground: "--tv-foreground",
  muted: "--tv-muted",
  accent: "--tv-accent",
  accentHover: "--tv-accent-hover",
  accentSubtle: "--tv-accent-subtle",
  dropIndicator: "--tv-drop-indicator",
  playingText: "--tv-playing-text",
  cursorBackground: "--tv-cursor-background",
  cursorBackgroundPlaying: "--tv-cursor-background-playing",
  waveformWave: "--tv-waveform-wave",
  waveformProgress: "--tv-waveform-progress",
  waveformCursor: "--tv-waveform-cursor",
};

export function applyAppearance(settings: AppearanceSettings): void {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP) as [
    AppearanceSettingKey,
    string,
  ][]) {
    root.style.setProperty(cssVar, settings[key]);
  }
}

applyAppearance(DEFAULT_APPEARANCE);
