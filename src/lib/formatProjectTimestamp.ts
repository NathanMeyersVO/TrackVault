import type { ProjectOrigin } from "./tauri";

export function formatProjectOriginLine(
  origin: ProjectOrigin,
  createdAtSec: number,
): string {
  const label = origin === "imported" ? "Imported" : "Created";
  const when = new Date(createdAtSec * 1000).toLocaleString();
  return `${label} ${when}`;
}
