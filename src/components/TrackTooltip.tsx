import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TrackTagInfo } from "../lib/tauri";
import { fetchTrackTags } from "../lib/trackTagsCache";

export function useTrackTooltip(trackId: number) {
  const [visible, setVisible] = useState(false);
  const [tags, setTags] = useState<TrackTagInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (showTimerRef.current != null) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  const onMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({
      top: rect.top + window.scrollY,
      left: Math.min(rect.left + 16, window.innerWidth - 320),
    });

    showTimerRef.current = window.setTimeout(() => {
      setVisible(true);
      setLoading(true);
      fetchTrackTags(trackId)
        .then(setTags)
        .catch(() => setTags(null))
        .finally(() => setLoading(false));
    }, 300);
  };

  const onMouseLeave = () => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setVisible(false);
  };

  const tooltip =
    visible &&
    createPortal(
      <div
        className="pointer-events-none fixed z-50 w-72 rounded-md border border-border bg-surface p-3 text-xs shadow-lg"
        style={{ top: position.top, left: position.left, transform: "translateY(-8px) translateY(-100%)" }}
      >
        {loading && <div className="text-muted">Loading tags…</div>}
        {!loading && tags && (
          <>
            <div className="mb-2 truncate font-medium text-foreground">{tags.file_name}</div>
            {tags.fields.length === 0 ? (
              <div className="text-muted">No tags found.</div>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {tags.fields.map((field) => (
                  <li key={`${field.key}-${field.value}`} className="text-foreground">
                    <span className="text-muted">{field.key}:</span> {field.value}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {!loading && !tags && <div className="text-muted">Could not load tags.</div>}
      </div>,
      document.body,
    );

  return { onMouseEnter, onMouseLeave, tooltip };
}
