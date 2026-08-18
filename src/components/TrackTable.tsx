import { TRACK_LIST_ID } from "../hooks/useTrackCursor";
import type { Playlist, Track } from "../lib/tauri";
import { TrackTableRow } from "./TrackTableRow";

interface TrackTableProps {
  tracks: Track[];
  playingTrackId: number | null;
  cursorTrackId: number | null;
  onCursorChange: (trackId: number) => void;
  onPlay: (trackId: number) => void;
  onEditTags: (trackId: number) => void;
  playlists?: Playlist[];
  onAddTrackToPlaylist?: (trackId: number, playlistId: number) => void;
  onRemoveTrackFromPlaylist?: (trackId: number) => void;
  emptyMessage: string;
  draggable?: boolean;
}

export function TrackTable({
  tracks,
  playingTrackId,
  cursorTrackId,
  onCursorChange,
  onPlay,
  onEditTags,
  playlists,
  onAddTrackToPlaylist,
  onRemoveTrackFromPlaylist,
  emptyMessage,
  draggable = true,
}: TrackTableProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        {emptyMessage}
      </div>
    );
  }

  const focusTrackList = () => {
    document.getElementById(TRACK_LIST_ID)?.focus({ preventScroll: true });
  };

  return (
    <div
      id={TRACK_LIST_ID}
      tabIndex={0}
      className="h-full overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-600"
    >
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-neutral-950/95 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Artist</th>
            <th className="px-4 py-2 font-medium">Album</th>
            <th className="px-4 py-2 text-right font-medium">Time</th>
            <th className="w-12 px-2 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <TrackTableRow
              key={track.id}
              track={track}
              isPlaying={playingTrackId === track.id}
              isCursor={cursorTrackId === track.id}
              onCursorChange={onCursorChange}
              onPlay={onPlay}
              onEditTags={onEditTags}
              onFocusList={focusTrackList}
              playlists={playlists}
              onAddTrackToPlaylist={onAddTrackToPlaylist}
              onRemoveTrackFromPlaylist={onRemoveTrackFromPlaylist}
              draggable={draggable}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
