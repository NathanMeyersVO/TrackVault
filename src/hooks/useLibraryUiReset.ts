import { useCallback } from "react";

import { clearTrackTagsCache } from "../lib/trackTagsCache";
import type { PlaybackState } from "../lib/tauri";
import { isLibrarySourcedView, usePlayerStore } from "../store/playerStore";

export function useLibraryUiReset() {
  const setPlayback = usePlayerStore((s) => s.setPlayback);
  const setView = usePlayerStore((s) => s.setView);
  const setCursorTrackId = usePlayerStore((s) => s.setCursorTrackId);
  const setActiveTrackIds = usePlayerStore((s) => s.setActiveTrackIds);
  const setTaglistNav = usePlayerStore((s) => s.setTaglistNav);
  const setCursorTaglistFooter = usePlayerStore((s) => s.setCursorTaglistFooter);
  const clearPendingPlayIntent = usePlayerStore((s) => s.clearPendingPlayIntent);
  const clearPendingPausedLoad = usePlayerStore((s) => s.clearPendingPausedLoad);

  const resetLibraryUi = useCallback(
    (playback: PlaybackState) => {
      const currentView = usePlayerStore.getState().view;
      setPlayback(playback);
      if (isLibrarySourcedView(currentView)) {
        setView("library");
        setCursorTrackId(null);
        setActiveTrackIds([]);
        setTaglistNav(null);
        setCursorTaglistFooter(false);
        clearPendingPlayIntent();
      }
      clearPendingPausedLoad();
      clearTrackTagsCache();
    },
    [
      clearPendingPausedLoad,
      clearPendingPlayIntent,
      setActiveTrackIds,
      setCursorTaglistFooter,
      setCursorTrackId,
      setPlayback,
      setTaglistNav,
      setView,
    ],
  );

  return { resetLibraryUi };
}
