import { useTauriFolderDropZone } from "../hooks/useTauriFolderDropZone";

export interface DeliveryFolderDropZoneProps {
  label: string;
  enabled: boolean;
  onFolderDropped: (path: string) => void;
}

export function DeliveryFolderDropZone({
  label,
  enabled,
  onFolderDropped,
}: DeliveryFolderDropZoneProps) {
  const { ref, dragOver } = useTauriFolderDropZone({
    enabled,
    onFolderDropped,
  });

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
