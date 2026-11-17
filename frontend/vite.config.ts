import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  // allow importing ../idls/anchor_escrow.json from the repo root
  server: { fs: { allow: ['..'] } },
});
