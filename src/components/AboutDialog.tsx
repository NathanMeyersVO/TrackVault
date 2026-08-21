import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { APP_AUTHOR, APP_EMAIL, APP_NAME } from "../lib/appInfo";

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState("…");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {
        if (!cancelled) setVersion("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="about-dialog-title" className="text-sm font-semibold text-foreground">
            About {APP_NAME}
          </h2>
        </div>
        <div className="space-y-3 px-4 py-6 text-center">
          <p className="text-lg font-semibold text-foreground">{APP_NAME}</p>
          <p className="text-sm text-muted">Version {version}</p>
          <div className="space-y-1 text-sm text-foreground">
            <p>Created by {APP_AUTHOR}</p>
            <a
              href={`mailto:${APP_EMAIL}`}
              className="text-accent hover:text-accent-hover hover:underline"
            >
              {APP_EMAIL}
            </a>
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-surface-hover px-3 py-1.5 text-sm text-foreground hover:bg-border"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
