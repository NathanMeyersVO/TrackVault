import { useCallback } from "react";

import { clearTrackTagsCache } from "../lib/trackTagsCache";
import type { PlaybackState } from "../lib/tauri";
import { isProjectSourcedView, usePlayerStore } from "../store/playerStore";

export function useProjectUiReset() {
  const setPlayback = usePlayerStore((s) => s.setPlayback);
  const setView = usePlayerStore((s) => s.setView);
  const setCursorTrackId = usePlayerStore((s) => s.setCursorTrackId);
  const setActiveTrackIds = usePlayerStore((s) => s.setActiveTrackIds);
  const setTaglistNav = usePlayerStore((s) => s.setTaglistNav);
  const setCursorTaglistFooter = usePlayerStore((s) => s.setCursorTaglistFooter);
  const clearPendingPlayIntent = usePlayerStore((s) => s.clearPendingPlayIntent);
  const clearPendingPausedLoad = usePlayerStore((s) => s.clearPendingPausedLoad);
  const setProjectFolder = usePlayerStore((s) => s.setProjectFolder);
  const setActiveProject = usePlayerStore((s) => s.setActiveProject);
  const setProjectSearchQuery = usePlayerStore(
    (s) => s.setProjectSearchQuery,
  );
  const setPendingPartitionFocus = usePlayerStore((s) => s.setPendingPartitionFocus);

  const resetProjectUi = useCallback(
    (playback: PlaybackState) => {
      const currentView = usePlayerStore.getState().view;
      setPlayback(playback);
      setProjectFolder(null);
      setActiveProject(null);
      if (isProjectSourcedView(currentView)) {
        setView("project_tracks");
        setCursorTrackId(null);
        setActiveTrackIds([]);
        setTaglistNav(null);
        setCursorTaglistFooter(false);
        setProjectSearchQuery("");
        setPendingPartitionFocus(null);
        clearPendingPlayIntent();
      }
      clearPendingPausedLoad();
      clearTrackTagsCache();
    },
    [
      clearPendingPausedLoad,
      clearPendingPlayIntent,
      setActiveProject,
      setActiveTrackIds,
      setCursorTaglistFooter,
      setCursorTrackId,
      setProjectFolder,
      setPendingPartitionFocus,
      setPlayback,
      setProjectSearchQuery,
      setTaglistNav,
      setView,
    ],
  );

  return { resetProjectUi };
}
