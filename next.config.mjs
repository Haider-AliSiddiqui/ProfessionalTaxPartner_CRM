/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["firebase-admin", "jwks-rsa", "jose"],
};

export default nextConfig;
