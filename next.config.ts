import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.E2E_RUN === "true" ? ".next-e2e" : ".next",
  serverExternalPackages: ["better-sqlite3", "busboy"],
  outputFileTracingExcludes: {
    "*": ["./data/**/*", "./backups/**/*", "./.tools/**/*", "./.env*", "./test-results/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/api/resources/:id/preview",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};
export default config;
