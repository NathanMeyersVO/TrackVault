import { Sidebar } from "./components/Sidebar";
import { LibraryView } from "./components/LibraryView";
import { PlaylistView } from "./components/PlaylistView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { useLibrary, usePlayer } from "./hooks/usePlayer";
import { useTrackCursor } from "./hooks/useTrackCursor";
import { usePlayerStore } from "./store/playerStore";
import { api } from "./lib/tauri";

function MainContent() {
  const { view, tracks, playlists, cursorTrackId } = usePlayerStore();
  useLibrary();

  const addCursorToPlaylist = async (playlistId: number) => {
    if (!cursorTrackId) return;
    await api.addTrackToPlaylist(playlistId, cursorTrackId);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        {view === "library" ? (
          <LibraryView />
        ) : (
          <PlaylistView playlistId={view.playlistId} />
        )}
      </div>

      {view === "library" && playlists.length > 0 && cursorTrackId && (
        <div className="flex items-center gap-2 border-t border-neutral-800 px-4 py-2">
          <span className="text-xs text-neutral-500">Add to playlist:</span>
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              onClick={() => addCursorToPlaylist(playlist.id)}
              className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            >
              {playlist.name}
            </button>
          ))}
        </div>
      )}

      {view === "library" && tracks.length === 0 && (
        <div className="border-t border-neutral-800 px-4 py-2 text-xs text-neutral-500">
          Tip: use &quot;Add music folder&quot; in the sidebar to scan MP3, FLAC, WAV, OGG, and M4A files.
        </div>
      )}
    </main>
  );
}

export default function App() {
  const { selectTrack, playTrack, togglePlayPause, adjustVolume } = usePlayer();
  useTrackCursor({
    onSelectTrack: selectTrack,
    onPlayTrack: playTrack,
    onTogglePlayPause: togglePlayPause,
    onAdjustVolume: adjustVolume,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <MainContent />
      </div>
      <NowPlayingBar />
    </div>
  );
}
