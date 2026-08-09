import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

/*
 * THE BUILD STAMP.
 *
 * A hand-maintained version number answers "which release is this" but not
 * "did my push actually land", because it only changes when someone remembers
 * to change it. The commit changes every time on its own, so it is the part
 * the app trusts: the version is for humans, the commit is the evidence.
 *
 * GITHUB_SHA is what CI builds from; the git call is the local fallback, and
 * "dev" covers a build from a tarball with no repository at all.
 */
function buildStamp() {
  let commit = process.env.GITHUB_SHA ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      commit = 'dev';
    }
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
  ) as { version?: string };
  return {
    version: pkg.version ?? '0.0.0',
    commit: commit.slice(0, 7),
    built: new Date().toISOString(),
  };
}

const STAMP = buildStamp();

/*
 * The same stamp as a fetchable file, so a tab left open overnight can notice
 * a deploy without being reloaded first. Deliberately NOT under assets/: those
 * filenames are content-hashed and cached hard, which is exactly the wrong
 * behaviour for the one file whose job is to change.
 */
function emitVersionFile(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(STAMP),
      });
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_STAMP__: JSON.stringify(STAMP),
  },
  plugins: [
    emitVersionFile(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
