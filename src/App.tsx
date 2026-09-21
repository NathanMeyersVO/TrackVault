import { useEffect, useState } from "react";
import { api } from "./lib/tauri";
import { AppMenuBar } from "./components/AppMenuBar";
import { Sidebar } from "./components/Sidebar";
import { SidebarResizeHandle } from "./components/SidebarResizeHandle";
import { LibraryView } from "./components/LibraryView";
import { PlaylistView } from "./components/PlaylistView";
import { TaglistView } from "./components/TaglistView";
import { CollectionView } from "./components/CollectionView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { AudioCacheBanner } from "./components/AudioCacheBanner";
import { useLibrary, usePlayer } from "./hooks/usePlayer";
import { initPlayerController } from "./playerController";
import { useSidebarWidth } from "./hooks/useSidebarWidth";
import { useTrackCursor } from "./hooks/useTrackCursor";
import { usePlayerStore, type View } from "./store/playerStore";

function isPlaylistView(view: View): view is { playlistId: number } {
  return typeof view === "object" && "playlistId" in view;
}

function isTaglistView(
  view: View,
): view is { taglistId: number; value: string | null } {
  return typeof view === "object" && "taglistId" in view;
}

function isCollectionView(view: View): view is { collectionId: number } {
  return typeof view === "object" && "collectionId" in view;
}

function MainContent({ scheduleStale }: { scheduleStale: boolean }) {
  const { view, tracks } = usePlayerStore();
  useLibrary();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <AudioCacheBanner />
      <div className="min-h-0 flex-1">
        {view === "library" ? (
          <LibraryView />
        ) : isCollectionView(view) ? (
          <CollectionView collectionId={view.collectionId} />
        ) : isTaglistView(view) ? (
          <TaglistView taglistId={view.taglistId} value={view.value} />
        ) : isPlaylistView(view) ? (
          <PlaylistView playlistId={view.playlistId} />
        ) : null}
      </div>

      {scheduleStale && (
        <div className="border-t border-border bg-surface px-4 py-2 text-xs text-foreground">
          Event schedule file changed.{" "}
          <span className="text-muted">Use Library → Refresh Event Schedule.</span>
        </div>
      )}
      {view === "library" && tracks.length === 0 && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted">
          Use Library → Projects to import a vendor delivery and open a project.
        </div>
      )}
    </main>
  );
}

export default function App() {
  const [scheduleStale, setScheduleStale] = useState(false);

  useEffect(() => {
    initPlayerController();
  }, []);

  useEffect(() => {
    void api.getScheduleStale().then(setScheduleStale).catch(() => setScheduleStale(false));
    const id = window.setInterval(() => {
      void api.getScheduleStale().then(setScheduleStale).catch(() => setScheduleStale(false));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const { selectTrack, playTrack, togglePlayPause, adjustVolume, seekToStart, seekToEnd } = usePlayer();
  const { width: sidebarWidth, onResizeStart } = useSidebarWidth();
  const setDraggingTrackId = usePlayerStore((state) => state.setDraggingTrackId);
  useTrackCursor({
    onSelectTrack: selectTrack,
    onPlayTrack: playTrack,
    onTogglePlayPause: togglePlayPause,
    onAdjustVolume: adjustVolume,
    seekToStart,
    seekToEnd,
  });

  useEffect(() => {
    const clearDragState = () => {
      setDraggingTrackId(null);
    };
    window.addEventListener("dragend", clearDragState);
    return () => window.removeEventListener("dragend", clearDragState);
  }, [setDraggingTrackId]);

  return (
    <div className="flex h-full flex-col">
      <AppMenuBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar width={sidebarWidth} />
        <SidebarResizeHandle width={sidebarWidth} onResizeStart={onResizeStart} />
        <MainContent scheduleStale={scheduleStale} />
      </div>
      <NowPlayingBar />
    </div>
  );
}
