import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { legalComments: 'inline' },
  build: {
    rollupOptions: {
      output: {
        banner: '/*! Roadster | Copyright (c) 2026 abelmiri. All rights reserved. | https://github.com/abelmiri | miri1888@gmail.com | Third-party licenses: /legal/index.html */',
      },
    },
  },
});
