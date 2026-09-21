import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  title?: string;
  separator?: false;
  children?: MenuItem[];
}

export interface MenuSeparator {
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return "separator" in entry && entry.separator === true;
}

function hasSubmenu(item: MenuItem): boolean {
  return item.children != null && item.children.length > 0;
}

const itemButtonClassName =
  "block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40";

const submenuPanelClassName =
  "absolute left-full top-0 z-40 ml-1 min-w-[12rem] rounded-md border border-border bg-surface py-1 shadow-lg";

function MenuItemRow({
  item,
  onCloseMenu,
}: {
  item: MenuItem;
  onCloseMenu: () => void;
}) {
  const [submenuOpen, setSubmenuOpen] = useState(false);

  const closeAndRun = (target: MenuItem) => {
    if (target.disabled) return;
    onCloseMenu();
    target.onClick?.();
  };

  if (hasSubmenu(item)) {
    return (
      <div
        className="relative"
        onMouseEnter={() => {
          if (!item.disabled) {
            setSubmenuOpen(true);
          }
        }}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <div
          role="menuitem"
          aria-haspopup="menu"
          aria-disabled={item.disabled || undefined}
          title={item.title}
          className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-foreground hover:bg-surface-hover ${
            item.disabled ? "cursor-not-allowed opacity-40" : ""
          }`}
        >
          <span className="min-w-0 truncate">{item.label}</span>
          <span aria-hidden="true" className="shrink-0 pl-2">
            ›
          </span>
        </div>
        {submenuOpen && !item.disabled && (
          <div role="menu" className={submenuPanelClassName}>
            {item.children!.map((child) => (
              <button
                key={child.label}
                type="button"
                role="menuitem"
                disabled={child.disabled ?? item.disabled}
                title={child.title}
                onClick={() => closeAndRun(child)}
                className={itemButtonClassName}
              >
                {child.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.title}
      onClick={() => closeAndRun(item)}
      className={itemButtonClassName}
    >
      {item.checked ? "✓ " : ""}
      {item.label}
    </button>
  );
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

  const closeMenu = () => setOpen(false);

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
              <MenuItemRow
                key={`${entry.label}-${index}`}
                item={entry}
                onCloseMenu={closeMenu}
              />
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
