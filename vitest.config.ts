// Unit tests for the pure parts of the frontend (no DOM): `npm test`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
