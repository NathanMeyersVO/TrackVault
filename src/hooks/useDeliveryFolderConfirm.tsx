import { useCallback, useState } from "react";

import { DeliveryFolderConfirmModal } from "../components/DeliveryFolderConfirmModal";
import { pickDeliveryFolder } from "../lib/pickDeliveryFolder";
import { api, type DeliveryFolderBrowseResult } from "../lib/tauri";

export function useDeliveryFolderConfirm(options: {
  onConfirm: (folderPath: string) => void | Promise<void>;
}) {
  const { onConfirm } = options;
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
    const folder = await pickDeliveryFolder();
    if (!folder) return;
    await loadFolder(folder);
  }, [loadFolder]);

  const chooseDifferent = useCallback(async () => {
    const folder = await pickDeliveryFolder();
    if (folder) await loadFolder(folder);
  }, [loadFolder]);

  const confirm = useCallback(
    (path: string) => {
      close();
      void onConfirm(path);
    },
    [close, onConfirm],
  );

  const modal = open ? (
    <DeliveryFolderConfirmModal
      browse={browse}
      loading={loading}
      error={error}
      onClose={close}
      onChooseDifferent={() => void chooseDifferent()}
      onConfirm={confirm}
    />
  ) : null;

  return { pickAndShow, modal };
}
