import { useEffect, useRef, useState } from "react";

import type { Playlist } from "../lib/tauri";

interface TrackRowMenuProps {
  onEditTags: () => void;
  onDeleteTrack?: () => void;
  playlists?: Playlist[];
  onAddToPlaylist?: (playlistId: number) => void;
  onRemoveFromPlaylist?: () => void;
}

export function TrackRowMenu({
  onEditTags,
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
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeMenu();
              onEditTags();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
          >
            Edit tags…
          </button>

          {showAddToPlaylist && (
            <div className="relative">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSubmenuOpen((value) => !value);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
              >
                <span>Add to playlist</span>
                <span aria-hidden="true">›</span>
              </button>
              {submenuOpen && (
                <div className="absolute right-full top-0 z-30 mr-1 min-w-[10rem] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeMenu();
                        onAddToPlaylist(playlist.id);
                      }}
                      className="block w-full truncate px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
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
              className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-neutral-800"
            >
              Remove from playlist
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
              className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-neutral-800"
            >
              Delete track
            </button>
          )}
        </div>
      )}
    </div>
  );
}
