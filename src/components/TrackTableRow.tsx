import type { CSSProperties, DragEvent } from "react";

import { setTrackDragData } from "../lib/dragDrop";
import type { Playlist, Track } from "../lib/tauri";
import { formatDuration } from "../lib/tauri";
import { appearance } from "../lib/appearance";
import { usePlayerStore } from "../store/playerStore";
import { TrackRowMenu } from "./TrackRowMenu";
import { useTrackTooltip } from "./TrackTooltip";

interface TrackTableRowProps {
  track: Track;
  isPlaying: boolean;
  isCursor: boolean;
  onCursorChange: (trackId: number) => void;
  onPlay: (trackId: number) => void;
  onEditTags: (trackId: number) => void;
  onFocusList: () => void;
  playlists?: Playlist[];
  onAddTrackToPlaylist?: (trackId: number, playlistId: number) => void;
  onRemoveTrackFromPlaylist?: (trackId: number) => void;
  draggable?: boolean;
  reorderable?: boolean;
  isDragging?: boolean;
  dropIndicator?: "before" | "after" | null;
  onReorderDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onReorderDragEnd?: () => void;
  onReorderDragOver?: (event: DragEvent<HTMLTableRowElement>) => void;
  onReorderDrop?: (event: DragEvent<HTMLTableRowElement>) => void;
}

function rowStyle(isPlaying: boolean, isCursor: boolean): CSSProperties | undefined {
  if (!isPlaying && !isCursor) return undefined;

  return {
    color: isPlaying ? appearance.playingTextColor : undefined,
    backgroundColor: isCursor
      ? isPlaying
        ? appearance.cursorBackgroundPlaying
        : appearance.cursorBackgroundColor
      : undefined,
  };
}

function GripIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-4 w-4 fill-current"
    >
      <circle cx="5" cy="4" r="1.2" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="11" cy="12" r="1.2" />
    </svg>
  );
}

export function TrackTableRow({
  track,
  isPlaying,
  isCursor,
  onCursorChange,
  onPlay,
  onEditTags,
  onFocusList,
  playlists,
  onAddTrackToPlaylist,
  onRemoveTrackFromPlaylist,
  draggable = true,
  reorderable = false,
  isDragging = false,
  dropIndicator = null,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDrop,
}: TrackTableRowProps) {
  const setDraggingTrackId = usePlayerStore((state) => state.setDraggingTrackId);
  const { onMouseEnter, onMouseLeave, tooltip } = useTrackTooltip(track.id);
  const style = rowStyle(isPlaying, isCursor);

  return (
    <>
      <tr
        id={`track-row-${track.id}`}
        draggable={draggable}
        onDragStart={(event) => {
          if (!draggable) return;
          setTrackDragData(event.dataTransfer, track.id);
          setDraggingTrackId(track.id);
        }}
        onDragEnd={() => {
          setDraggingTrackId(null);
        }}
        onDragOver={reorderable ? onReorderDragOver : undefined}
        onDrop={reorderable ? onReorderDrop : undefined}
        onClick={() => {
          onCursorChange(track.id);
          onFocusList();
        }}
        onDoubleClick={() => onPlay(track.id)}
        style={style}
        className={`border-b border-neutral-900 text-neutral-200 hover:bg-neutral-900/70 ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        } ${isDragging ? "opacity-40" : ""} ${
          dropIndicator === "before" ? "border-t-2 border-t-sky-400" : ""
        } ${dropIndicator === "after" ? "border-b-2 border-b-sky-400" : ""}`}
      >
        {reorderable && (
          <td className="w-8 px-1 py-2 text-neutral-500">
            <button
              type="button"
              draggable
              aria-label={`Reorder ${track.title}`}
              className="flex cursor-grab items-center justify-center rounded p-1 hover:bg-neutral-800 hover:text-neutral-300 active:cursor-grabbing"
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation();
                onReorderDragStart?.(event);
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                onReorderDragEnd?.();
              }}
            >
              <GripIcon />
            </button>
          </td>
        )}
        <td
          className="px-4 py-2"
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div className="truncate font-medium">{track.title}</div>
        </td>
        <td className="px-4 py-2">
          <div
            className="truncate"
            style={{ color: isPlaying ? undefined : "#a3a3a3" }}
          >
            {track.artist || "—"}
          </div>
        </td>
        <td className="px-4 py-2">
          <div
            className="truncate"
            style={{ color: isPlaying ? undefined : "#a3a3a3" }}
          >
            {track.album || "—"}
          </div>
        </td>
        <td
          className="px-4 py-2 text-right tabular-nums"
          style={{ color: isPlaying ? undefined : "#a3a3a3" }}
        >
          {formatDuration(track.duration_ms)}
        </td>
        <td className="w-12 px-2 py-2 text-right">
          <TrackRowMenu
            onEditTags={() => onEditTags(track.id)}
            playlists={playlists}
            onAddToPlaylist={
              onAddTrackToPlaylist
                ? (playlistId) => onAddTrackToPlaylist(track.id, playlistId)
                : undefined
            }
            onRemoveFromPlaylist={
              onRemoveTrackFromPlaylist
                ? () => onRemoveTrackFromPlaylist(track.id)
                : undefined
            }
          />
        </td>
      </tr>
      {tooltip}
    </>
  );
}
