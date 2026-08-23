export function sidebarCollectionId(collectionId: number): string {
  return `sidebar-collection-${collectionId}`;
}

export function sidebarPlaylistId(playlistId: number): string {
  return `sidebar-playlist-${playlistId}`;
}

export function sidebarSublistId(
  taglistId: number,
  value: string | null,
): string {
  return `sidebar-sublist-${taglistId}-${value ?? "none"}`;
}

export function scrollSidebarItem(elementId: string): void {
  requestAnimationFrame(() => {
    document.getElementById(elementId)?.scrollIntoView({ block: "nearest" });
  });
}
