// Unit tests for the pure parts of the frontend (no DOM): `npm test`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Solid's browser build: its reactivity works (the server build has none), so
  // store code that reads derived values (nodeById, the selection) can be tested
  resolve: { conditions: ["browser", "development"] },
  ssr: { resolve: { conditions: ["browser", "development"], externalConditions: ["browser", "development"] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    server: { deps: { inline: [/solid-js/] } },
  },
});
