import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { ConfirmDialog } from "./ConfirmDialog";
import { ProjectArchiveDropZone } from "./ProjectArchiveDropZone";
import { useProject } from "../hooks/usePlayer";
import {
  PROJECT_ARCHIVE_DIALOG_FILTER,
  isProjectArchivePath,
} from "../lib/projectArchive";
import { api, type ProjectSummary } from "../lib/tauri";

export interface ImportProjectArchiveModalProps {
  onClose: () => void;
  onProjectsChanged: () => void | Promise<void>;
  onProjectOpened: () => void;
}

export function ImportProjectArchiveModal({
  onClose,
  onProjectsChanged,
  onProjectOpened,
}: ImportProjectArchiveModalProps) {
  const [importOpenTarget, setImportOpenTarget] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [importingArchive, setImportingArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useProject();

  const canImportArchive = !busy && !importingArchive;

  const importProjectArchiveFromPath = useCallback(
    async (source: string) => {
      if (!isProjectArchivePath(source)) {
        setError("Choose a .tvproject.zip project archive file.");
        return;
      }
      setImportingArchive(true);
      setError(null);
      try {
        const imported = await api.importProjectArchive(source);
        await onProjectsChanged();
        setImportOpenTarget(imported);
      } catch (e) {
        setError(String(e));
      } finally {
        setImportingArchive(false);
      }
    },
    [onProjectsChanged],
  );

  const importProjectArchive = async () => {
    const source = await open({
      title: "Import project archive",
      multiple: false,
      filters: [PROJECT_ARCHIVE_DIALOG_FILTER],
    });
    if (typeof source !== "string") return;
    await importProjectArchiveFromPath(source);
  };

  const openImportedProject = async (project: ProjectSummary) => {
    setBusy(true);
    try {
      await api.openProject(project.id);
      await refresh();
      setImportOpenTarget(null);
      onClose();
      onProjectOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
        <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Import from archive</h2>
          </div>

          <div className="space-y-3 px-4 py-3">
            <p className="text-xs text-muted">
              Restore a saved project as a new copy (.tvproject.zip).
            </p>
            <button
              type="button"
              disabled={!canImportArchive}
              onClick={() => void importProjectArchive()}
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-hover disabled:opacity-40"
            >
              {importingArchive ? "Importing…" : "Import project archive…"}
            </button>
            <ProjectArchiveDropZone
              label="Drop project archive (.tvproject.zip) here"
              enabled={canImportArchive}
              onArchiveDropped={(path) => void importProjectArchiveFromPath(path)}
              onInvalidDrop={(message) => setError(message)}
            />
          </div>

          {error && (
            <p className="border-t border-border px-4 py-2 text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {importOpenTarget && (
        <ConfirmDialog
          title="Project imported"
          message={`"${importOpenTarget.name}" was imported as a new project (${importOpenTarget.track_count} tracks). Open it now?`}
          confirmLabel="Open project"
          cancelLabel="Not now"
          busy={busy}
          overlayClassName="z-[70]"
          onConfirm={() => void openImportedProject(importOpenTarget)}
          onCancel={() => {
            setImportOpenTarget(null);
            onClose();
          }}
        />
      )}
    </>
  );
}
