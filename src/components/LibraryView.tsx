import { useCallback, useEffect, useState } from "react";

import { api } from "../lib/tauri";
import { useLibrary, usePlayer } from "../hooks/usePlayer";
import { usePlayerStore } from "../store/playerStore";
import { TagEditorModal } from "./TagEditorModal";
import { TrackTable } from "./TrackTable";

export function LibraryView() {
  const { tracks, playlists, playback, cursorTrackId, setActiveTrackIds } =
    usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const { refresh } = useLibrary();
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);

  useEffect(() => {
    setActiveTrackIds(tracks.map((track) => track.id));
  }, [tracks, setActiveTrackIds]);

  const handleAddToPlaylist = useCallback(
    async (trackId: number, playlistId: number) => {
      await api.addTrackToPlaylist(playlistId, trackId);
      await refresh();
    },
    [refresh],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-4 py-3">
        <h2 className="text-base font-semibold text-white">Library</h2>
        <p className="text-xs text-neutral-500">
          {tracks.length} track{tracks.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <TrackTable
          tracks={tracks}
          playingTrackId={playback.track_id}
          cursorTrackId={cursorTrackId}
          onCursorChange={selectTrack}
          onPlay={playTrack}
          onEditTags={setEditingTrackId}
          playlists={playlists}
          onAddTrackToPlaylist={handleAddToPlaylist}
          emptyMessage="Add a music folder to get started."
        />
      </div>
      {editingTrackId != null && (
        <TagEditorModal
          trackId={editingTrackId}
          onClose={() => setEditingTrackId(null)}
        />
      )}
    </div>
  );
}
