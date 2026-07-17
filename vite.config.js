import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Migrated from Create React App (react-scripts 5) to Vite.
// - JSX lives in .js files (legacy CRA), so esbuild is told to treat .js as JSX.
// - Supabase keys are still injected as REACT_APP_* env vars at build time
//   (the deploy ritual sets them), mapped here via `define` so dataService.js
//   keeps working unchanged.
// - Output mirrors CRA layout (build/static/js/main.[hash].js) so the service
//   worker shell + deploy verification keep working.
export default defineConfig({
  plugins: [react()],
  base: '/',
  define: {
    'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(process.env.REACT_APP_SUPABASE_URL || ''),
    'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(process.env.REACT_APP_SUPABASE_ANON_KEY || ''),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  esbuild: { loader: 'jsx', include: /src\/.*\.jsx?$/, exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    assetsDir: 'static',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        entryFileNames: 'static/js/main.[hash].js',
        chunkFileNames: 'static/js/[name].[hash].chunk.js',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // SheetJS (~800KB) is ONLY used by the staff-only GOLD import. The
            // catch-all below would fold it into the eager vendor chunk, which
            // index.html loads on every visit — meaning every agent downloads an
            // xlsx parser on mobile data for a button they will never press.
            // Its own chunk keeps the dynamic import genuinely lazy.
            if (id.includes('xlsx')) return 'vendor-xlsx';
            if (id.includes('react-dom')) return 'vendor-react-dom';
            if (id.includes('/react/') || id.includes('/react/jsx') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('@supabase') || id.includes('supabase')) return 'vendor-supabase';
            return 'vendor';
          }
        },
        assetFileNames: (info) => {
          const n = info.name || '';
          if (n.endsWith('.css')) return 'static/css/[name].[hash][extname]';
          return 'static/media/[name].[hash][extname]';
        },
      },
    },
  },
});
