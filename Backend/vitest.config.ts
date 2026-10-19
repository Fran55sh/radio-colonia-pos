import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    env: {
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://pos:pos@127.0.0.1:5432/pos_test",
    },
  },
});
