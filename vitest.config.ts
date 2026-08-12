import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { PROJECT_MATERIALS_TEST_FILES } from "./vitest.project-materials.files";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // 依赖外部项目材料（../06_测试与验证/）的集成测试，默认排除。
    // 独立运行：npm run test:project-materials
    exclude: [...PROJECT_MATERIALS_TEST_FILES, "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Mock Next.js server-only directive for test environment
      "server-only": path.resolve(__dirname, "__mocks__/server-only.ts"),
    },
  },
});
