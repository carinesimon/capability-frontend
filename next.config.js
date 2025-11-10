/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Ne bloque pas le build si ESLint trouve des erreurs
    ignoreDuringBuilds: true,
  },

  // 🔁 Proxy / API vers le backend Nest (port 3000)
  async rewrites() {
    return [
      {
        source: '/prospects/:path*',
        destination: 'http://localhost:3000/prospects/:path*',
      },
      {
        source: '/reporting/:path*',
        destination: 'http://localhost:3000/reporting/:path*',
      },
      {
        source: '/metrics/:path*',
        destination: 'http://localhost:3000/metrics/:path*',
      },
      // Tu peux en ajouter d'autres ici si besoin :
      // { source: '/appointments/:path*', destination: 'http://localhost:3000/appointments/:path*' },
    ];
  },
};

module.exports = nextConfig;
