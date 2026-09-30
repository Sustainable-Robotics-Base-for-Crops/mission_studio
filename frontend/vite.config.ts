import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    root: path.resolve(__dirname),
    base: '/studio/',
    publicDir: false,
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:3000',
            '/_plugins': 'http://127.0.0.1:3000',
            '/js': 'http://127.0.0.1:3000',
            '/css': 'http://127.0.0.1:3000',
        },
    },
    worker: {
        format: 'es',
    },
    build: {
        outDir: path.resolve(__dirname, '../public/studio'),
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'index.html'),
            output: {
                entryFileNames: 'assets/studio.js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: (assetInfo) => {
                    const name = assetInfo.names?.[0] ?? assetInfo.name ?? '';
                    if (name.endsWith('.css')) {
                        return 'assets/studio.css';
                    }
                    if (/\.(woff2?|ttf|otf|eot)$/i.test(name)) {
                        return 'assets/fonts/[name][extname]';
                    }
                    return 'assets/[name][extname]';
                },
            },
        },
    },
});
