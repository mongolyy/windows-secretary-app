import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// フロントエンドの TypeScript だけを見る。Rust と生成物、バージョンスクリプトは対象外。
export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "src-tauri/**", "node_modules/**", "scripts/**"],
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
