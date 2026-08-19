import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'frontend/src'),
        },
    },
    test: {
        include: ['tests/js/**/*.{test,spec}.{js,ts,tsx}', 'frontend/src/**/*.{test,spec}.{ts,tsx}'],
        environment: 'jsdom',
        coverage: {
            provider: 'v8',
            include: ['public/js/utils/**/*.js', 'frontend/src/**/*.{ts,tsx}'],
            reporter: ['text', 'lcov'],
        },
    },
});
