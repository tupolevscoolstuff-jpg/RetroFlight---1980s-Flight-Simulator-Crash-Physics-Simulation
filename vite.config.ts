import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function cesiumStaticPlugin(): Plugin {
  const cesiumBuildDir = path.resolve(__dirname, 'node_modules/cesium/Build/Cesium');
  const folders = ['Assets', 'ThirdParty', 'Widgets', 'Workers'];

  return {
    name: 'cesium-static-assets',
    configureServer(server) {
      server.middlewares.use('/cesium', (req, res, next) => {
        const cleanUrl = (req.url || '/').split('?')[0];
        const relPath = cleanUrl.replace(/^\/+/, '');
        const filePath = path.join(cesiumBuildDir, relPath);
        if (filePath.startsWith(cesiumBuildDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          if (filePath.endsWith('.js') || filePath.endsWith('.cjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          } else if (filePath.endsWith('.css')) {
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
          } else if (filePath.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          } else if (filePath.endsWith('.json')) {
            res.setHeader('Content-Type', 'application/json');
          } else if (filePath.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
          } else if (filePath.endsWith('.svg')) {
            res.setHeader('Content-Type', 'image/svg+xml');
          }
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });
    },
    closeBundle(error?: Error): void {
      if (error) return;
      const distDir = path.resolve(__dirname, 'dist');
      const distCesium = path.resolve(distDir, 'cesium');
      if (!fs.existsSync(distDir) || !fs.existsSync(cesiumBuildDir)) return;
      for (const folder of folders) {
        const src = path.join(cesiumBuildDir, folder);
        const dest = path.join(distCesium, folder);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, {recursive: true, force: true});
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      cesiumStaticPlugin(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
