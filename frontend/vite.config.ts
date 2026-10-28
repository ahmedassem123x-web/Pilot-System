import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The backend serves ONLY frontend/index.html (GET / and /index.html).
// So the Vite entry lives in dev-entry.html, the build inlines all JS/CSS
// into a single dist/index.html, and `npm run build` copies that file over
// frontend/index.html — the exact file the backend serves. No backend change
// is needed and no separate asset files are ever requested.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: 'dev-entry.html' },
  },
});
