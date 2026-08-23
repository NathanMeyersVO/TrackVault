import { useEffect } from "react";

import { VOLUME_STEP } from "./usePlayer";
import {
  scrollSidebarItem,
  sidebarCollectionId,
  sidebarPlaylistId,
} from "../lib/sidebarNavigation";
import { usePlayerStore } from "../store/playerStore";

export const TRACK_LIST_ID = "track-list";
export const TAGLIST_FOOTER_ROW_ID = "track-row-taglist-footer";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function focusTrackList(): void {
  document.getElementById(TRACK_LIST_ID)?.focus({ preventScroll: true });
}

function scrollToTaglistFooter(): void {
  requestAnimationFrame(() => {
    document
      .getElementById(TAGLIST_FOOTER_ROW_ID)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function navigateSidebarGroup(direction: "up" | "down"): void {
  const state = usePlayerStore.getState();
  const { view, collections, playlists, setView, taglistNav } = state;
  const delta = direction === "down" ? 1 : -1;

  if (typeof view === "object" && "collectionId" in view) {
    const currentIndex = collections.findIndex(
      (collection) => collection.id === view.collectionId,
    );
    const nextIndex = currentIndex + delta;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= collections.length) {
      return;
    }
    const target = collections[nextIndex];
    setView({ collectionId: target.id });
    scrollSidebarItem(sidebarCollectionId(target.id));
    return;
  }

  if (typeof view === "object" && "playlistId" in view) {
    const currentIndex = playlists.findIndex(
      (playlist) => playlist.id === view.playlistId,
    );
    const nextIndex = currentIndex + delta;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= playlists.length) {
      return;
    }
    const target = playlists[nextIndex];
    setView({ playlistId: target.id });
    scrollSidebarItem(sidebarPlaylistId(target.id));
    return;
  }

  if (typeof view === "object" && "taglistId" in view) {
    if (direction === "down" && taglistNav?.hasNextSublist) {
      taglistNav.activateNextSublist();
    } else if (direction === "up" && taglistNav?.hasPreviousSublist) {
      taglistNav.activatePreviousSublist();
    }
  }
}

interface UseTrackCursorOptions {
  onSelectTrack: (trackId: number) => void;
  onPlayTrack: (trackId: number) => void;
  onTogglePlayPause: () => void;
  onAdjustVolume: (delta: number) => void;
  seekToStart: () => void | Promise<void>;
  seekToEnd: () => void | Promise<void>;
}

export function useTrackCursor({
  onSelectTrack,
  onPlayTrack,
  onTogglePlayPause,
  onAdjustVolume,
  seekToStart,
  seekToEnd,
}: UseTrackCursorOptions) {
  const {
    cursorTrackId,
    activeTrackIds,
    taglistNav,
    cursorTaglistFooter,
    setCursorTaglistFooter,
  } = usePlayerStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.key === "p" || event.key === "P") {
        onTogglePlayPause();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onAdjustVolume(-VOLUME_STEP);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        onAdjustVolume(VOLUME_STEP);
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        const state = usePlayerStore.getState();
        if (state.transportBusy) return;
        if (state.playback.track_id) {
          void seekToStart();
        } else if (state.cursorTrackId) {
          state.setPreviewPositionMs(0);
        }
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        const state = usePlayerStore.getState();
        if (state.transportBusy) return;
        if (state.playback.track_id) {
          void seekToEnd();
        } else if (state.cursorTrackId) {
          const track = state.tracks.find(
            (entry) => entry.id === state.cursorTrackId,
          );
          const durationMs =
            track?.duration_ms ?? state.playback.duration_ms ?? 0;
          if (durationMs > 0) {
            state.setPreviewPositionMs(Math.max(0, durationMs - 1000));
          }
        }
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        navigateSidebarGroup("up");
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        navigateSidebarGroup("down");
        return;
      }

      if (event.key === "Enter") {
        if (cursorTaglistFooter && taglistNav?.hasNextSublist) {
          event.preventDefault();
          taglistNav.activateNextSublist();
          return;
        }

        if (!cursorTrackId) return;

        event.preventDefault();
        onPlayTrack(cursorTrackId);
        return;
      }

      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

      const hasFooter = taglistNav?.hasNextSublist ?? false;
      if (activeTrackIds.length === 0 && !hasFooter) return;

      event.preventDefault();
      focusTrackList();

      if (cursorTaglistFooter) {
        if (event.key === "ArrowUp" && activeTrackIds.length > 0) {
          setCursorTaglistFooter(false);
          const lastId = activeTrackIds[activeTrackIds.length - 1];
          onSelectTrack(lastId);
          requestAnimationFrame(() => {
            document
              .getElementById(`track-row-${lastId}`)
              ?.scrollIntoView({ block: "nearest" });
          });
        }
        return;
      }

      const currentIndex = cursorTrackId
        ? activeTrackIds.indexOf(cursorTrackId)
        : -1;

      if (event.key === "ArrowDown") {
        const atLastTrack =
          currentIndex === activeTrackIds.length - 1 ||
          (currentIndex === -1 && activeTrackIds.length === 0);

        if (atLastTrack && hasFooter) {
          setCursorTaglistFooter(true);
          scrollToTaglistFooter();
          return;
        }
      }

      if (activeTrackIds.length === 0) return;

      let nextIndex: number;
      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(0, currentIndex - 1);
      } else {
        nextIndex = Math.min(activeTrackIds.length - 1, currentIndex + 1);
      }

      const nextId = activeTrackIds[nextIndex];
      onSelectTrack(nextId);

      requestAnimationFrame(() => {
        document
          .getElementById(`track-row-${nextId}`)
          ?.scrollIntoView({ block: "nearest" });
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTrackIds,
    cursorTaglistFooter,
    cursorTrackId,
    onAdjustVolume,
    onPlayTrack,
    seekToEnd,
    seekToStart,
    onSelectTrack,
    onTogglePlayPause,
    setCursorTaglistFooter,
    taglistNav,
  ]);
}
