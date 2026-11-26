// devkit が無いブラウザプレビュー用。デスクトップビルドは Electrobun の SDK に差し替える。

export class Electroview {
  static defineRPC<T>(options?: unknown): T {
    void options;
    throw new Error("Electrobun の画面ブリッジは、デスクトップビルドだけで使います。");
  }

  constructor(options?: unknown) {
    void options;
    throw new Error("Electrobun の画面ブリッジは、デスクトップビルドだけで使います。");
  }
}
