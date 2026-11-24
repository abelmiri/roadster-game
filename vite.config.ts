import { defineConfig } from 'vite';
import { roadsterLan } from './server/lan.mjs';

export default defineConfig({
  plugins: [roadsterLan()],
  esbuild: { legalComments: 'inline' },
  build: {
    rollupOptions: {
      output: {
        banner: '/*! Roadster | Copyright (c) 2026 abelmiri. All rights reserved. | https://github.com/abelmiri | miri1888@gmail.com | Third-party licenses: /legal/index.html */',
      },
    },
  },
});
