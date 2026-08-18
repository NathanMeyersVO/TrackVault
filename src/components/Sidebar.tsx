import { useState, type DragEvent, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { api } from "../lib/tauri";
import { getTrackDragData } from "../lib/dragDrop";
import { useLibrary } from "../hooks/usePlayer";
import { usePlayerStore, type View } from "../store/playerStore";

export function Sidebar() {
  const { playlists, view, setView, scanning, draggingTrackId, setDraggingTrackId } =
    usePlayerStore();
  const { refresh } = useLibrary();
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<number | null>(null);

  const isTrackDragging = draggingTrackId != null;

  const handlePlaylistDrop = async (playlistId: number, event: DragEvent) => {
    event.preventDefault();
    setDragOverPlaylistId(null);
    setDraggingTrackId(null);

    const trackId = draggingTrackId ?? getTrackDragData(event.dataTransfer);
    if (trackId == null) return;

    await api.addTrackToPlaylist(playlistId, trackId);
    await refresh();
  };

  const addFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a music folder",
    });
    if (typeof selected === "string") {
      await api.addWatchFolder(selected);
      await refresh();
    }
  };

  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    await api.createPlaylist(name);
    setNewPlaylistName("");
    setCreating(false);
    await refresh();
  };

  const isLibraryActive = view === "library";

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight text-white">TrackVault</h1>
        <p className="text-xs text-neutral-500">Local music library</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <button
          onClick={() => setView("library")}
          className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm ${
            isLibraryActive
              ? "bg-neutral-800 text-white"
              : "text-neutral-300 hover:bg-neutral-800/60"
          }`}
        >
          Library
        </button>

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {isTrackDragging ? "Drop on a playlist" : "Playlists"}
        </div>

        {playlists.map((playlist) => {
          const active =
            typeof view === "object" && view.playlistId === playlist.id;
          const isDragOver = dragOverPlaylistId === playlist.id;

          const handleNavigate = () => {
            setView({ playlistId: playlist.id } as View);
          };

          const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleNavigate();
            }
          };

          return (
            <div
              key={playlist.id}
              role="button"
              tabIndex={0}
              onClick={handleNavigate}
              onKeyDown={handleKeyDown}
              onDragOver={(event) => {
                if (!isTrackDragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragOverPlaylistId(playlist.id);
              }}
              onDragEnter={(event) => {
                if (!isTrackDragging) return;
                event.preventDefault();
                setDragOverPlaylistId(playlist.id);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragOverPlaylistId((current) =>
                  current === playlist.id ? null : current,
                );
              }}
              onDrop={(event) => {
                void handlePlaylistDrop(playlist.id, event);
              }}
              className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                isDragOver
                  ? "border-2 border-blue-500 bg-blue-950/40 text-white ring-2 ring-blue-500"
                  : isTrackDragging
                    ? "border border-dashed border-neutral-600 bg-neutral-800/50 text-neutral-200"
                    : active
                      ? "border border-transparent bg-neutral-800 text-white"
                      : "border border-transparent text-neutral-300 hover:bg-neutral-800/60"
              }`}
            >
              <span className="truncate">{playlist.name}</span>
              <span className="ml-1 text-neutral-500">({playlist.track_count})</span>
            </div>
          );
        })}

        {creating ? (
          <div className="mt-2 space-y-2 px-2">
            <input
              autoFocus
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createPlaylist();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Playlist name"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={createPlaylist}
                className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500"
              >
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-800/60 hover:text-white"
          >
            + New playlist
          </button>
        )}
      </nav>

      <div className="space-y-2 border-t border-neutral-800 p-3">
        <button
          onClick={addFolder}
          disabled={scanning}
          className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Add music folder"}
        </button>
        <KeyboardShortcuts />
      </div>
    </aside>
  );
}
