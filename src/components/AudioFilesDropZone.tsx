import { useCallback } from "react";

import { filterAudioPaths } from "../lib/audioExtensions";
import { useTauriPathsDropZone } from "../hooks/useTauriPathsDropZone";

export interface AudioFilesDropZoneProps {
  label: string;
  enabled: boolean;
  multiple?: boolean;
  onAudioPathsDropped: (paths: string[]) => void;
  onRejected?: () => void;
}

export function AudioFilesDropZone({
  label,
  enabled,
  multiple = true,
  onAudioPathsDropped,
  onRejected,
}: AudioFilesDropZoneProps) {
  const handlePaths = useCallback(
    (paths: string[]) => {
      const audio = filterAudioPaths(paths);
      if (audio.length === 0) {
        onRejected?.();
        return;
      }
      onAudioPathsDropped(multiple ? audio : [audio[0]]);
    },
    [multiple, onAudioPathsDropped, onRejected],
  );

  const { ref, dragOver } = useTauriPathsDropZone({
    enabled,
    onPathsDropped: handlePaths,
  });

  return (
    <div
      ref={ref}
      aria-disabled={!enabled}
      className={[
        "flex w-full items-center justify-center rounded-md border border-dashed px-3 py-6 text-sm transition-colors",
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
