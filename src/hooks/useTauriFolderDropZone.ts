import { useCallback } from "react";

import { useTauriPathsDropZone } from "./useTauriPathsDropZone";

export function useTauriFolderDropZone(options: {
  enabled: boolean;
  onFolderDropped: (path: string) => void;
}) {
  const { enabled, onFolderDropped } = options;

  const onPathsDropped = useCallback(
    (paths: string[]) => {
      if (paths.length > 0) onFolderDropped(paths[0]);
    },
    [onFolderDropped],
  );

  return useTauriPathsDropZone({ enabled, onPathsDropped });
}
