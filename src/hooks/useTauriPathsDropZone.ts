import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function useTauriPathsDropZone(options: {
  enabled: boolean;
  onPathsDropped: (paths: string[]) => void;
}) {
  const { enabled, onPathsDropped } = options;
  const ref = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const onDropRef = useRef(onPathsDropped);
  onDropRef.current = onPathsDropped;

  useEffect(() => {
    if (!enabled) {
      setDragOver(false);
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event) => {
          if (cancelled) return;
          const el = ref.current;
          if (!el) return;

          void (async () => {
            const scale = await getCurrentWindow().scaleFactor();
            const { payload } = event;
            if (payload.type === "leave") {
              setDragOver(false);
              return;
            }

            const position =
              payload.type === "enter" || payload.type === "over" || payload.type === "drop"
                ? payload.position
                : null;
            if (!position) return;

            const x = position.x / scale;
            const y = position.y / scale;
            const inside = pointInRect(x, y, el.getBoundingClientRect());

            if (payload.type === "enter" || payload.type === "over") {
              setDragOver(inside);
            } else if (payload.type === "drop") {
              setDragOver(false);
              if (!inside) return;
              const paths = payload.paths;
              if (!paths.length) return;
              onDropRef.current(paths);
            }
          })();
        });
      } catch {
        // Not running inside Tauri (e.g. Vite dev in browser).
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      setDragOver(false);
    };
  }, [enabled]);

  return { ref, dragOver };
}
