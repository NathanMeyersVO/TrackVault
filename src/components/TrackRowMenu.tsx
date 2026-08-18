import { useEffect, useRef, useState } from "react";

interface TrackRowMenuProps {
  onEditTags: () => void;
}

export function TrackRowMenu({ onEditTags }: TrackRowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Track actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[9rem] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(false);
              onEditTags();
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800"
          >
            Edit tags…
          </button>
        </div>
      )}
    </div>
  );
}
