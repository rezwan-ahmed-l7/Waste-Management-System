import type { NextConfig } from "next";

const apiOrigin = process.env.API_BACKEND_ORIGIN?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!apiOrigin) return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: apiOrigin + "/api/v1/:path*"
      }
    ];
  }
};

export default nextConfig;
