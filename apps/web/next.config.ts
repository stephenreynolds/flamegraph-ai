import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@flamegraph-ai/shared"]
};

export default nextConfig;
