import { useCallback } from "react";

import { isProjectArchivePath } from "../lib/projectArchive";
import { useTauriPathsDropZone } from "../hooks/useTauriPathsDropZone";

export interface ProjectArchiveDropZoneProps {
  label: string;
  enabled: boolean;
  onArchiveDropped: (path: string) => void;
  onInvalidDrop?: (message: string) => void;
}

export function ProjectArchiveDropZone({
  label,
  enabled,
  onArchiveDropped,
  onInvalidDrop,
}: ProjectArchiveDropZoneProps) {
  const onPathsDropped = useCallback(
    (paths: string[]) => {
      const path = paths[0];
      if (!path) return;
      if (!isProjectArchivePath(path)) {
        onInvalidDrop?.("Drop a .tvproject.zip project archive file.");
        return;
      }
      onArchiveDropped(path);
    },
    [onArchiveDropped, onInvalidDrop],
  );

  const { ref, dragOver } = useTauriPathsDropZone({ enabled, onPathsDropped });

  return (
    <div
      ref={ref}
      aria-disabled={!enabled}
      className={[
        "flex w-full items-center justify-center rounded-md border border-dashed px-3 py-2 text-sm transition-colors",
        enabled ? "border-border text-muted" : "pointer-events-none border-border/60 text-muted/50 opacity-40",
        enabled && dragOver ? "border-accent bg-accent/10 text-foreground" : "",
        enabled && !dragOver ? "hover:border-muted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </div>
  );
}
