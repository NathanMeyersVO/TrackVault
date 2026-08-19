import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { api, COMMON_TAG_KEYS, type Taglist, type TaglistValue } from "../lib/tauri";
import { formatTaglistLabel } from "../lib/taglistLabels";
import { getTrackDragData } from "../lib/dragDrop";
import { useLibrary } from "../hooks/usePlayer";
import { usePlayerStore, type View } from "../store/playerStore";

function TaglistGroup({
  taglist,
  view,
  setView,
}: {
  taglist: Taglist;
  view: View;
  setView: (view: View) => void;
}) {
  const { refresh } = useLibrary();
  const [values, setValues] = useState<TaglistValue[]>([]);

  const loadValues = useCallback(() => {
    api.listTaglistValues(taglist.id).then(setValues).catch(console.error);
  }, [taglist.id]);

  useEffect(() => {
    loadValues();
  }, [loadValues]);

  useEffect(() => {
    const unlisten = listen("library-updated", () => {
      loadValues();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadValues]);

  const deleteTaglist = async (event: MouseEvent) => {
    event.stopPropagation();
    await api.deleteTaglist(taglist.id);
    if (
      typeof view === "object" &&
      "taglistId" in view &&
      view.taglistId === taglist.id
    ) {
      setView("library");
    }
    await refresh();
  };

  const importTitles = async (event: MouseEvent) => {
    event.stopPropagation();
    const selected = await open({
      multiple: false,
      title: "Choose event schedule",
      filters: [{ name: "Schedule", extensions: ["xls", "xlsx", "csv"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const count = await api.importTaglistTitles(taglist.id, selected);
      loadValues();
      console.info(`Imported ${count} title mappings`);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="mb-2">
      <div className="group flex items-center justify-between px-3 py-1">
        <span className="truncate text-xs font-medium text-neutral-400">
          {taglist.name}
        </span>
        <div className="hidden group-hover:inline">
          <button
            type="button"
            onClick={(event) => void importTitles(event)}
            className="rounded px-1 text-xs text-neutral-500 hover:text-white"
            title="Import titles"
          >
            Titles
          </button>
          <button
            type="button"
            onClick={(event) => void deleteTaglist(event)}
            className="rounded px-1 text-xs text-neutral-500 hover:text-red-400"
            title="Delete taglist"
          >
            ×
          </button>
        </div>
      </div>
      {values.map((entry) => {
        const label = formatTaglistLabel(entry.value, entry.display_title);
        const rowKey = entry.value ?? "NO-TAG";
        const active =
          typeof view === "object" &&
          "taglistId" in view &&
          view.taglistId === taglist.id &&
          view.value === entry.value;

        const handleNavigate = () => {
          setView({ taglistId: taglist.id, value: entry.value });
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleNavigate();
          }
        };

        return (
          <div
            key={rowKey}
            role="button"
            tabIndex={0}
            onClick={handleNavigate}
            onKeyDown={handleKeyDown}
            className={`mb-0.5 w-full rounded-md py-1.5 pl-6 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 ${
              active
                ? "bg-neutral-800 text-white"
                : "text-neutral-300 hover:bg-neutral-800/60"
            }`}
          >
            <span className="truncate">{label}</span>
            <span className="ml-1 text-neutral-500">({entry.track_count})</span>
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const {
    playlists,
    taglists,
    view,
    setView,
    scanning,
    setScanning,
    libraryFolder,
    draggingTrackId,
    setDraggingTrackId,
  } = usePlayerStore();
  const { refresh, scanLibrary } = useLibrary();
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingTaglist, setCreatingTaglist] = useState(false);
  const [newTaglistName, setNewTaglistName] = useState("");
  const [newTaglistKey, setNewTaglistKey] = useState<string>(COMMON_TAG_KEYS[0]);
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

  const chooseLibraryFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose library folder",
    });
    if (typeof selected !== "string") return;

    setScanning(true);
    try {
      await api.setLibraryFolder(selected);
      await refresh();
    } finally {
      setScanning(false);
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

  const createTaglist = async () => {
    const name = newTaglistName.trim();
    if (!name) return;
    await api.createTaglist(name, newTaglistKey);
    setNewTaglistName("");
    setCreatingTaglist(false);
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
            typeof view === "object" &&
            "playlistId" in view &&
            view.playlistId === playlist.id;
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

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
          Taglists
        </div>

        {taglists.map((taglist) => (
          <TaglistGroup
            key={taglist.id}
            taglist={taglist}
            view={view}
            setView={setView}
          />
        ))}

        {creatingTaglist ? (
          <div className="mt-2 space-y-2 px-2">
            <input
              autoFocus
              value={newTaglistName}
              onChange={(e) => setNewTaglistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createTaglist();
                if (e.key === "Escape") setCreatingTaglist(false);
              }}
              placeholder="Taglist name"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
            />
            <select
              value={newTaglistKey}
              onChange={(e) => setNewTaglistKey(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
            >
              {COMMON_TAG_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => void createTaglist()}
                className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500"
              >
                Create
              </button>
              <button
                onClick={() => setCreatingTaglist(false)}
                className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreatingTaglist(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-800/60 hover:text-white"
          >
            + New taglist
          </button>
        )}
      </nav>

      <div className="space-y-2 border-t border-neutral-800 p-3">
        <p
          className="truncate text-xs text-neutral-400"
          title={libraryFolder ?? undefined}
        >
          {libraryFolder ?? "No library folder chosen"}
        </p>
        <button
          onClick={() => void chooseLibraryFolder()}
          disabled={scanning}
          className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Choose library folder
        </button>
        <button
          type="button"
          onClick={() => void scanLibrary()}
          disabled={scanning || !libraryFolder}
          className="w-full rounded-md bg-neutral-800 px-3 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {scanning ? "Scanning…" : "Rescan library"}
        </button>
        <KeyboardShortcuts />
      </div>
    </aside>
  );
}
