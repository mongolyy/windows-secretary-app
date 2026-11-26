import { formatAge, formatCountdown, formatEventWhen, formatHm, formatNow, formatRemainingPhrase } from "./lib/format";
import type { ScheduleView } from "./lib/schedule";
import type { ParseIssue, ScheduleEvent } from "./lib/types";

export type ReadyModel = {
  kind: "ready";
  path: string;
  view: ScheduleView;
  warnings: ParseIssue[];
  mtimeMs: number | null;
  stale: boolean;
  usingLastGood: boolean;
  preview: boolean;
  eventCount: number;
  nowMs: number;
};

export type ScreenModel =
  | { kind: "loading" }
  | { kind: "missing"; path: string }
  | { kind: "unreadable"; path: string; message: string }
  | { kind: "invalid"; path: string; issues: ParseIssue[] }
  | ReadyModel;

export type ViewHandlers = {
  onSettings: () => void;
  onPin: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  pinned: boolean;
};

export function renderScreen(root: HTMLElement, model: ScreenModel, handlers: ViewHandlers): void {
  root.replaceChildren();
  const win = el("section", "window");
  win.append(renderTitlebar(model, handlers));
  const scroll = el("div", "scroll");
  scroll.append(...renderBody(model, handlers));
  win.append(scroll, renderFooter(model, handlers));
  root.append(win);
}

export function updateLiveReadout(root: ParentNode, model: ReadyModel): void {
  const now = root.querySelector("#now-clock");
  if (now) now.textContent = formatNow(model.nowMs, model.view.timeZone);
  setCountdown(root, "current", model.view.currentRemainingSec);
  setCountdown(root, "next", model.view.nextRemainingSec);
}

function renderTitlebar(model: ScreenModel, handlers: ViewHandlers): HTMLElement {
  const bar = el("header", "titlebar electrobun-webkit-app-region-drag");
  const brand = el("div", "brand electrobun-webkit-app-region-drag");
  const seal = el("div", "seal", "秘");
  const titles = el("div");
  const name = el("h1", undefined, "秘書");
  const status = el("div", "status-line");
  const dot = el("span", `dot ${dotClass(model)}`);
  status.append(dot, document.createTextNode(statusText(model)));
  titles.append(name, status);
  brand.append(seal, titles);

  const pin = el<HTMLButtonElement>("button", `icon-btn${handlers.pinned ? " is-on" : ""}`, "前");
  pin.type = "button";
  pin.setAttribute("aria-pressed", String(handlers.pinned));
  pin.setAttribute("aria-label", "常に手前に表示");
  pin.title = "常に手前に表示";
  pin.addEventListener("click", handlers.onPin);

  const min = el<HTMLButtonElement>("button", "icon-btn", "–");
  min.type = "button";
  min.setAttribute("aria-label", "最小化");
  min.addEventListener("click", handlers.onMinimize);

  const close = el<HTMLButtonElement>("button", "icon-btn", "×");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.addEventListener("click", handlers.onClose);

  const controls = el("div", "controls");
  controls.append(pin, min, close);
  bar.append(brand, controls);
  return bar;
}

