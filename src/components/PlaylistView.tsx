import { useEffect, useState } from "react";

import { api, type Track } from "../lib/tauri";
import { usePlayer } from "../hooks/usePlayer";
import { usePlayerStore } from "../store/playerStore";
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

  const playlist = playlists.find((p) => p.id === playlistId);

  useEffect(() => {
    api.getPlaylistTracks(playlistId).then(setTracks).catch(console.error);
  }, [playlistId, playlists]);

  useEffect(() => {
    setActiveTrackIds(tracks.map((track) => track.id));
  }, [tracks, setActiveTrackIds]);

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
          emptyMessage="No tracks in this playlist yet. Add tracks from the library."
        />
      </div>
      {tracks.length > 0 && cursorTrackId && tracks.some((t) => t.id === cursorTrackId) && (
        <div className="border-t border-neutral-800 px-4 py-2">
          <button
            onClick={() => removeTrack(cursorTrackId)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Remove cursor track from playlist
          </button>
        </div>
      )}
    </div>
  );
}
