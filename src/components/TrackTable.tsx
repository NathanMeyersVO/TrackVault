import type { CSSProperties } from "react";
import type { Track } from "../lib/tauri";
import { formatDuration } from "../lib/tauri";
import { appearance } from "../lib/appearance";

interface TrackTableProps {
  tracks: Track[];
  playingTrackId: number | null;
  cursorTrackId: number | null;
  onCursorChange: (trackId: number) => void;
  onPlay: (trackId: number) => void;
  onAddToPlaylist?: (trackId: number) => void;
  emptyMessage: string;
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

export function TrackTable({
  tracks,
  playingTrackId,
  cursorTrackId,
  onCursorChange,
  onPlay,
  onAddToPlaylist,
  emptyMessage,
}: TrackTableProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-neutral-950/95 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Artist</th>
            <th className="px-4 py-2 font-medium">Album</th>
            <th className="px-4 py-2 text-right font-medium">Time</th>
            {onAddToPlaylist && <th className="px-4 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => {
            const isPlaying = playingTrackId === track.id;
            const isCursor = cursorTrackId === track.id;
            const style = rowStyle(isPlaying, isCursor);

            return (
              <tr
                key={track.id}
                id={`track-row-${track.id}`}
                onClick={() => onCursorChange(track.id)}
                onDoubleClick={() => onPlay(track.id)}
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
                {onAddToPlaylist && (
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToPlaylist(track.id);
                      }}
                      className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
                    >
                      Add
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