function renderBody(model: ScreenModel, handlers: ViewHandlers): Node[] {
  if (model.kind === "loading") {
    return [emptyBlock("予定を確認しています", "CSVを読み込んでいます。")];
  }
  if (model.kind === "missing") {
    const block = emptyBlock(
      "予定ファイルが見つかりません",
      "NotionのデータベースをCSVで書き出し、下のパスに置くか、設定から選んでください。ZIPの場合は展開して中のCSVを指定します。",
    );
    block.append(pathBlock(model.path), settingsButton(handlers));
    return [block];
  }
  if (model.kind === "unreadable") {
    const block = emptyBlock("予定ファイルを読めませんでした", model.message);
    block.append(pathBlock(model.path), settingsButton(handlers));
    return [block];
  }
  if (model.kind === "invalid") {
    const block = emptyBlock("CSVの形式を解釈できません", "列名と日付のセルを確認してください。");
    block.append(issueList(model.issues), pathBlock(model.path), settingsButton(handlers));
    return [block];
  }

  const nodes: Node[] = [];
  if (model.usingLastGood) {
    nodes.push(banner("bad", "直前に読めた内容を表示しています。最新のファイルはまだ解釈できません。"));
  }
  if (model.stale) {
    const age = model.mtimeMs == null ? "" : `（${formatAge(model.nowMs - model.mtimeMs)}）`;
    nodes.push(
      banner(
        "warn",
        `この書き出しは古くなっている可能性があります${age}。予定が変わっていたら、同じファイルへ上書きで書き出してください。`,
      ),
    );
  }
  if (model.warnings.length > 0) {
    const box = banner("warn", "");
    const summary = document.createElement("strong");
    summary.textContent = `${model.warnings.length}件の注意`;
    const list = issueList(model.warnings);
    box.append(summary, list);
    nodes.push(box);
  }
  for (const item of model.view.allDayStrip) nodes.push(allDayStrip(item, model));
  if (model.view.current) nodes.push(eventCard(model.view.current, "current", model, handlers));
  else if (model.view.heroAllDay) nodes.push(eventCard(model.view.heroAllDay, "allday", model, handlers));
  else if (!model.view.next && model.view.laterToday.length === 0) {
    nodes.push(
      emptyBlock(
        model.eventCount === 0 ? "予定が1件もありません" : "この先の予定はありません",
        model.eventCount === 0
          ? "見出しだけのCSVか、日付の入った行がありません。"
          : "ファイルは読めましたが、いま以降の予定はありません。",
      ),
    );
  }
  if (model.view.next) nodes.push(eventCard(model.view.next, "next", model, handlers));
  if (model.view.current || model.view.heroAllDay || model.view.next || model.view.laterToday.length > 0) {
    nodes.push(el("h3", "section-title", "本日の残り"));
    if (model.view.laterToday.length === 0) {
      nodes.push(el("p", "quiet", "本日これ以降の予定はありません"));
    } else {
      const list = el("div");
      for (const item of model.view.laterToday) list.append(laterRow(item, model));
      nodes.push(list);
    }
  }
  return nodes;
}

function eventCard(
  event: ScheduleEvent,
  role: "current" | "next" | "allday",
  model: ReadyModel,
  handlers: ViewHandlers,
): HTMLElement {
  const card = el("article", role === "next" ? "card next" : "card");
  const kicker = role === "current" ? "進行中" : role === "allday" ? "終日" : "次の予定";
  card.append(el("p", "kicker", kicker));
  card.append(el("h2", undefined, event.title));
  card.append(
    el("p", "when", formatEventWhen(event.startMs, event.endMs, event.allDay, model.nowMs, model.view.timeZone)),
  );

  const seconds =
    role === "current" ? model.view.currentRemainingSec : role === "next" ? model.view.nextRemainingSec : null;
  const block = el("div", "countdown-block");
  if (role === "allday" || seconds == null) {
    const big = el("p", "countdown", "終日");
    big.dataset.countdown = role;
    block.append(big);
  } else {
    block.append(el("p", "countdown-label", role === "current" ? "終了まで" : "開始まで"));
    const big = el("p", "countdown", formatCountdown(seconds));
    big.dataset.countdown = role;
    const phrase = el("p", "phrase", formatRemainingPhrase(seconds));
    phrase.dataset.phrase = role;
    block.append(big, phrase);
  }
  card.append(block);

  if (event.location || event.url) {
    const meta = el("div", "meta");
    if (event.location) meta.append(el("p", undefined, `場所　${event.location}`));
    if (event.url) {
      const link = el<HTMLButtonElement>("button", "link-btn", "参加する");
      link.type = "button";
      link.addEventListener("click", () => handlers.onOpenUrl(event.url!));
      meta.append(link);
    }
    card.append(meta);
  }
  return card;
}

