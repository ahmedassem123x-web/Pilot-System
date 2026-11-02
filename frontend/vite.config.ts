import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    // Render serves the panel on this public host, but Vite's preview
    // server blocks unknown hosts by default ("Blocked request. This host
    // is not allowed"). Allow Render's host (and localhost for local runs).
    allowedHosts: ['pilot-system-frontend.onrender.com', 'localhost'],
  },
  test: {
    environment: 'jsdom',
  },
});
