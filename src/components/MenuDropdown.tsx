import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  checked?: boolean;
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
        className="rounded px-2 py-1 text-sm text-foreground hover:bg-surface-hover hover:text-foreground"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[12rem] rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {items.map((entry, index) => {
            if (isSeparator(entry)) {
              return (
                <div
                  key={`sep-${index}`}
                  role="separator"
                  className="my-1 border-t border-border"
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
                className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {entry.checked ? "✓ " : ""}
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
