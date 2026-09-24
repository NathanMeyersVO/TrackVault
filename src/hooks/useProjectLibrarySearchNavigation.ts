import { useCallback } from "react";

import { formatTaglistLabel } from "../lib/taglistLabels";
import type { ProjectLibrarySearchHit } from "../lib/tauri";
import { playerController } from "../playerController";
import { scrollSidebarItem, sidebarSublistId } from "../lib/sidebarNavigation";
import { usePlayerStore } from "../store/playerStore";

function scrollToTrackRow(trackId: number): void {
  requestAnimationFrame(() => {
    document
      .getElementById(`track-row-${trackId}`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

const SCROLL_RETRY_MAX_FRAMES = 8;

export function scrollToTrackRowWithRetry(trackId: number): void {
  let attempts = 0;
  const tryScroll = () => {
    const row = document.getElementById(`track-row-${trackId}`);
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      return;
    }
    attempts += 1;
    if (attempts < SCROLL_RETRY_MAX_FRAMES) {
      requestAnimationFrame(tryScroll);
    }
  };
  requestAnimationFrame(tryScroll);
}

export function useProjectLibrarySearchNavigation() {
  const setView = usePlayerStore((state) => state.setView);
  const setPendingPartitionFocus = usePlayerStore(
    (state) => state.setPendingPartitionFocus,
  );

  const navigateToHit = useCallback(
    (hit: ProjectLibrarySearchHit) => {
      const { taglist_id: taglistId, partition_value: value, track_id: trackId } =
        hit;

      const store = usePlayerStore.getState();
      store.setProjectLibrarySearchQuery("");
      setPendingPartitionFocus({ taglistId, value, trackId });
      setView({ taglistId, value });
      scrollSidebarItem(sidebarSublistId(taglistId, value));
      playerController.selectTrack(trackId);
    },
    [setPendingPartitionFocus, setView],
  );

  return { navigateToHit };
}

export function formatProjectLibrarySearchHit(hit: ProjectLibrarySearchHit): {
  primary: string;
  secondary: string;
} {
  const partitionLabel = formatTaglistLabel(
    hit.partition_value,
    hit.partition_display_title,
  );
  return {
    primary: hit.match_label,
    secondary: `${hit.taglist_name} · ${partitionLabel}`,
  };
}

export { scrollToTrackRow };
