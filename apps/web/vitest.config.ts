import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // Anchor the project at the package directory so setupFiles + include
  // globs resolve identically whether vitest is invoked from this package
  // or from the monorepo root via turbo.
  root: __dirname,
  test: {
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "src/**/__tests__/**/*.test.tsx",
    ],
    exclude: ["node_modules", ".next", "e2e"],
    setupFiles: [path.resolve(__dirname, "./vitest.setup.ts")],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "src/components/**/*.tsx",
      ],
      exclude: ["src/**/__tests__/**", "src/**/*.d.ts", "src/**/types.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/__mocks__/server-only.ts"),
    },
  },
});
