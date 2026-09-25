import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  documentTextSelectionLockCount,
  lockDocumentTextSelection,
  resetDocumentTextSelectionLockForTests,
  unlockDocumentTextSelection,
} from "./documentTextSelectionLock";

function installDocumentStub() {
  const style: { userSelect: string; removeProperty: (prop: string) => void } = {
    userSelect: "",
    removeProperty(prop: string) {
      if (prop === "user-select") {
        this.userSelect = "";
      }
    },
  };
  vi.stubGlobal("document", { body: { style } });
  return style;
}

describe("documentTextSelectionLock", () => {
  let bodyStyle: ReturnType<typeof installDocumentStub>;

  beforeEach(() => {
    bodyStyle = installDocumentStub();
  });

  afterEach(() => {
    resetDocumentTextSelectionLockForTests();
    vi.unstubAllGlobals();
  });

  it("sets user-select none on first lock and clears on last unlock", () => {
    lockDocumentTextSelection();
    expect(bodyStyle.userSelect).toBe("none");
    expect(documentTextSelectionLockCount()).toBe(1);

    unlockDocumentTextSelection();
    expect(bodyStyle.userSelect).toBe("");
    expect(documentTextSelectionLockCount()).toBe(0);
  });

  it("ref-counts nested locks", () => {
    lockDocumentTextSelection();
    lockDocumentTextSelection();
    expect(documentTextSelectionLockCount()).toBe(2);

    unlockDocumentTextSelection();
    expect(bodyStyle.userSelect).toBe("none");
    expect(documentTextSelectionLockCount()).toBe(1);

    unlockDocumentTextSelection();
    expect(bodyStyle.userSelect).toBe("");
    expect(documentTextSelectionLockCount()).toBe(0);
  });

  it("ignores unlock when lock count is zero", () => {
    unlockDocumentTextSelection();
    expect(documentTextSelectionLockCount()).toBe(0);
  });
});
