import type { ElectrobunConfig } from "electrobun";

// 自動アップデートは使わない。release.baseUrl は置かず、差分パッチの取得もしない。
export default {
  app: {
    name: "Secretary",
    identifier: "app.secretary.desktop",
    version: "0.1.0", // secretary-app-version
    description: "Notion の CSV 書き出しを手元で読む、常時表示の予定ウィンドウ",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      dist: "views/mainview",
    },
    watchIgnore: ["dist/**", ".electrobun/**", "coverage/**", "release-assets/**"],
    win: {
      bundleCEF: false,
      icon: "assets/icons/icon.ico",
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  release: {
    generatePatch: false,
  },
  scripts: {
    preBuild: "./scripts/pre-build.mjs",
    postBuild: "./scripts/post-build.mjs",
    postWrap: "./scripts/post-wrap.mjs",
  },
} satisfies ElectrobunConfig;
