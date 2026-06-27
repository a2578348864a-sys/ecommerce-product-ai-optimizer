import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Mock Next.js server-only directive for test environment
      "server-only": path.resolve(__dirname, "__mocks__/server-only.ts"),
    },
  },
});
