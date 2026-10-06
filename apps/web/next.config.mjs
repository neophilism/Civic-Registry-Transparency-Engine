/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@civic-registry/core",
    "@civic-registry/config",
    "@civic-registry/database",
    "@civic-registry/registry",
    "@civic-registry/search",
  ],
};

export default nextConfig;
