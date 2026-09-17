import { useEffect } from "react";

import { useDemoPrivacy } from "../hooks/useDemoPrivacy";
import { COMMON_TAG_KEYS } from "../lib/tauri";

interface DemoPrivacySettingsModalProps {
  onClose: () => void;
}

export function DemoPrivacySettingsModal({ onClose }: DemoPrivacySettingsModalProps) {
  const {
    demoModeEnabled,
    sensitiveTagKeys,
    blurFilenames,
    setDemoModeEnabled,
    setBlurFilenames,
    toggleSensitiveTagKey,
  } = useDemoPrivacy();

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
        className="flex max-h-[min(32rem,90vh)] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-privacy-title"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="demo-privacy-title"
            className="text-sm font-semibold text-foreground"
          >
            Demo / privacy
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-hover hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <label className="mb-4 flex cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={demoModeEnabled}
              onChange={(event) => setDemoModeEnabled(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Demo mode</span>
              <span className="mt-1 block text-xs text-muted">
                Blur sensitive tag values on screen. This is visual only; data is
                still loaded locally. Demo mode turns off when you quit the app.
              </span>
            </span>
          </label>

          <label className="mb-4 flex cursor-pointer items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={blurFilenames}
              onChange={(event) => setBlurFilenames(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Blur filenames</span>
              <span className="mt-1 block text-xs text-muted">
                Blur file names in tag tooltips and the tag editor in the
                library, playlists, and taglists—not in stored collections.
              </span>
            </span>
          </label>

          <div className="text-xs font-medium text-muted">Sensitive tag keys</div>
          <p className="mb-2 text-xs text-muted">
            Selected keys are blurred while demo mode is on in the library,
            playlists, and taglists—not in stored collections. Track Title,
            Track Artist, and Album Title also blur the matching columns there.
          </p>
          <ul className="space-y-1">
            {COMMON_TAG_KEYS.map((key) => {
              const checked = sensitiveTagKeys.includes(key);
              return (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSensitiveTagKey(key)}
                    />
                    {key}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
