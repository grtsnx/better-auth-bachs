import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  external: [
    "better-auth",
    "better-auth/api",
    "better-auth/client",
    "better-auth/db",
    "better-auth/types",
    "@better-auth/core",
    "@bachs/sdk",
    "zod",
  ],
});
