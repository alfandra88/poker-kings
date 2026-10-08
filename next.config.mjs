/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Dev-only: the local preview proxy browses on a different port than the dev
  // server, which Next otherwise treats as a cross-origin request. Ignored in
  // production.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;