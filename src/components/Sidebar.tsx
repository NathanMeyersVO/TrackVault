import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { ConfirmDialog } from "./ConfirmDialog";
import { api, COMMON_TAG_KEYS, type Playlist, type Taglist, type TaglistValue } from "../lib/tauri";
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
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const skipBlurSaveRef = useRef(false);

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

  const startEditing = (event: MouseEvent, tagValue: string, displayTitle?: string | null) => {
    event.stopPropagation();
    setEditingValue(tagValue);
    setEditTitle(displayTitle ?? "");
  };

  const cancelEditing = () => {
    skipBlurSaveRef.current = true;
    setEditingValue(null);
    setEditTitle("");
  };

  const saveTitle = async (tagValue: string) => {
    const trimmed = editTitle.trim();
    try {
      await api.setTaglistValueTitle(taglist.id, tagValue, trimmed || null);
      loadValues();
    } catch (error) {
      console.error(error);
    } finally {
      cancelEditing();
    }
  };

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
        const isEditing = entry.value != null && editingValue === entry.value;

        const handleNavigate = () => {
          if (isEditing) return;
          setView({ taglistId: taglist.id, value: entry.value });
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
          if (isEditing) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleNavigate();
          }
        };

        if (isEditing && entry.value != null) {
          return (
            <div
              key={rowKey}
              className="mb-0.5 flex items-center gap-1 rounded-md py-1 pl-6 pr-2"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="shrink-0 text-sm text-neutral-400">{entry.value} -</span>
              <input
                autoFocus
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveTitle(entry.value!);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditing();
                  }
                }}
                onBlur={() => {
                  if (skipBlurSaveRef.current) {
                    skipBlurSaveRef.current = false;
                    return;
                  }
                  void saveTitle(entry.value!);
                }}
                placeholder="Display title"
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
              />
            </div>
          );
        }

        return (
          <div
            key={rowKey}
            role="button"
            tabIndex={0}
            onClick={handleNavigate}
            onKeyDown={handleKeyDown}
            className={`group/sublist mb-0.5 w-full rounded-md py-1.5 pl-6 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 ${
              active
                ? "bg-neutral-800 text-white"
                : "text-neutral-300 hover:bg-neutral-800/60"
            }`}
          >
            <span className="truncate">{label}</span>
            <span className="ml-1 text-neutral-500">({entry.track_count})</span>
            {entry.value != null && (
              <button
                type="button"
                onClick={(event) => startEditing(event, entry.value!, entry.display_title)}
                className="ml-1 hidden rounded px-1 text-xs text-neutral-500 hover:text-white group-hover/sublist:inline"
                title="Edit title"
              >
                ✎
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar({ width }: { width: number }) {
  const {
    playlists,
    taglists,
    view,
    setView,
    draggingTrackId,
    setDraggingTrackId,
  } = usePlayerStore();
  const { refresh } = useLibrary();
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingTaglist, setCreatingTaglist] = useState(false);
  const [newTaglistName, setNewTaglistName] = useState("");
  const [newTaglistKey, setNewTaglistKey] = useState<string>(COMMON_TAG_KEYS[0]);
  const [dragOverPlaylistId, setDragOverPlaylistId] = useState<number | null>(null);
  const [pendingDeletePlaylist, setPendingDeletePlaylist] = useState<Playlist | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);

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

  const requestDeletePlaylist = (event: MouseEvent, playlist: Playlist) => {
    event.stopPropagation();
    setPendingDeletePlaylist(playlist);
  };

  const cancelDeletePlaylist = () => {
    if (deletingPlaylist) return;
    setPendingDeletePlaylist(null);
  };

  const confirmDeletePlaylist = async () => {
    if (!pendingDeletePlaylist) return;

    setDeletingPlaylist(true);
    try {
      await api.deletePlaylist(pendingDeletePlaylist.id);
      if (
        typeof view === "object" &&
        "playlistId" in view &&
        view.playlistId === pendingDeletePlaylist.id
      ) {
        setView("library");
      }
      await refresh();
      setPendingDeletePlaylist(null);
    } catch (error) {
      console.error(error);
    } finally {
      setDeletingPlaylist(false);
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
    <aside
      className="flex shrink-0 flex-col bg-neutral-900"
      style={{ width }}
    >
      <div className="border-b border-neutral-800 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-white">Browse</h2>
        <p className="text-xs text-neutral-500">Library, playlists & taglists</p>
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
              className={`group/playlist mb-1 flex w-full items-center rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 ${
                isDragOver
                  ? "border-2 border-blue-500 bg-blue-950/40 text-white ring-2 ring-blue-500"
                  : isTrackDragging
                    ? "border border-dashed border-neutral-600 bg-neutral-800/50 text-neutral-200"
                    : active
                      ? "border border-transparent bg-neutral-800 text-white"
                      : "border border-transparent text-neutral-300 hover:bg-neutral-800/60"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">
                {playlist.name}
                <span className="ml-1 text-neutral-500">({playlist.track_count})</span>
              </span>
              <button
                type="button"
                onClick={(event) => requestDeletePlaylist(event, playlist)}
                className="ml-1 hidden shrink-0 rounded px-1 text-xs text-neutral-500 hover:text-red-400 group-hover/playlist:inline"
                title="Delete playlist"
              >
                ×
              </button>
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

      {pendingDeletePlaylist ? (
        <ConfirmDialog
          title="Delete playlist"
          message={`Delete "${pendingDeletePlaylist.name}"? This will remove the playlist but not the tracks.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          busy={deletingPlaylist}
          onConfirm={() => void confirmDeletePlaylist()}
          onCancel={cancelDeletePlaylist}
        />
      ) : null}
    </aside>
  );
}
