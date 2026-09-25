let lockCount = 0;

export function lockDocumentTextSelection(): void {
  if (lockCount === 0) {
    document.body.style.userSelect = "none";
  }
  lockCount += 1;
}

export function unlockDocumentTextSelection(): void {
  if (lockCount <= 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.removeProperty("user-select");
  }
}

/** @internal Test helper */
export function resetDocumentTextSelectionLockForTests(): void {
  lockCount = 0;
  document.body.style.removeProperty("user-select");
}

/** @internal Test helper */
export function documentTextSelectionLockCount(): number {
  return lockCount;
}
