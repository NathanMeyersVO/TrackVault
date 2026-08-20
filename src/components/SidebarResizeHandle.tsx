import { useState, type MouseEvent } from "react";

interface SidebarResizeHandleProps {
  width: number;
  onResizeStart: (clientX: number) => void;
}

export function SidebarResizeHandle({
  width,
  onResizeStart,
}: SidebarResizeHandleProps) {
  const [active, setActive] = useState(false);

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(true);
    onResizeStart(event.clientX);

    const onMouseUp = () => {
      setActive(false);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={180}
      aria-valuemax={480}
      aria-label="Resize sidebar"
      onMouseDown={handleMouseDown}
      className={`w-1 shrink-0 cursor-col-resize touch-none ${
        active ? "bg-neutral-600" : "bg-neutral-800 hover:bg-neutral-700"
      }`}
    />
  );
}
