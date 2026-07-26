import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  // relative asset URLs so dist/ works from any sub-path (e.g. GitHub Pages)
  base: './',
  // no SPA fallback: flow.js probes levels/levelN.txt and needs a real 404
  // at the first gap, not index.html with a 200
  appType: 'mpa',
  build: {
    // world.js uses top-level await, which Vite's default target rejects
    target: 'es2022',
    rollupOptions: {
      output: {
        // three is the only bare import in the tree and changes far less often
        // than the game does; its own chunk keeps its hash — and the browser
        // cache entry — stable across game-only rebuilds
        manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  plugins: [
    {
      // levels/ and assets/ are fetched at runtime, not imported, so Vite
      // doesn't see them; ship them verbatim next to the bundle
      name: 'copy-runtime-files',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        // the CDN importmap only exists for the no-build python-server
        // workflow; the bundle resolves 'three' from node_modules
        handler: (html) => html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, ''),
      },
      closeBundle() {
        // dirs copied recursively; privacy-policy.html is a standalone static
        // page (inline CSS, no module scripts) Vite doesn't see, so ship it too
        for (const path of ['levels', 'assets', 'privacy-policy.html']) {
          cpSync(resolve(import.meta.dirname, path), resolve(import.meta.dirname, 'dist', path), { recursive: true });
        }
      },
    },
  ],
});
