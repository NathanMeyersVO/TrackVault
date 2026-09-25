import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  lockDocumentTextSelection,
  unlockDocumentTextSelection,
} from "../lib/documentTextSelectionLock";
import {
  findReorderIndexFromPoint,
  findScrollableAncestor,
  pointerExceededDragThreshold,
  REORDER_INDEX_ATTR,
  scrollDeltaForPointer,
} from "../lib/pointerDrag";

export type ReorderDropTarget = {
  index: number;
  position: "before" | "after";
};

type Session = {
  pointerId: number;
  fromIndex: number;
  startX: number;
  startY: number;
  lastClientX: number;
  lastClientY: number;
  dragging: boolean;
};

export function usePointerListReorder(options: {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onCommit: (
    fromIndex: number,
    toIndex: number,
    position: "before" | "after",
  ) => void;
}) {
  const { enabled, containerRef, scrollContainerRef, onCommit } = options;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<ReorderDropTarget | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const updateDropTarget = useCallback(
    (clientX: number, clientY: number, fromIndex: number) => {
      const hit = findReorderIndexFromPoint(
        clientX,
        clientY,
        containerRef.current,
      );
      if (hit && hit.index !== fromIndex) {
        setDropTarget({ index: hit.index, position: hit.position });
      } else {
        setDropTarget(null);
      }
    },
    [containerRef],
  );

  const resolveScrollEl = useCallback(() => {
    if (scrollContainerRef?.current) return scrollContainerRef.current;
    return findScrollableAncestor(containerRef.current);
  }, [containerRef, scrollContainerRef]);

  const tickAutoScroll = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.dragging) {
      rafRef.current = null;
      return;
    }

    const scrollEl = scrollElRef.current;
    if (scrollEl) {
      const delta = scrollDeltaForPointer(
        session.lastClientY,
        scrollEl.getBoundingClientRect(),
      );
      if (delta !== 0) {
        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
        scrollEl.scrollTop = Math.min(
          maxScroll,
          Math.max(0, scrollEl.scrollTop + delta),
        );
      }
    }

    updateDropTarget(session.lastClientX, session.lastClientY, session.fromIndex);
    rafRef.current = requestAnimationFrame(tickAutoScroll);
  }, [updateDropTarget]);

  const startAutoScroll = useCallback(() => {
    if (rafRef.current != null) return;
    if (!scrollElRef.current) {
      scrollElRef.current = resolveScrollEl();
    }
    rafRef.current = requestAnimationFrame(tickAutoScroll);
  }, [resolveScrollEl, tickAutoScroll]);

  const clearSession = useCallback(() => {
    stopAutoScroll();
    if (sessionRef.current) {
      unlockDocumentTextSelection();
    }
    sessionRef.current = null;
    scrollElRef.current = null;
    setActiveIndex(null);
    setDropTarget(null);
  }, [stopAutoScroll]);

  const finishSession = useCallback(
    (clientX: number, clientY: number) => {
      const session = sessionRef.current;
      if (!session?.dragging) {
        clearSession();
        return;
      }

      const hit = findReorderIndexFromPoint(
        clientX,
        clientY,
        containerRef.current,
      );
      if (hit && hit.index !== session.fromIndex) {
        onCommitRef.current(session.fromIndex, hit.index, hit.position);
      }
      clearSession();
    },
    [clearSession, containerRef],
  );

  const onWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;

      session.lastClientX = event.clientX;
      session.lastClientY = event.clientY;

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
        setActiveIndex(session.fromIndex);
        scrollElRef.current = resolveScrollEl();
      }

      if (!session.dragging) return;

      event.preventDefault();
      updateDropTarget(event.clientX, event.clientY, session.fromIndex);
      startAutoScroll();
    },
    [resolveScrollEl, startAutoScroll, updateDropTarget],
  );

  const onWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      stopAutoScroll();
      finishSession(event.clientX, event.clientY);
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    },
    [finishSession, onWindowPointerMove, stopAutoScroll],
  );

  const getGripProps = useCallback(
    (index: number) => ({
      "data-reorder-grip": true,
      onPointerDown: (event: ReactPointerEvent) => {
        if (!enabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        lockDocumentTextSelection();
        sessionRef.current = {
          pointerId: event.pointerId,
          fromIndex: index,
          startX: event.clientX,
          startY: event.clientY,
          lastClientX: event.clientX,
          lastClientY: event.clientY,
          dragging: false,
        };
        scrollElRef.current = null;
        event.currentTarget.setPointerCapture(event.pointerId);
        window.addEventListener("pointermove", onWindowPointerMove);
        window.addEventListener("pointerup", onWindowPointerUp);
        window.addEventListener("pointercancel", onWindowPointerUp);
      },
      style: { touchAction: "none" as const },
    }),
    [enabled, onWindowPointerMove, onWindowPointerUp],
  );

  const getRowProps = useCallback(
    (index: number) => ({
      [REORDER_INDEX_ATTR]: String(index),
    }),
    [],
  );

  const isReorderActive = activeIndex != null;

  return {
    activeIndex,
    dropTarget,
    isReorderActive,
    getGripProps,
    getRowProps,
    clearSession,
  };
}
