/** @type {import('next').NextConfig} */
const nextConfig = {
  // Laisse Next faire du lint en local, mais ne fais PAS échouer la build en CI
  eslint: { ignoreDuringBuilds: true },
  // Si un jour tu veux ignorer aussi les erreurs de types en CI :
  // typescript: { ignoreBuildErrors: true },
};
module.exports = nextConfig;
