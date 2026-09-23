import { useCallback, useState } from "react";

import { DeliveryFolderConfirmModal } from "../components/DeliveryFolderConfirmModal";
import { getApplicationConfig, getDeliveryCopy } from "../lib/applicationConfig";
import { pickDeliveryFolder } from "../lib/pickDeliveryFolder";
import { api, type ApplicationId, type DeliveryFolderBrowseResult } from "../lib/tauri";

export function useDeliveryFolderConfirm(options: {
  applicationId: ApplicationId;
  onConfirm: (folderPath: string) => void | Promise<void>;
}) {
  const { applicationId, onConfirm } = options;
  const deliveryCopy = getDeliveryCopy(applicationId);
  const supportsScheduleDelivery =
    getApplicationConfig(applicationId).supportsScheduleDelivery;
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState<DeliveryFolderBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setBrowse(null);
    setError(null);
    setLoading(false);
  }, []);

  const loadFolder = useCallback(async (folder: string) => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setBrowse(null);
    try {
      setBrowse(await api.browseDeliveryFolder(folder));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const pickAndShow = useCallback(async () => {
    const folder = await pickDeliveryFolder(deliveryCopy.pickFolderDialogTitle);
    if (!folder) return;
    await loadFolder(folder);
  }, [deliveryCopy.pickFolderDialogTitle, loadFolder]);

  const chooseDifferent = useCallback(async () => {
    const folder = await pickDeliveryFolder(deliveryCopy.pickFolderDialogTitle);
    if (folder) await loadFolder(folder);
  }, [deliveryCopy.pickFolderDialogTitle, loadFolder]);

  const confirm = useCallback(
    (path: string) => {
      close();
      void onConfirm(path);
    },
    [close, onConfirm],
  );

  const modal = open ? (
    <DeliveryFolderConfirmModal
      title={deliveryCopy.confirmFolderModalTitle}
      supportsScheduleDelivery={supportsScheduleDelivery}
      browse={browse}
      loading={loading}
      error={error}
      onClose={close}
      onChooseDifferent={() => void chooseDifferent()}
      onConfirm={confirm}
    />
  ) : null;

  return { pickAndShow, loadFolder, modal };
}
