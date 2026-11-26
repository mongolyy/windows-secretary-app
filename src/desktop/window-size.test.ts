import { describe, expect, it } from "vitest";

import { clampWindowSize, shouldHideOnClose } from "./window-size";

describe("ウィンドウ", () => {
  it("幅と高さを以前の範囲に収める", () => {
    expect(clampWindowSize(200, 100)).toEqual({ width: 360, height: 520 });
    expect(clampWindowSize(900, 800)).toEqual({ width: 480, height: 800 });
    expect(clampWindowSize(400, 700)).toEqual({ width: 400, height: 700 });
  });

  it("終了中でなければ閉じる操作をトレイへしまう", () => {
    expect(shouldHideOnClose(false, true)).toBe(true);
    expect(shouldHideOnClose(true, true)).toBe(false);
    expect(shouldHideOnClose(false, false)).toBe(false);
  });
});
