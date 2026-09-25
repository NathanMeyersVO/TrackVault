import { useEffect, useRef } from "react";

import { findTrackDropTargetFromPoint, TRACK_DROP_ATTR } from "../lib/pointerDrag";
import type { Taglist, TaglistValue } from "../lib/tauri";

function parseTagValue(raw: string | null): string | null {
  if (raw == null || raw === "none") return null;
  return raw;
}

export function usePointerTrackDrop(options: {
  draggingTrackId: number | null;
  setDraggingTrackId: (trackId: number | null) => void;
  taglists: Taglist[];
  setDragOverTaglistTarget: (target: {
    taglistId: number;
    value: string | null;
  } | null) => void;
  setDragOverPlaylistId: (playlistId: number | null) => void;
  onTagDrop: (trackId: number, taglist: Taglist, entry: TaglistValue) => void;
  onPlaylistDrop: (trackId: number, playlistId: number) => void;
}) {
  const {
    draggingTrackId,
    setDraggingTrackId,
    taglists,
    setDragOverTaglistTarget,
    setDragOverPlaylistId,
    onTagDrop,
    onPlaylistDrop,
  } = options;

  const taglistsRef = useRef(taglists);
  taglistsRef.current = taglists;
  const onTagDropRef = useRef(onTagDrop);
  onTagDropRef.current = onTagDrop;
  const onPlaylistDropRef = useRef(onPlaylistDrop);
  onPlaylistDropRef.current = onPlaylistDrop;

  useEffect(() => {
    if (draggingTrackId == null) return;

    const updateHover = (clientX: number, clientY: number) => {
      const target = findTrackDropTargetFromPoint(clientX, clientY);
      if (!target) {
        setDragOverTaglistTarget(null);
        setDragOverPlaylistId(null);
        return;
      }

      const kind = target.getAttribute(TRACK_DROP_ATTR);
      if (kind === "taglist") {
        const taglistId = Number.parseInt(
          target.getAttribute("data-taglist-id") ?? "",
          10,
        );
        const value = parseTagValue(target.getAttribute("data-tag-value"));
        if (!Number.isFinite(taglistId)) {
          setDragOverTaglistTarget(null);
          setDragOverPlaylistId(null);
          return;
        }
        setDragOverPlaylistId(null);
        setDragOverTaglistTarget({ taglistId, value });
        return;
      }

      if (kind === "playlist") {
        const playlistId = Number.parseInt(
          target.getAttribute("data-playlist-id") ?? "",
          10,
        );
        if (!Number.isFinite(playlistId)) {
          setDragOverTaglistTarget(null);
          setDragOverPlaylistId(null);
          return;
        }
        setDragOverTaglistTarget(null);
        setDragOverPlaylistId(playlistId);
        return;
      }

      setDragOverTaglistTarget(null);
      setDragOverPlaylistId(null);
    };

    const onPointerMove = (event: PointerEvent) => {
      updateHover(event.clientX, event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      const trackId = draggingTrackId;
      const target = findTrackDropTargetFromPoint(event.clientX, event.clientY);
      setDragOverTaglistTarget(null);
      setDragOverPlaylistId(null);
      setDraggingTrackId(null);

      if (!target || trackId == null) return;

      const kind = target.getAttribute(TRACK_DROP_ATTR);
      if (kind === "taglist") {
        const taglistId = Number.parseInt(
          target.getAttribute("data-taglist-id") ?? "",
          10,
        );
        const value = parseTagValue(target.getAttribute("data-tag-value"));
        const taglist = taglistsRef.current.find((entry) => entry.id === taglistId);
        if (!taglist || !Number.isFinite(taglistId)) return;
        const displayRaw = target.getAttribute("data-tag-display-title");
        const entry: TaglistValue = {
          value,
          display_title: displayRaw ? displayRaw : null,
          track_count: 0,
        };
        onTagDropRef.current(trackId, taglist, entry);
        return;
      }

      if (kind === "playlist") {
        const playlistId = Number.parseInt(
          target.getAttribute("data-playlist-id") ?? "",
          10,
        );
        if (!Number.isFinite(playlistId)) return;
        onPlaylistDropRef.current(trackId, playlistId);
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    draggingTrackId,
    setDragOverPlaylistId,
    setDragOverTaglistTarget,
    setDraggingTrackId,
  ]);
}
