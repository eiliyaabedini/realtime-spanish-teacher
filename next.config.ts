import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // lesson .txt files are read with fs at request time — make sure Vercel's
  // output tracing bundles them for every route
  outputFileTracingIncludes: {
    "/**": ["./lib/lessons/content/**"],
  },
};

export default nextConfig;
