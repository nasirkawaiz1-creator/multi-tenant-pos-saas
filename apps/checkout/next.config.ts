import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/checkout",
  transpilePackages: ["@pos/ui", "@pos/api-client"],
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
