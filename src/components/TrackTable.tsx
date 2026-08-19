import { useCallback, useState } from "react";

import { TRACK_LIST_ID } from "../hooks/useTrackCursor";
import { getReorderDragData, setReorderDragData } from "../lib/dragDrop";
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
  onReorderTracks?: (orderedIds: number[]) => void;
  emptyMessage: string;
  draggable?: boolean;
}

function reorderTrackIds(
  trackIds: number[],
  fromIndex: number,
  toIndex: number,
  position: "before" | "after",
): number[] {
  const next = [...trackIds];
  const [moved] = next.splice(fromIndex, 1);
  let insertAt = toIndex;
  if (position === "after") insertAt += 1;
  if (fromIndex < insertAt) insertAt -= 1;
  next.splice(insertAt, 0, moved);
  return next;
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
  onReorderTracks,
  emptyMessage,
  draggable = true,
}: TrackTableProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);

  const reorderable = onReorderTracks != null;

  const focusTrackList = () => {
    document.getElementById(TRACK_LIST_ID)?.focus({ preventScroll: true });
  };

  const clearReorderState = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (targetIndex: number, event: React.DragEvent<HTMLTableRowElement>) => {
      event.preventDefault();
      if (!onReorderTracks) return;

      const fromIndex = dragIndex ?? getReorderDragData(event.dataTransfer);
      if (fromIndex == null || fromIndex === targetIndex) {
        clearReorderState();
        return;
      }

      const row = event.currentTarget.getBoundingClientRect();
      const position: "before" | "after" =
        event.clientY < row.top + row.height / 2 ? "before" : "after";

      const orderedIds = reorderTrackIds(
        tracks.map((track) => track.id),
        fromIndex,
        targetIndex,
        position,
      );
      onReorderTracks(orderedIds);
      clearReorderState();
    },
    [clearReorderState, dragIndex, onReorderTracks, tracks],
  );

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      id={TRACK_LIST_ID}
      tabIndex={0}
      className="h-full overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-600"
    >
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-neutral-950/95 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {reorderable && <th className="w-8 px-1 py-2" aria-label="Reorder" />}
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Artist</th>
            <th className="px-4 py-2 font-medium">Album</th>
            <th className="px-4 py-2 text-right font-medium">Time</th>
            <th className="w-12 px-2 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, index) => (
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
              draggable={draggable && !reorderable}
              reorderable={reorderable}
              isDragging={dragIndex === index}
              dropIndicator={
                dropTarget?.index === index ? dropTarget.position : null
              }
              onReorderDragStart={(event) => {
                setReorderDragData(event.dataTransfer, index);
                setDragIndex(index);
              }}
              onReorderDragEnd={clearReorderState}
              onReorderDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const row = event.currentTarget.getBoundingClientRect();
                const position: "before" | "after" =
                  event.clientY < row.top + row.height / 2 ? "before" : "after";
                setDropTarget({ index, position });
              }}
              onReorderDrop={(event) => handleDrop(index, event)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
