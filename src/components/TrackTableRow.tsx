import type { CSSProperties } from "react";

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
        onClick={() => {
          onCursorChange(track.id);
          onFocusList();
        }}
        onDoubleClick={() => onPlay(track.id)}
        style={style}
        className={`border-b border-neutral-900 text-neutral-200 hover:bg-neutral-900/70 ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        }`}
      >
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
