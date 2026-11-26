// 以前のウィンドウ制約。Electrobun の生成時オプションに最小・最大が無いので、リサイズ後に戻す。

export const WINDOW_MIN_WIDTH = 360;
export const WINDOW_MIN_HEIGHT = 520;
export const WINDOW_MAX_WIDTH = 480;

export function clampWindowSize(width: number, height: number): { width: number; height: number } {
  const safeWidth = Number.isFinite(width) ? width : WINDOW_MIN_WIDTH;
  const safeHeight = Number.isFinite(height) ? height : WINDOW_MIN_HEIGHT;
  return {
    width: Math.min(WINDOW_MAX_WIDTH, Math.max(WINDOW_MIN_WIDTH, Math.round(safeWidth))),
    height: Math.max(WINDOW_MIN_HEIGHT, Math.round(safeHeight)),
  };
}

/** 閉じるボタンで終了せず、トレイにしまうか。終了操作の最中はしまわない。 */
export function shouldHideOnClose(exiting: boolean, closeToTray: boolean): boolean {
  return !exiting && closeToTray;
}
