// ファイル監視の対象判定。予定ファイル自身の変更だけを画面へ渡す。
import path from "node:path";

export function eventTargetsSchedule(eventPaths: readonly string[], schedule: string): boolean {
  const name = path.basename(schedule);
  if (!name) return false;
  const parent = directoryOf(schedule);
  return eventPaths.some((eventPath) => {
    if (path.basename(eventPath) !== name) return false;
    const eventParent = directoryOf(eventPath);
    // ファイル名だけの通知は、監視フォルダ内のそのファイルとして扱う。
    if (eventParent === "") return true;
    return eventParent === parent;
  });
}

function directoryOf(filePath: string): string {
  const directory = path.dirname(filePath);
  if (directory === "." || directory === "") return "";
  return directory;
}
