import type { CSSProperties, DragEvent } from "react";

import { setTrackDragData } from "../lib/dragDrop";
import type { Playlist, Track } from "../lib/tauri";
import { formatDuration } from "../lib/tauri";
import { DemoBlurText } from "./DemoBlurText";
import { useAppearance } from "../hooks/useAppearance";
import { useDemoPrivacy } from "../hooks/useDemoPrivacy";
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
  changeTaglistValueLabel?: string;
  onChangeTaglistValue?: (trackId: number) => void;
  swapTaglistEntryLabel?: string;
  onSwapTaglistEntry?: (trackId: number) => void;
  onFocusList: () => void;
  playlists?: Playlist[];
  onAddTrackToPlaylist?: (trackId: number, playlistId: number) => void;
  onRemoveTrackFromPlaylist?: (trackId: number) => void;
  onDeleteTrack?: (track: Track) => void;
  draggable?: boolean;
  reorderable?: boolean;
  isDragging?: boolean;
  dropIndicator?: "before" | "after" | null;
  onReorderDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onReorderDragEnd?: () => void;
  onReorderDragOver?: (event: DragEvent<HTMLTableRowElement>) => void;
  onReorderDrop?: (event: DragEvent<HTMLTableRowElement>) => void;
  applyDemoBlur?: boolean;
}

function rowStyle(
  isPlaying: boolean,
  isCursor: boolean,
  playingText: string,
  cursorBackground: string,
  cursorBackgroundPlaying: string,
): CSSProperties | undefined {
  if (!isPlaying && !isCursor) return undefined;

  return {
    color: isPlaying ? playingText : undefined,
    backgroundColor: isCursor
      ? isPlaying
        ? cursorBackgroundPlaying
        : cursorBackground
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
  changeTaglistValueLabel,
  onChangeTaglistValue,
  swapTaglistEntryLabel,
  onSwapTaglistEntry,
  onFocusList,
  playlists,
  onAddTrackToPlaylist,
  onRemoveTrackFromPlaylist,
  onDeleteTrack,
  draggable = true,
  reorderable = false,
  isDragging = false,
  dropIndicator = null,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDrop,
  applyDemoBlur = true,
}: TrackTableRowProps) {
  const { settings } = useAppearance();
  const { shouldBlurTrackField } = useDemoPrivacy();
  const blurTitle = applyDemoBlur && shouldBlurTrackField("title");
  const blurArtist = applyDemoBlur && shouldBlurTrackField("artist");
  const blurAlbum = applyDemoBlur && shouldBlurTrackField("album");
  const setDraggingTrackId = usePlayerStore((state) => state.setDraggingTrackId);
  const { onMouseEnter, onMouseLeave, tooltip } = useTrackTooltip(track.id, {
    applyDemoBlur,
  });
  const style = rowStyle(
    isPlaying,
    isCursor,
    settings.playingText,
    settings.cursorBackground,
    settings.cursorBackgroundPlaying,
  );

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
        className={`border-b border-border text-foreground hover:bg-surface/70 ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        } ${isDragging ? "opacity-40" : ""} ${
          dropIndicator === "before" ? "border-t-2 border-t-drop" : ""
        } ${dropIndicator === "after" ? "border-b-2 border-b-drop" : ""}`}
      >
        {reorderable && (
          <td className="w-8 px-1 py-2 text-muted">
            <button
              type="button"
              draggable
              aria-label={blurTitle ? "Reorder track" : `Reorder ${track.title}`}
              className="flex cursor-grab items-center justify-center rounded p-1 hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
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
          <div className="truncate font-medium">
            <DemoBlurText blur={blurTitle}>{track.title}</DemoBlurText>
          </div>
        </td>
        <td className="px-4 py-2">
          <div
            className={`truncate ${isPlaying ? "" : "text-muted"}`}
          >
            <DemoBlurText blur={blurArtist && Boolean(track.artist)}>
              {track.artist || "—"}
            </DemoBlurText>
          </div>
        </td>
        <td className="px-4 py-2">
          <div
            className={`truncate ${isPlaying ? "" : "text-muted"}`}
          >
            <DemoBlurText blur={blurAlbum && Boolean(track.album)}>
              {track.album || "—"}
            </DemoBlurText>
          </div>
        </td>
        <td
          className={`px-4 py-2 text-right tabular-nums ${isPlaying ? "" : "text-muted"}`}
        >
          {formatDuration(track.duration_ms)}
        </td>
        <td className="w-12 px-2 py-2 text-right">
          <TrackRowMenu
            onEditTags={() => onEditTags(track.id)}
            changeTaglistValueLabel={changeTaglistValueLabel}
            onChangeTaglistValue={
              onChangeTaglistValue
                ? () => onChangeTaglistValue(track.id)
                : undefined
            }
            swapTaglistEntryLabel={swapTaglistEntryLabel}
            onSwapTaglistEntry={
              onSwapTaglistEntry
                ? () => onSwapTaglistEntry(track.id)
                : undefined
            }
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
            onDeleteTrack={
              onDeleteTrack ? () => onDeleteTrack(track) : undefined
            }
          />
        </td>
      </tr>
      {tooltip}
    </>
  );
}
