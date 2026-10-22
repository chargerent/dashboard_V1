import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/portal/', plugins: [react()],
  build: { outDir: 'dist-demos', emptyOutDir: true, copyPublicDir: false,
    rollupOptions: { input: { demos: 'demos/index.html', 'demos-nav': 'src/demos-navigation.js' },
      output: { entryFileNames: 'demo-assets/[name]-[hash].js', chunkFileNames: 'demo-assets/[name]-[hash].js', assetFileNames: 'demo-assets/[name]-[hash][extname]' } } },
});
