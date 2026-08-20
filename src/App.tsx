import { useEffect } from "react";
import { AppMenuBar } from "./components/AppMenuBar";
import { Sidebar } from "./components/Sidebar";
import { SidebarResizeHandle } from "./components/SidebarResizeHandle";
import { LibraryView } from "./components/LibraryView";
import { PlaylistView } from "./components/PlaylistView";
import { TaglistView } from "./components/TaglistView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { useLibrary, usePlayer } from "./hooks/usePlayer";
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

function MainContent() {
  const { view, tracks } = usePlayerStore();
  useLibrary();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        {view === "library" ? (
          <LibraryView />
        ) : isTaglistView(view) ? (
          <TaglistView taglistId={view.taglistId} value={view.value} />
        ) : isPlaylistView(view) ? (
          <PlaylistView playlistId={view.playlistId} />
        ) : null}
      </div>

      {view === "library" && tracks.length === 0 && (
        <div className="border-t border-neutral-800 px-4 py-2 text-xs text-neutral-500">
          Tip: use File → Choose library folder to scan MP3, FLAC, WAV, OGG, and M4A files.
        </div>
      )}
    </main>
  );
}

export default function App() {
  const { selectTrack, playTrack, togglePlayPause, adjustVolume } = usePlayer();
  const { width: sidebarWidth, onResizeStart } = useSidebarWidth();
  const setDraggingTrackId = usePlayerStore((state) => state.setDraggingTrackId);
  useTrackCursor({
    onSelectTrack: selectTrack,
    onPlayTrack: playTrack,
    onTogglePlayPause: togglePlayPause,
    onAdjustVolume: adjustVolume,
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
        <MainContent />
      </div>
      <NowPlayingBar />
    </div>
  );
}