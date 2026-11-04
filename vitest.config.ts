import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@foliate": fileURLToPath(new URL("./vendor/foliate-js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
