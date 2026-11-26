import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vitest/config";

const devkit = path.resolve(".", ".hutch/devkit");

export default defineConfig(async () => {
  const alias = await electrobunAlias();
  return {
    clearScreen: false,
    resolve: { alias },
    server: {
      port: 1420,
      strictPort: true,
      host: false,
      watch: {
        ignored: ["**/.hutch/**", "**/.electrobun/**", "**/build/**", "**/artifacts/**"],
      },
    },
    build: {
      target: "chrome105",
      minify: true,
      sourcemap: false,
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      coverage: {
        provider: "v8" as const,
        reporter: ["text", "lcov", "html"],
        reportsDirectory: "coverage/frontend",
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts", "src/bun/**", "src/lib/desktop.ts", "src/lib/electrobun-*.ts"],
      },
    },
  };
});

async function electrobunAlias(): Promise<{ find: RegExp; replacement: string }[]> {
  const helper = path.join(devkit, "api/config/electrobun-vite.ts");
  if (existsSync(helper)) {
    const mod = (await import(pathToFileURL(helper).href)) as {
      electrobunViteAliases: (root: string) => { find: RegExp; replacement: string }[];
    };
    return mod.electrobunViteAliases(devkit);
  }
  return [
    { find: /^electrobun$/, replacement: path.resolve("src/lib/electrobun-main-stub.ts") },
    { find: /^electrobun\/main$/, replacement: path.resolve("src/lib/electrobun-main-stub.ts") },
    { find: /^electrobun\/view$/, replacement: path.resolve("src/lib/electrobun-view-stub.ts") },
  ];
}
