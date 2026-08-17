import { useEffect } from "react";

import { usePlayerStore } from "../store/playerStore";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function useTrackCursor() {
  const { cursorTrackId, activeTrackIds, setCursorTrackId } = usePlayerStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (isEditableTarget(event.target)) return;
      if (activeTrackIds.length === 0) return;

      event.preventDefault();

      const currentIndex = cursorTrackId
        ? activeTrackIds.indexOf(cursorTrackId)
        : -1;

      let nextIndex: number;
      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else {
        nextIndex = Math.min(activeTrackIds.length - 1, currentIndex + 1);
      }

      const nextId = activeTrackIds[nextIndex];
      setCursorTrackId(nextId);

      requestAnimationFrame(() => {
        document
          .getElementById(`track-row-${nextId}`)
          ?.scrollIntoView({ block: "nearest" });
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTrackIds, cursorTrackId, setCursorTrackId]);
}
