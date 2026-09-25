export function formatProjectSearchSubtitle(
  searchLoading: boolean,
  globalHitCount: number,
): string {
  if (searchLoading) {
    return "Searching project…";
  }
  return `${globalHitCount} match${globalHitCount === 1 ? "" : "es"} in project taglists`;
}