function allDayStrip(event: ScheduleEvent, model: ReadyModel): HTMLElement {
  const strip = el("div", "day-strip");
  strip.append(el("p", "kicker", "終日"));
  const text = el("div");
  text.append(
    el("strong", undefined, event.title),
    el("div", "where", formatEventWhen(event.startMs, event.endMs, true, model.nowMs, model.view.timeZone)),
  );
  strip.append(text);
  return strip;
}

function laterRow(event: ScheduleEvent, model: ReadyModel): HTMLElement {
  const row = el("div", "event-row");
  const time = document.createElement("time");
  time.textContent = formatHm(event.startMs, model.view.timeZone);
  time.dateTime = new Date(event.startMs).toISOString();
  const body = el("div");
  const title = el("strong", undefined, event.title);
  if (event.startMs <= model.nowMs && model.nowMs < event.endMs) {
    title.append(el("span", "badge", "進行中"));
  }
  body.append(title);
  if (event.location) body.append(el("div", "where", event.location));
  row.append(time, body);
  return row;
}

function renderFooter(model: ScreenModel, handlers: ViewHandlers): HTMLElement {
  const footer = el("footer", "footer");
  const settings = el<HTMLButtonElement>("button", "text-btn", "設定");
  settings.type = "button";
  settings.addEventListener("click", handlers.onSettings);
  const clock = el("span", undefined, model.kind === "ready" ? formatNow(model.nowMs, model.view.timeZone) : "");
  clock.id = "now-clock";
  footer.append(settings, clock);
  return footer;
}

function statusText(model: ScreenModel): string {
  if (model.kind === "loading") return "読み込み中";
  if (model.kind === "missing") return "ファイルがありません";
  if (model.kind === "unreadable") return "読めません";
  if (model.kind === "invalid") return "形式を確認してください";
  if (model.mtimeMs == null) return "更新時刻がわかりません";
  const when = formatNow(model.mtimeMs, model.view.timeZone);
  return model.stale ? `更新は${formatAge(model.nowMs - model.mtimeMs)}` : `${when} 更新`;
}

function dotClass(model: ScreenModel): string {
  if (model.kind === "missing" || model.kind === "unreadable" || model.kind === "invalid") return "bad";
  if (model.kind === "ready" && (model.stale || model.usingLastGood || model.warnings.length > 0)) return "warn";
  if (model.kind === "loading") return "warn";
  return "";
}

function setCountdown(root: ParentNode, role: string, seconds: number | null): void {
  if (seconds == null) return;
  const clock = root.querySelector(`[data-countdown="${role}"]`);
  if (clock) clock.textContent = formatCountdown(seconds);
  const phrase = root.querySelector(`[data-phrase="${role}"]`);
  if (phrase) phrase.textContent = formatRemainingPhrase(seconds);
}

function emptyBlock(title: string, body: string): HTMLElement {
  const block = el("section", "empty");
  block.append(el("h2", undefined, title), el("p", "quiet", body));
  return block;
}

function pathBlock(path: string): HTMLElement {
  return el("p", "path", path);
}

function settingsButton(handlers: ViewHandlers): HTMLButtonElement {
  const button = el<HTMLButtonElement>("button", "ghost", "設定を開く");
  button.type = "button";
  button.addEventListener("click", handlers.onSettings);
  return button;
}

function banner(kind: "warn" | "bad", text: string): HTMLElement {
  const box = el("div", `banner ${kind}`);
  if (text) box.append(document.createTextNode(text));
  return box;
}

function issueList(issues: ParseIssue[]): HTMLElement {
  const list = document.createElement("ul");
  for (const issue of issues.slice(0, 8)) {
    const item = document.createElement("li");
    item.textContent = issue.message;
    list.append(item);
  }
  return list;
}

function el<T extends HTMLElement = HTMLElement>(tag: string, className?: string, text?: string): T {
  const node = document.createElement(tag) as T;
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
