import { useCallback, useEffect, useRef, useState, type Dispatch, type DragEvent, type KeyboardEvent, type MouseEvent, type SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

import { ConfirmDialog } from "./ConfirmDialog";
import { api, COMMON_TAG_KEYS, type Playlist, type Taglist, type TaglistValue } from "../lib/tauri";
import { formatTaglistLabel } from "../lib/taglistLabels";
import {
  getSublistReorderDragData,
  getTrackDragData,
  isSublistReorderDrag,
  reorderItemsByIndex,
  setSublistReorderDragData,
} from "../lib/dragDrop";
import { useLibrary } from "../hooks/usePlayer";
import { useTagDropConfirm } from "../hooks/useTagDropConfirm";
import { usePlayerStore, type View } from "../store/playerStore";

interface TaglistDropTarget {
  taglistId: number;
  value: string | null;
}

function taglistDropTargetKey(taglistId: number, value: string | null): string {
  return `${taglistId}:${value ?? "NO-TAG"}`;
}

function SublistGripIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <circle cx="5" cy="4" r="1.2" />
      <circle cx="11" cy="4" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="11" cy="12" r="1.2" />
    </svg>
  );
}

function TaglistGroup({
  taglist,
  view,
  setView,
  isTrackDragging,
  draggingTrackId,
  dragOverTarget,
  setDragOverTarget,
  setDraggingTrackId,
  onTagDrop,
}: {
  taglist: Taglist;
  view: View;
  setView: (view: View) => void;
  isTrackDragging: boolean;
  draggingTrackId: number | null;
  dragOverTarget: TaglistDropTarget | null;
  setDragOverTarget: Dispatch<SetStateAction<TaglistDropTarget | null>>;
  setDraggingTrackId: (trackId: number | null) => void;
  onTagDrop: (trackId: number, taglist: Taglist, entry: TaglistValue) => void;
}) {
  const { refresh } = useLibrary();
  const [values, setValues] = useState<TaglistValue[]>([]);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);
  const skipBlurSaveRef = useRef(false);

  const taggedValues = values.filter((entry) => entry.value != null);
  const noTagEntry = values.find((entry) => entry.value == null);

  const clearReorderState = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

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

  const handleSublistReorder = async (orderedValues: TaglistValue[]) => {
    const nextValues = [...orderedValues];
    if (noTagEntry) nextValues.push(noTagEntry);
    setValues(nextValues);
    try {
      await api.reorderTaglistValues(
        taglist.id,
        orderedValues.map((entry) => entry.value!),
      );
    } catch (error) {
      console.error(error);
      loadValues();
    }
  };

  const handleSublistDrop = (
    targetIndex: number,
    event: DragEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (dragIndex == null && !isSublistReorderDrag(event.dataTransfer)) {
      clearReorderState();
      return;
    }

    const fromIndex = dragIndex ?? getSublistReorderDragData(event.dataTransfer);
    if (fromIndex == null || fromIndex === targetIndex) {
      clearReorderState();
      return;
    }

    const row = event.currentTarget.getBoundingClientRect();
    const position: "before" | "after" =
      event.clientY < row.top + row.height / 2 ? "before" : "after";
    const reordered = reorderItemsByIndex(
      taggedValues,
      fromIndex,
      targetIndex,
      position,
    );
    void handleSublistReorder(reordered);
    clearReorderState();
  };

  const renderSublistRow = (
    entry: TaglistValue,
    index: number,
    reorderable: boolean,
  ) => {
    const label = formatTaglistLabel(entry.value, entry.display_title);
    const rowKey = entry.value ?? "NO-TAG";
    const active =
      typeof view === "object" &&
      "taglistId" in view &&
      view.taglistId === taglist.id &&
      view.value === entry.value;
    const isEditing = entry.value != null && editingValue === entry.value;
    const isDragging = reorderable && dragIndex === index;
    const dropIndicator =
      reorderable && dropTarget?.index === index ? dropTarget.position : null;

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
          <span className="shrink-0 text-sm text-muted">{entry.value} -</span>
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
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </div>
      );
    }

    const isDragOver =
      dragOverTarget?.taglistId === taglist.id &&
      dragOverTarget.value === entry.value;

    const handleDrop = (event: DragEvent) => {
      if (isSublistReorderDrag(event.dataTransfer)) {
        if (reorderable) handleSublistDrop(index, event);
        return;
      }

      event.preventDefault();
      setDragOverTarget(null);
      setDraggingTrackId(null);

      const trackId = draggingTrackId ?? getTrackDragData(event.dataTransfer);
      if (trackId == null) return;

      onTagDrop(trackId, taglist, entry);
    };

    const dropBarClass =
      dropIndicator === "before"
        ? "border-t-2 border-t-drop"
        : dropIndicator === "after"
          ? "border-b-2 border-b-drop"
          : "";
    const stateClass = dropIndicator
      ? ""
      : isDragOver
        ? "border-2 border-accent bg-accent-subtle/40 text-foreground ring-2 ring-accent"
        : isTrackDragging
          ? "border border-dashed border-border bg-surface-hover/50 text-foreground"
          : active
            ? "border border-transparent bg-surface-hover text-foreground"
            : "border border-transparent text-foreground hover:bg-surface-hover/60";

    return (
      <div
        key={rowKey}
        role="button"
        tabIndex={0}
        onClick={handleNavigate}
        onKeyDown={handleKeyDown}
        onDragOver={(event) => {
          if (
            reorderable &&
            (dragIndex != null || isSublistReorderDrag(event.dataTransfer))
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const row = event.currentTarget.getBoundingClientRect();
            const position: "before" | "after" =
              event.clientY < row.top + row.height / 2 ? "before" : "after";
            setDropTarget({ index, position });
            return;
          }
          if (!isTrackDragging) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOverTarget({ taglistId: taglist.id, value: entry.value });
        }}
        onDragEnter={(event) => {
          if (
            reorderable &&
            (dragIndex != null || isSublistReorderDrag(event.dataTransfer))
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!isTrackDragging) return;
          event.preventDefault();
          setDragOverTarget({ taglistId: taglist.id, value: entry.value });
        }}
        onDragLeave={(event) => {
          if (
            reorderable &&
            (dragIndex != null || isSublistReorderDrag(event.dataTransfer))
          ) {
            if (event.currentTarget.contains(event.relatedTarget as Node)) return;
            setDropTarget((current) =>
              current?.index === index ? null : current,
            );
            return;
          }
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          const key = taglistDropTargetKey(taglist.id, entry.value);
          setDragOverTarget((current) =>
            current &&
            taglistDropTargetKey(current.taglistId, current.value) === key
              ? null
              : current,
          );
        }}
        onDrop={handleDrop}
        className={`group/sublist mb-0.5 flex w-full items-center rounded-md py-1.5 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-muted ${
          reorderable ? "pl-2" : "pl-6"
        } ${dropBarClass} ${isDragging ? "opacity-40" : ""} ${stateClass}`}
      >
        {reorderable && entry.value != null ? (
          <button
            type="button"
            draggable
            aria-label={`Reorder ${label}`}
            className="mr-1 flex shrink-0 cursor-grab items-center justify-center rounded p-0.5 text-muted hover:bg-surface-hover hover:text-foreground active:cursor-grabbing"
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.stopPropagation();
              setSublistReorderDragData(event.dataTransfer, index);
              setDragIndex(index);
            }}
            onDragEnd={() => clearReorderState()}
          >
            <SublistGripIcon />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          <span className="truncate">{label}</span>
          <span className="ml-1 text-muted">({entry.track_count})</span>
        </span>
        {entry.value != null && (
          <button
            type="button"
            onClick={(event) => startEditing(event, entry.value!, entry.display_title)}
            className="ml-1 hidden shrink-0 rounded px-1 text-xs text-muted hover:text-foreground group-hover/sublist:inline"
            title="Edit title"
          >
            ✎
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="mb-2">
      <div className="group flex items-center justify-between px-3 py-1">
        <span className="truncate text-xs font-medium text-muted">
          {taglist.name}
        </span>
        <div className="hidden group-hover:inline">
          <button
            type="button"
            onClick={(event) => void importTitles(event)}
            className="rounded px-1 text-xs text-muted hover:text-foreground"
            title="Import titles"
          >
            Titles
          </button>
          <button
            type="button"
            onClick={(event) => void deleteTaglist(event)}
            className="rounded px-1 text-xs text-muted hover:text-red-400"
            title="Delete taglist"
          >
            ×
          </button>
        </div>
      </div>
      {taggedValues.map((entry, index) => renderSublistRow(entry, index, true))}
      {noTagEntry ? renderSublistRow(noTagEntry, taggedValues.length, false) : null}
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
  const [dragOverTaglistTarget, setDragOverTaglistTarget] =
    useState<TaglistDropTarget | null>(null);
  const [pendingDeletePlaylist, setPendingDeletePlaylist] = useState<Playlist | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);
  const { requestTagDrop, confirmDialog: tagDropConfirmDialog } = useTagDropConfirm();

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
      className="flex shrink-0 flex-col bg-surface"
      style={{ width }}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Browse</h2>
        <p className="text-xs text-muted">Library, playlists & taglists</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <button
          onClick={() => setView("library")}
          className={`mb-1 w-full rounded-md px-3 py-2 text-left text-sm ${
            isLibraryActive
              ? "bg-surface-hover text-foreground"
              : "text-foreground hover:bg-surface-hover/60"
          }`}
        >
          Library
        </button>

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-muted">
          {isTrackDragging ? "Drop on a playlist or taglist" : "Playlists"}
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
              className={`group/playlist mb-1 flex w-full items-center rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-muted ${
                isDragOver
                  ? "border-2 border-accent bg-accent-subtle/40 text-foreground ring-2 ring-accent"
                  : isTrackDragging
                    ? "border border-dashed border-border bg-surface-hover/50 text-foreground"
                    : active
                      ? "border border-transparent bg-surface-hover text-foreground"
                      : "border border-transparent text-foreground hover:bg-surface-hover/60"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">
                {playlist.name}
                <span className="ml-1 text-muted">({playlist.track_count})</span>
              </span>
              <button
                type="button"
                onClick={(event) => requestDeletePlaylist(event, playlist)}
                className="ml-1 hidden shrink-0 rounded px-1 text-xs text-muted hover:text-red-400 group-hover/playlist:inline"
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
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={createPlaylist}
                className="rounded-md bg-accent px-2 py-1 text-xs text-foreground hover:bg-accent-hover"
              >
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-hover/60 hover:text-foreground"
          >
            + New playlist
          </button>
        )}

        <div className="mb-2 mt-4 px-3 text-xs font-medium uppercase tracking-wide text-muted">
          {isTrackDragging ? "Drop on a taglist sublist" : "Taglists"}
        </div>

        {taglists.map((taglist) => (
          <TaglistGroup
            key={taglist.id}
            taglist={taglist}
            view={view}
            setView={setView}
            isTrackDragging={isTrackDragging}
            draggingTrackId={draggingTrackId}
            dragOverTarget={dragOverTaglistTarget}
            setDragOverTarget={setDragOverTaglistTarget}
            setDraggingTrackId={setDraggingTrackId}
            onTagDrop={(trackId, droppedTaglist, entry) => {
              void requestTagDrop(trackId, droppedTaglist, entry);
            }}
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
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <select
              value={newTaglistKey}
              onChange={(e) => setNewTaglistKey(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
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
                className="rounded-md bg-accent px-2 py-1 text-xs text-foreground hover:bg-accent-hover"
              >
                Create
              </button>
              <button
                onClick={() => setCreatingTaglist(false)}
                className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreatingTaglist(true)}
            className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-hover/60 hover:text-foreground"
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
      {tagDropConfirmDialog}
    </aside>
  );
}
