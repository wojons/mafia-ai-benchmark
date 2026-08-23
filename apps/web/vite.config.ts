import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3004',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3004',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // ThreeDViz (three.js + @react-three, ~919 kB min / 254 kB gzip) is
    // React.lazy-loaded on the /3d route only — fetched on demand, never on
    // first paint. The limit is raised so this intentional deferred chunk
    // doesn't emit a false warning; every chunk that IS on the initial
    // critical path stays far below 500 kB (MAF-GAP-055).
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Object form (entry-point subtrees), NOT a function with a catch-all
        // 'vendor': a catch-all pulls three.js into a chunk the entry imports
        // statically, defeating the React.lazy split. With the object form,
        // three.js stays unassigned and rollup keeps it inside the async
        // ThreeDViz chunk, fetched only when /3d is visited (MAF-GAP-055).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          chart: ['chart.js', 'react-chartjs-2'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
