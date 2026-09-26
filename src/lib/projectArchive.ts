export const PROJECT_ARCHIVE_EXTENSION = ".tvproject.zip";

export function isProjectArchivePath(path: string): boolean {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.toLowerCase().endsWith(PROJECT_ARCHIVE_EXTENSION);
}

export function projectArchiveFileName(projectName: string): string {
  const safeName = projectName.replace(/[^\w\s-]+/g, "").trim() || "project";
  return `${safeName}${PROJECT_ARCHIVE_EXTENSION}`;
}

export const PROJECT_ARCHIVE_DIALOG_FILTER = {
  name: "IceTrackVault project archive (.tvproject.zip)",
  extensions: ["zip"],
};
