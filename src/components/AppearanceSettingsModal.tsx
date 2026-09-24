import { useEffect } from "react";

import {
  getSchemesByMode,
  type ColorScheme,
  type ColorSchemeMode,
} from "../lib/colorSchemes";
import { getScheme, useAppearance } from "../hooks/useAppearance";

interface AppearanceSettingsModalProps {
  onClose: () => void;
}

function ThemeCard({
  scheme,
  selected,
  onSelect,
}: {
  scheme: ColorScheme;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors } = scheme;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-lg border-2 p-3 text-left transition-shadow hover:shadow-md"
      style={{
        backgroundColor: colors.surface,
        borderColor: selected ? colors.accent : colors.border,
        boxShadow: selected ? `0 0 0 1px ${colors.accent}` : undefined,
      }}
    >
      <div className="mb-2 flex gap-1">
        {[
          colors.background,
          colors.surface,
          colors.accent,
          colors.playingText,
          colors.waveformProgress,
        ].map((color) => (
          <span
            key={color}
            className="h-5 flex-1 rounded-sm"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <div className="text-sm font-medium" style={{ color: colors.foreground }}>
        {scheme.name}
        {selected ? " ✓" : ""}
      </div>
      <div
        className="mt-0.5 text-xs leading-snug"
        style={{ color: colors.muted }}
      >
        {scheme.description}
      </div>
    </button>
  );
}

function ThemeSection({
  mode,
  label,
  themeId,
  onSelect,
  labelColor,
}: {
  mode: ColorSchemeMode;
  label: string;
  themeId: string;
  onSelect: (id: string) => void;
  labelColor: string;
}) {
  const schemes = getSchemesByMode(mode);

  return (
    <section className="mb-4 last:mb-0">
      <h3
        className="mb-2 text-xs font-medium uppercase tracking-wide"
        style={{ color: labelColor }}
      >
        {label}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {schemes.map((scheme) => (
          <ThemeCard
            key={scheme.id}
            scheme={scheme}
            selected={themeId === scheme.id}
            onSelect={() => onSelect(scheme.id)}
          />
        ))}
      </div>
    </section>
  );
}

export function AppearanceSettingsModal({ onClose }: AppearanceSettingsModalProps) {
  const { themeId, selectTheme } = useAppearance();
  const activeScheme = getScheme(themeId);

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
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border shadow-xl"
        style={{
          backgroundColor: activeScheme.colors.surface,
          borderColor: activeScheme.colors.border,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-dialog-title"
      >
        <div
          className="border-b px-4 py-3"
          style={{ borderColor: activeScheme.colors.border }}
        >
          <h2
            id="appearance-dialog-title"
            className="text-sm font-semibold"
            style={{ color: activeScheme.colors.foreground }}
          >
            Color scheme
          </h2>
          <p
            className="mt-1 text-xs"
            style={{ color: activeScheme.colors.muted }}
          >
            Choose a curated theme. Each scheme is designed to keep text and controls readable.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <ThemeSection
            mode="dark"
            label="Dark"
            themeId={themeId}
            onSelect={selectTheme}
            labelColor={activeScheme.colors.muted}
          />
          <ThemeSection
            mode="light"
            label="Light"
            themeId={themeId}
            onSelect={selectTheme}
            labelColor={activeScheme.colors.muted}
          />
        </div>
        <div
          className="flex justify-end border-t px-4 py-3"
          style={{ borderColor: activeScheme.colors.border }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{
              backgroundColor: activeScheme.colors.surfaceHover,
              color: activeScheme.colors.foreground,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
