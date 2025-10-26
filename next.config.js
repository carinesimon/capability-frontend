/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Build Vercel jamais bloqué par ESLint
    ignoreDuringBuilds: true,
  },
  // Si un jour TS te bloque en CI, décommente:
  // typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
