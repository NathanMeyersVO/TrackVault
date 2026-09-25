import type { UploadResult } from "./tauri";

export function formatUploadResult(result: UploadResult): string {
  if (result.uploaded === 0 && result.errors.length === 0) {
    return "No tracks were uploaded.";
  }

  const parts: string[] = [];
  if (result.uploaded > 0) {
    parts.push(
      `Uploaded ${result.uploaded} track${result.uploaded === 1 ? "" : "s"}`,
    );
  }
  if (result.skipped > 0) {
    parts.push(
      `Skipped ${result.skipped} file${result.skipped === 1 ? "" : "s"}`,
    );
  }
  if (result.errors.length > 0) {
    parts.push(result.errors[0]);
  }
  return parts.join(". ");
}

export function formatProjectConflictMessage(conflicts: string[]): string {
  const preview = conflicts.slice(0, 5).join("\n");
  const remaining = conflicts.length - 5;
  const suffix = remaining > 0 ? `\n…and ${remaining} more.` : "";
  return `These files already exist in UPLOADED:\n${preview}${suffix}\n\nOverwrite the existing files, or keep both copies?`;
}

export function formatCollectionConflictMessage(conflicts: string[]): string {
  const preview = conflicts.slice(0, 5).join("\n");
  const remaining = conflicts.length - 5;
  const suffix = remaining > 0 ? `\n…and ${remaining} more.` : "";
  return `These files already exist in this stored collection:\n${preview}${suffix}\n\nOverwrite the existing files, or keep both copies?`;
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const last = normalized.split("/").pop();
  return last ?? path;
}
