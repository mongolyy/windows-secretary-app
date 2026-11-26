import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// 画面とデスクトップの TypeScript を見る。生成物とバージョンスクリプトは対象外。
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "scripts/**",
      ".hutch/**",
      ".electrobun/**",
      "build/**",
      "artifacts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 画面文言と日付サンプルの全角スペースは、日本語の区切りとして意図している。
      "no-irregular-whitespace": ["error", { skipStrings: true, skipComments: true, skipTemplates: true }],
    },
  },
);
