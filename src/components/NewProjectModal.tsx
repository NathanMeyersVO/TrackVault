import { useCallback, useState } from "react";

import { DeliveryFolderDropZone } from "./DeliveryFolderDropZone";
import { DeliveryPreviewModal } from "./DeliveryPreviewModal";
import { useDeliveryFolderConfirm } from "../hooks/useDeliveryFolderConfirm";
import { getDeliveryCopy } from "../lib/applicationConfig";
import { APPLICATION_OPTIONS } from "../lib/applicationLabels";
import { api, type ApplicationId, type DeliveryPreview } from "../lib/tauri";
import { usePlayerStore } from "../store/playerStore";

export interface NewProjectModalProps {
  onClose: () => void;
  onProjectCreated: () => void;
}

export function NewProjectModal({ onClose, onProjectCreated }: NewProjectModalProps) {
  const [newName, setNewName] = useState("");
  const [applicationId, setApplicationId] = useState<ApplicationId>("usfs_ems");
  const [deliveryPreview, setDeliveryPreview] = useState<DeliveryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setDeliveryStaging = usePlayerStore((s) => s.setDeliveryStaging);

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

  const canStartDelivery = Boolean(newName.trim());

  const startCreateFromDelivery = () => {
    if (!newName.trim()) {
      setError("Enter a project name");
      return;
    }
    setError(null);
    void pickDeliveryFolderForCreate();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
        <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg border border-border bg-surface shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">New project</h2>
          </div>

          <div className="space-y-3 overflow-y-auto px-4 py-3">
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

      {deliveryFolderConfirmModal}

      {deliveryPreview && (
        <DeliveryPreviewModal
          preview={deliveryPreview}
          mode="create"
          projectName={newName.trim()}
          applicationId={applicationId}
          overlayClassName="z-[70]"
          onClose={() => setDeliveryPreview(null)}
          onApplied={() => {
            setDeliveryPreview(null);
            onProjectCreated();
          }}
        />
      )}
    </>
  );
}
