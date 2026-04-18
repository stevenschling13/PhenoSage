/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure server-only code never ends up in the client bundle
  experimental: {
    serverComponentsExternalPackages: [],
  },
  images: {
    // Supabase storage domains — add your project ref here
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
};

export default nextConfig;
