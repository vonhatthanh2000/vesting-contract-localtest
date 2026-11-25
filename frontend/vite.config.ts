import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 30141,
    strictPort: true,
    // Listen on all interfaces, not just 127.0.0.1, so the public tunnel/proxy can reach the dev server.
    host: true,
    // Vite refuses unknown Host headers; allow the public tunnel to this dev server.
    allowedHosts: ['thanh-30141.motcaigido.xyz'],
  },
});
