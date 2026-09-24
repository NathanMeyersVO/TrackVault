import { open } from "@tauri-apps/plugin-dialog";

import { getDeliveryCopy } from "./applicationConfig";
import { api } from "./tauri";

/** Pick a folder that may contain audio archives and/or an event schedule spreadsheet. */
export async function pickDeliveryFolder(dialogTitle?: string): Promise<string | null> {
  let defaultPath: string | undefined;
  try {
    defaultPath = (await api.getLastDeliveryFolder()) ?? undefined;
  } catch {
    defaultPath = undefined;
  }
  const title = dialogTitle ?? getDeliveryCopy("none").pickFolderDialogTitle;
  const selected = await open({
    directory: true,
    multiple: false,
    title,
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}
