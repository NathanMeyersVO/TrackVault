import { useEffect } from "react";

import { usePlayerStore } from "../store/playerStore";
import { usePlayer } from "../hooks/usePlayer";
import { TrackTable } from "./TrackTable";

export function LibraryView() {
  const { tracks, playback, cursorTrackId, setActiveTrackIds } = usePlayerStore();
  const { playTrack, selectTrack } = usePlayer();

  useEffect(() => {
    setActiveTrackIds(tracks.map((track) => track.id));
  }, [tracks, setActiveTrackIds]);

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
          emptyMessage="Add a music folder to get started."
        />
      </div>
    </div>
  );
}
