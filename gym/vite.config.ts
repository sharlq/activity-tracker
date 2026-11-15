import { defineConfig } from 'vite';

// The shared engine lives in ../tracker/src, outside this folder: let the dev server read it.
export default defineConfig({
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2022' },
});
