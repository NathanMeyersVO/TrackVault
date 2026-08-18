import type { CSSProperties } from "react";

import type { Track } from "../lib/tauri";
import { formatDuration } from "../lib/tauri";
import { appearance } from "../lib/appearance";
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
  showAddColumn: boolean;
  onAddToPlaylist?: (trackId: number) => void;
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
  showAddColumn,
  onAddToPlaylist,
}: TrackTableRowProps) {
  const { onMouseEnter, onMouseLeave, tooltip } = useTrackTooltip(track.id);
  const style = rowStyle(isPlaying, isCursor);

  return (
    <>
      <tr
        id={`track-row-${track.id}`}
        onClick={() => {
          onCursorChange(track.id);
          onFocusList();
        }}
        onDoubleClick={() => onPlay(track.id)}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={style}
        className="cursor-pointer border-b border-neutral-900 text-neutral-200 hover:bg-neutral-900/70"
      >
        <td className="px-4 py-2">
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
        {showAddColumn && (
          <td className="px-4 py-2 text-right">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onAddToPlaylist?.(track.id);
              }}
              className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Add
            </button>
          </td>
        )}
        <td className="w-12 px-2 py-2 text-right">
          <TrackRowMenu onEditTags={() => onEditTags(track.id)} />
        </td>
      </tr>
      {tooltip}
    </>
  );
}
