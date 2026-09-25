export const SWAP_FILE_NAME_KEY = "__fileName__";
export const SWAP_PROJECT_PATHS_KEY = "__projectPaths__";

export function swapSelectionState(keys: string[], selected: Set<string>) {
  if (keys.length === 0) {
    return { all: false, some: false };
  }
  let count = 0;
  for (const key of keys) {
    if (selected.has(key)) count += 1;
  }
  return {
    all: count === keys.length,
    some: count > 0 && count < keys.length,
  };
}

export function swapTagKeysForCommit(
  selected: Set<string>,
  lockedPartitionKey: string,
  existingTagKeys: string[],
): string[] {
  const keys = [...selected];
  if (
    existingTagKeys.includes(lockedPartitionKey) &&
    !keys.includes(lockedPartitionKey)
  ) {
    keys.push(lockedPartitionKey);
  }
  return keys;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
