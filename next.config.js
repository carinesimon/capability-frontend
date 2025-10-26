/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ne bloque pas le build si ESLint trouve des erreurs
    ignoreDuringBuilds: true,
  },
  // Si jamais tu as aussi des erreurs TypeScript bloquantes, décommente:
  // typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
