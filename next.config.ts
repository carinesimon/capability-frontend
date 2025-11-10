/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/prospects/:path*",
        destination: "http://localhost:3001/prospects/:path*",
      },
      {
        source: "/leads/:path*",
        destination: "http://localhost:3001/leads/:path*",
      },
      {
        source: "/reporting/:path*",
        destination: "http://localhost:3001/reporting/:path*",
      },
      {
        source: "/auth/:path*",
        destination: "http://localhost:3001/auth/:path*",
      },
    ];
  },
};

export default nextConfig;
