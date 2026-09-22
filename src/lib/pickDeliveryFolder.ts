import { open } from "@tauri-apps/plugin-dialog";

import { api } from "./tauri";

/** Pick a vendor folder that may contain audio archives and/or an event schedule spreadsheet. */
export async function pickDeliveryFolder(): Promise<string | null> {
  let defaultPath: string | undefined;
  try {
    defaultPath = (await api.getLastDeliveryFolder()) ?? undefined;
  } catch {
    defaultPath = undefined;
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select vendor delivery folder",
    defaultPath,
  });
  return typeof selected === "string" ? selected : null;
}