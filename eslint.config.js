import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: [
            '.venv/**',
            'node_modules/**',
            'public/js/**',
            'public/studio/**',
            'backend/uploads/**',
            'coverage/**',
        ],
    },
    {
        files: ['tests/js/**/*.js', '*.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': 'error',
            'no-undef': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            eqeqeq: ['error', 'always'],
            'no-console': 'warn',
        },
    },
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        files: ['frontend/src/**/*.{ts,tsx}', 'tests/js/**/*.{ts,tsx}', 'frontend/vite.config.ts'],
    })),
    {
        files: ['frontend/src/**/*.{ts,tsx}', 'tests/js/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
];
