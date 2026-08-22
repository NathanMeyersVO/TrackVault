import { useEffect, useRef } from "react";

export const SUCCESS_DISMISS_MS = 4000;
export const ERROR_DISMISS_MS = 8000;

export function useAutoDismissFeedback(
  feedback: string | null,
  clear: () => void,
  dismissMs: number,
) {
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    if (feedback == null) return;

    const timer = window.setTimeout(() => {
      clearRef.current();
    }, dismissMs);

    return () => window.clearTimeout(timer);
  }, [feedback, dismissMs]);
}
