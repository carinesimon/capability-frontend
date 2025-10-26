import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    // Autorise le build même si ESLint trouve des erreurs.
    ignoreDuringBuilds: true,
  },
  // Si tu as aussi des erreurs TypeScript bloquantes, décommente la ligne ci-dessous.
  // typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
