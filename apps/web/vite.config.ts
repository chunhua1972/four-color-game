import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  envDir: '../..',
  build: { target: ['es2022', 'safari16.4'], sourcemap: false },
  server: { port: 5173, strictPort: true },
});
