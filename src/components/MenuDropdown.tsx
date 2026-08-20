import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: false;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry && entry.separator === true;
}

interface MenuDropdownProps {
  label: string;
  items: MenuEntry[];
}

export function MenuDropdown({ label, items }: MenuDropdownProps) {
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

  const closeAndRun = (item: MenuItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onClick();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[12rem] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
        >
          {items.map((entry, index) => {
            if (isSeparator(entry)) {
              return (
                <div
                  key={`sep-${index}`}
                  role="separator"
                  className="my-1 border-t border-neutral-700"
                />
              );
            }

            return (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                onClick={() => closeAndRun(entry)}
                className="block w-full px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MenuBarStatus({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`min-w-0 truncate text-xs ${className}`}
      title={typeof children === "string" ? children : undefined}
    >
      {children}
    </p>
  );
}
