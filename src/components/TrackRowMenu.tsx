import { useEffect, useRef, useState } from "react";

import type { Playlist } from "../lib/tauri";

interface TrackRowMenuProps {
  onEditTags: () => void;
  changeTaglistValueLabel?: string;
  onChangeTaglistValue?: () => void;
  swapTaglistEntryLabel?: string;
  onSwapTaglistEntry?: () => void;
  onDeleteTrack?: () => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: number) => void;
  onRemoveFromPlaylist?: () => void;
}

export function TrackRowMenu({
  onEditTags,
  changeTaglistValueLabel,
  onChangeTaglistValue,
  swapTaglistEntryLabel,
  onSwapTaglistEntry,
  onDeleteTrack,
  playlists,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: TrackRowMenuProps) {
  const [open, setOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setOpen(false);
    setSubmenuOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const showAddToPlaylist =
    playlists != null && playlists.length > 0 && onAddToPlaylist != null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Track actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => {
            if (value) setSubmenuOpen(false);
            return !value;
          });
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeMenu();
              onEditTags();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
          >
            Edit tags…
          </button>

          {changeTaglistValueLabel && onChangeTaglistValue && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeMenu();
                onChangeTaglistValue();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
            >
              Change {changeTaglistValueLabel}…
            </button>
          )}

          {swapTaglistEntryLabel && onSwapTaglistEntry && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeMenu();
                onSwapTaglistEntry();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
            >
              Swap {swapTaglistEntryLabel}…
            </button>
          )}

          {showAddToPlaylist && (
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSubmenuOpen((value) => !value);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
              >
                <span>Add to library playlist</span>
                <span aria-hidden="true">›</span>
              </button>
              {submenuOpen && (
                <div className="absolute right-full top-0 z-30 mr-1 min-w-[10rem] rounded-md border border-border bg-surface py-1 shadow-lg">
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeMenu();
                        onAddToPlaylist(playlist.id);
                      }}
                      className="block w-full truncate px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-hover"
                    >
                      {playlist.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {onRemoveFromPlaylist && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeMenu();
                onRemoveFromPlaylist();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-surface-hover"
            >
              Remove from library playlist
            </button>
          )}

          {onDeleteTrack && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeMenu();
                onDeleteTrack();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-surface-hover"
            >
              Delete track
            </button>
          )}
        </div>
      )}
    </div>
  );
}
