import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { PROJECT_MATERIALS_TEST_FILES } from "./vitest.project-materials.files";

// Release packaging 测试依赖 Windows turbopack 布局（.next/node_modules hashed
// external modules）。CI 用 webpack 构建，无该布局；CI 上跳过，本地/部署前验证。
// 依赖特定外部环境（如本地桌面 1688 Bridge 进程、独占端口 Smoke 运行时）的集成测试在 CI 上跳过，本地独立运行验证。
const CI_EXCLUDED_TESTS = process.env.CI === "true"
  ? [
      "scripts/release-package.test.ts",
      "lib/server/native1688Bridge.integration.test.ts",
      "scripts/local-smoke-runtime.test.ts",
      "lib/imageHandoff/imageDraftBatchMetadata.test.ts",
      "lib/imageHandoff/imageHandoffConcurrency.e2e.test.ts",
    ]
  : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // 依赖外部项目材料（../06_测试与验证/）的集成测试，默认排除。
    // 独立运行：npm run test:project-materials
    exclude: [...PROJECT_MATERIALS_TEST_FILES, ...CI_EXCLUDED_TESTS, "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Mock Next.js server-only directive for test environment
      "server-only": path.resolve(__dirname, "__mocks__/server-only.ts"),
    },
  },
});
