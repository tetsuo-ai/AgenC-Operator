import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
// Tauri expects a fixed port, fail if that port is not available
export default defineConfig({
  plugins: [react()],

  // Path aliases for cleaner imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Tauri dev server configuration
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Prevent watching Rust files
      ignored: ['**/src-tauri/**'],
    },
  },

  // Build configuration
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    // Optimize for bundle size
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Output to dist folder
    outDir: 'dist',
  },

  // Environment variables
  envPrefix: ['VITE_', 'TAURI_'],
});
