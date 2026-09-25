import { useCallback, useRef, type RefObject } from "react";

import { applyPointerAutoScrollStep } from "../lib/pointerDrag";

export function usePointerDragAutoScroll(options: {
  scrollContainerRef?: RefObject<HTMLElement | null>;
  resolveScrollEl?: () => HTMLElement | null;
  getPointer: () => { clientX: number; clientY: number } | null;
  isActive: () => boolean;
  onTick: () => void;
}) {
  const {
    scrollContainerRef,
    resolveScrollEl: resolveScrollElOption,
    getPointer,
    isActive,
    onTick,
  } = options;

  const scrollElRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const getPointerRef = useRef(getPointer);
  getPointerRef.current = getPointer;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const resolveScrollEl = useCallback(() => {
    if (scrollContainerRef?.current) return scrollContainerRef.current;
    return resolveScrollElOption?.() ?? null;
  }, [resolveScrollElOption, scrollContainerRef]);

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tickAutoScroll = useCallback(() => {
    if (!isActiveRef.current()) {
      rafRef.current = null;
      return;
    }

    const scrollEl = scrollElRef.current;
    const pointer = getPointerRef.current();
    if (scrollEl && pointer) {
      applyPointerAutoScrollStep(scrollEl, pointer.clientY);
    }

    onTickRef.current();
    rafRef.current = requestAnimationFrame(tickAutoScroll);
  }, []);

  const startAutoScroll = useCallback(() => {
    if (rafRef.current != null) return;
    if (!scrollElRef.current) {
      scrollElRef.current = resolveScrollEl();
    }
    rafRef.current = requestAnimationFrame(tickAutoScroll);
  }, [resolveScrollEl, tickAutoScroll]);

  const resetScrollEl = useCallback(() => {
    scrollElRef.current = null;
  }, []);

  const ensureScrollEl = useCallback(() => {
    scrollElRef.current = resolveScrollEl();
  }, [resolveScrollEl]);

  return {
    startAutoScroll,
    stopAutoScroll,
    resetScrollEl,
    ensureScrollEl,
  };
}
