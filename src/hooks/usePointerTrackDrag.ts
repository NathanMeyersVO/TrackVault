import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  lockDocumentTextSelection,
  unlockDocumentTextSelection,
} from "../lib/documentTextSelectionLock";
import { pointerExceededDragThreshold } from "../lib/pointerDrag";
import { usePlayerStore } from "../store/playerStore";

type Session = {
  pointerId: number;
  trackId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

export function usePointerTrackDragRow(trackId: number, enabled: boolean) {
  const setDraggingTrackId = usePlayerStore((state) => state.setDraggingTrackId);
  const sessionRef = useRef<Session | null>(null);

  const onWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      if (
        !session.dragging &&
        pointerExceededDragThreshold(
          session.startX,
          session.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        session.dragging = true;
        setDraggingTrackId(session.trackId);
      }

      if (session.dragging) {
        event.preventDefault();
      }
    },
    [setDraggingTrackId],
  );

  const onWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      sessionRef.current = null;
      unlockDocumentTextSelection();
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    },
    [onWindowPointerMove],
  );

  const clearSession = useCallback(() => {
    if (sessionRef.current) {
      unlockDocumentTextSelection();
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    }
    sessionRef.current = null;
    setDraggingTrackId(null);
  }, [onWindowPointerMove, onWindowPointerUp, setDraggingTrackId]);

  const onRowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLTableRowElement>) => {
      if (!enabled || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-reorder-grip]")) return;
      if (target.closest("button")) return;

      lockDocumentTextSelection();
      sessionRef.current = {
        pointerId: event.pointerId,
        trackId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
      window.addEventListener("pointercancel", onWindowPointerUp);
    },
    [enabled, onWindowPointerMove, onWindowPointerUp, trackId],
  );

  return { onRowPointerDown, clearSession };
}
