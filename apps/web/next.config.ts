import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source, so Next has to compile them.
  transpilePackages: ["@vezta/shared"],
};

export default config;
