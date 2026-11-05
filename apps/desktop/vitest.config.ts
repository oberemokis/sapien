import { fileURLToPath } from "node:url";
import { testConfig } from "@sapien/testing/config";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    ...testConfig,
    setupFiles: [...testConfig.setupFiles, "./src/test-setup.ts"],
  },
});
