// 型チェック用。実行時は Hutch が Electrobun 2.0.6 の SDK を使う。
// SDK 本体は bun:ffi を参照し、このリポジトリの tsc では解決できない。

export type RPCSchema<I> = I;

type MessagesOf<S> = S extends { messages: infer Messages } ? Messages : Record<string, never>;

export class BrowserWindow {
  constructor(options?: {
    title?: string;
    url?: string | null;
    frame?: { width: number; height: number };
    titleBarStyle?: "default" | "hidden" | "hiddenInset";
    hidden?: boolean;
    activate?: boolean;
    rpc?: unknown;
  });
  setAlwaysOnTop(value: boolean): void;
  on(name: string, handler: (event: unknown) => void): void;
  hide(): void;
  show(): void;
  minimize(): void;
  unminimize(): void;
  close(): void;
  focus(): void;
  setSize(width: number, height: number): void;
}

export class BrowserView {
  static defineRPC<Schema extends { bun: unknown; webview: unknown }>(config: {
    handlers: {
      requests?: Record<string, (...args: never[]) => unknown>;
      messages?: Record<string, (...args: never[]) => unknown>;
    };
  }): {
    send: {
      [Key in keyof MessagesOf<Schema["webview"]>]: (payload: MessagesOf<Schema["webview"]>[Key]) => void;
    };
  };
}

export class Tray {
  constructor(options?: { title?: string; image?: string; template?: boolean; width?: number; height?: number });
  setMenu(menu: Array<Record<string, unknown>>): void;
  on(name: string, handler: (event: unknown) => void): void;
}

export const Utils: {
  openFileDialog(options?: {
    startingFolder?: string;
    allowedFileTypes?: string;
    canChooseFiles?: boolean;
    canChooseDirectory?: boolean;
    allowsMultipleSelection?: boolean;
  }): Promise<string[]>;
  openExternal(url: string): boolean;
  showNotification(options: { title: string; body?: string; subtitle?: string; silent?: boolean }): void;
  quit(code?: number): boolean;
};
