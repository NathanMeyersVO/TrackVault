import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api, type Track } from "../lib/tauri";
import { usePlayer } from "../hooks/usePlayer";
import { useTrackSearch } from "../hooks/useTrackSearch";
import { usePlayerStore } from "../store/playerStore";
import { TagEditorModal } from "./TagEditorModal";
import { TrackSearchInput } from "./TrackSearchInput";
import { TrackTable } from "./TrackTable";

interface PlaylistViewProps {
  playlistId: number;
}

export function PlaylistView({ playlistId }: PlaylistViewProps) {
  const {
    playlists,
    playback,
    cursorTrackId,
    setActiveTrackIds,
  } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [editingTrackId, setEditingTrackId] = useState<number | null>(null);
  const { query, setQuery, filteredTracks, isSearching } = useTrackSearch(tracks);

  const playlist = playlists.find((p) => p.id === playlistId);

  const refreshTracks = useCallback(() => {
    api.getPlaylistTracks(playlistId).then(setTracks).catch(console.error);
  }, [playlistId]);

  useEffect(() => {
    refreshTracks();
  }, [refreshTracks, playlists]);

  useEffect(() => {
    const unlisten = listen("library-updated", () => {
      refreshTracks();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshTracks]);

  useEffect(() => {
    setActiveTrackIds(filteredTracks.map((track) => track.id));
  }, [filteredTracks, setActiveTrackIds]);

  const removeTrack = async (trackId: number) => {
    await api.removeTrackFromPlaylist(playlistId, trackId);
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-4 py-3">
        <h2 className="text-base font-semibold text-white">
          {playlist?.name ?? "Playlist"}
        </h2>
        <p className="text-xs text-neutral-500">
          {isSearching
            ? `${filteredTracks.length} of ${tracks.length} track${tracks.length === 1 ? "" : "s"}`
            : `${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        </p>
      </div>
      <div className="border-b border-neutral-800 px-4 py-2">
        <TrackSearchInput value={query} onChange={setQuery} />
      </div>
      <div className="min-h-0 flex-1">
        <TrackTable
          tracks={filteredTracks}
          playingTrackId={playback.track_id}
          cursorTrackId={cursorTrackId}
          onCursorChange={selectTrack}
          onPlay={playTrack}
          onEditTags={setEditingTrackId}
          onRemoveTrackFromPlaylist={removeTrack}
          emptyMessage={
            isSearching
              ? "No tracks match your search."
              : "No tracks in this playlist yet. Add tracks from the library."
          }
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