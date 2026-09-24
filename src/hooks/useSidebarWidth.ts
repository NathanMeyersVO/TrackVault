import { useCallback, useState } from "react";

const STORAGE_KEY = "trackvault.sidebarWidth";
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
    return clampWidth(parsed);
  } catch {
    return DEFAULT_WIDTH;
  }
}

function storeWidth(width: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Ignore storage failures.
  }
}

export function useSidebarWidth() {
  const [width, setWidth] = useState(readStoredWidth);

  const onResizeStart = useCallback((clientX: number) => {
    const startX = clientX;
    const startWidth = width;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (event: MouseEvent) => {
      const nextWidth = clampWidth(startWidth + (event.clientX - startX));
      setWidth(nextWidth);
    };

    const onMouseUp = (event: MouseEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
      storeWidth(clampWidth(startWidth + (event.clientX - startX)));
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  return { width, onResizeStart };
}
