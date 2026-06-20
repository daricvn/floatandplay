/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// Separate from vite.config.ts so production build resolution stays untouched.
// `conditions` makes solid-js resolve to its client build under jsdom.
export default defineConfig({
  plugins: [solid()],
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
