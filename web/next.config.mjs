import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Project root (one level up from web/). Set explicitly because on the server the
// app folder is also the service user's home, which Next.js won't auto-detect as a root.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Static export: `npm run build` writes plain files to web/out, which server/index.js serves. */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root },
};
export default nextConfig;
