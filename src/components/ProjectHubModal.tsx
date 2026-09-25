import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeliveryFolderDropZone } from "./DeliveryFolderDropZone";
import { DeliveryPreviewModal } from "./DeliveryPreviewModal";
import { ProjectArchiveDropZone } from "./ProjectArchiveDropZone";
import { useDeliveryFolderConfirm } from "../hooks/useDeliveryFolderConfirm";
import { useProjectUiReset } from "../hooks/useProjectUiReset";
import { useProject } from "../hooks/usePlayer";
import { usePlayerStore } from "../store/playerStore";
import { getDeliveryCopy } from "../lib/applicationConfig";
import { APPLICATION_OPTIONS, getApplicationLabel } from "../lib/applicationLabels";
import {
  PROJECT_ARCHIVE_DIALOG_FILTER,
  isProjectArchivePath,
} from "../lib/projectArchive";
import { formatProjectOriginLine } from "../lib/formatProjectTimestamp";
import { api, type ApplicationId, type DeliveryPreview, type ProjectSummary } from "../lib/tauri";

export interface ProjectHubModalProps {
  onClose: () => void;
}

export function ProjectHubModal({ onClose }: ProjectHubModalProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [applicationId, setApplicationId] = useState<ApplicationId>("usfs_ems");
  const [deliveryPreview, setDeliveryPreview] = useState<DeliveryPreview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [importOpenTarget, setImportOpenTarget] = useState<ProjectSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [importingArchive, setImportingArchive] = useState(false);
  const setDeliveryStaging = usePlayerStore((s) => s.setDeliveryStaging);
  const { refresh } = useProject();
  const { resetProjectUi } = useProjectUiReset();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stageFromFolder = useCallback(
    async (folder: string) => {
      setDeliveryStaging(true, applicationId);
      setError(null);
      try {
        const preview = await api.stageDelivery([folder], null, applicationId);
        setDeliveryPreview(preview);
      } catch (e) {
        setError(String(e));
      } finally {
        setDeliveryStaging(false);
      }
    },
    [applicationId, setDeliveryStaging],
  );

  const deliveryCopy = getDeliveryCopy(applicationId);

  const {
    pickAndShow: pickDeliveryFolderForCreate,
    loadFolder: loadDeliveryFolderForCreate,
    modal: deliveryFolderConfirmModal,
  } = useDeliveryFolderConfirm({ applicationId, onConfirm: stageFromFolder });

  const canStartDelivery = Boolean(newName.trim()) && !busy;
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
        await reload();
        setImportOpenTarget(imported);
      } catch (e) {
        setError(String(e));
      } finally {
        setImportingArchive(false);
      }
    },
    [reload],
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
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startCreateFromDelivery = () => {
    if (!newName.trim()) {
      setError("Enter a project name");
      return;
    }
    setError(null);
    void pickDeliveryFolderForCreate();
  };

  const openProject = async (id: string) => {
    setBusy(true);
    try {
      await api.openProject(id);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const activeProjectId = usePlayerStore((s) => s.activeProject?.id);

  const changeProjectApplication = async (project: ProjectSummary, next: ApplicationId) => {
    if (project.application_id === next) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateProjectApplication(project.id, next);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    const wasActive = deletedId === activeProjectId;
    setBusy(true);
    try {
      const playback = await api.deleteProject(deletedId);
      if (wasActive) {
        resetProjectUi(playback);
      }
      setDeleteTarget(null);
      await refresh();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Projects</h2>
          </div>

          <div className="space-y-3 border-b border-border px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              New project
            </h3>
            <p className="text-xs text-muted">{deliveryCopy.createProjectHint}</p>
            <label className="block text-xs text-muted">
              Project name
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                placeholder="e.g. 2026 Regionals EMS"
              />
            </label>
            <label className="block text-xs text-muted">
              Application
              <select
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value as ApplicationId)}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {APPLICATION_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!canStartDelivery}
              onClick={() => void startCreateFromDelivery()}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-40"
            >
              {deliveryCopy.importButton}
            </button>
            <DeliveryFolderDropZone
              label={deliveryCopy.createProjectDropZoneLabel}
              enabled={canStartDelivery}
              onFolderDropped={(path) => void loadDeliveryFolderForCreate(path)}
            />
          </div>

          <div className="space-y-3 border-b border-border px-4 py-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Import from archive
            </h3>
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

          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-foreground">
              Open existing project
            </h3>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : projects.length === 0 ? (
                <p className="text-xs text-muted">No projects yet.</p>
              ) : (
                <ul className="space-y-1">
                  {projects.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2 rounded border border-border px-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {p.name}
                          {activeProjectId === p.id ? (
                            <span className="ml-1.5 text-xs font-normal text-muted">(open)</span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted">
                          {formatProjectOriginLine(p.origin, p.created_at)}
                          {" · "}
                          {p.track_count} tracks ·{" "}
                          {getApplicationLabel(
                            p.application_id === "usfs_ems" ? "usfs_ems" : "none",
                          )}
                        </div>
                        <label className="mt-1.5 block text-xs text-muted">
                          Application
                          <select
                            value={p.application_id === "usfs_ems" ? "usfs_ems" : "none"}
                            disabled={busy}
                            onChange={(e) =>
                              void changeProjectApplication(
                                p,
                                e.target.value as ApplicationId,
                              )
                            }
                            className="mt-0.5 w-full max-w-xs rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
                          >
                            {APPLICATION_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="flex shrink-0 gap-1 self-end sm:self-center">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void openProject(p.id)}
                          className="rounded px-2 py-1 text-xs text-accent hover:bg-surface-hover"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeleteTarget(p)}
                          className="rounded px-2 py-1 text-xs text-red-400 hover:bg-surface-hover"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
              Close
            </button>
          </div>
        </div>
      </div>

      {deliveryFolderConfirmModal}

      {deliveryPreview && (
        <DeliveryPreviewModal
          preview={deliveryPreview}
          mode="create"
          projectName={newName.trim()}
          applicationId={applicationId}
          onClose={() => setDeliveryPreview(null)}
          onApplied={() => {
            setDeliveryPreview(null);
            onClose();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete project"
          message={`Delete "${deleteTarget.name}" and all its audio and playlists from this computer? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {importOpenTarget && (
        <ConfirmDialog
          title="Project imported"
          message={`"${importOpenTarget.name}" was imported as a new project (${importOpenTarget.track_count} tracks). Open it now?`}
          confirmLabel="Open project"
          cancelLabel="Not now"
          busy={busy}
          onConfirm={() => void openImportedProject(importOpenTarget)}
          onCancel={() => setImportOpenTarget(null)}
        />
      )}
    </>
  );
}
