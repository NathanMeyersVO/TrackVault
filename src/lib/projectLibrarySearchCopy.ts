export function formatProjectLibrarySearchSubtitle(
  searchLoading: boolean,
  globalHitCount: number,
): string {
  if (searchLoading) {
    return "Searching project library…";
  }
  return `${globalHitCount} match${globalHitCount === 1 ? "" : "es"} in project library taglists`;
}
