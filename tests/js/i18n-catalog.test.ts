import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { shellCatalog } from '../../frontend/src/i18n/adapter';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/src');

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(path, acc);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !path.endsWith('i18n/adapter.ts')) {
            acc.push(path);
        }
    }
    return acc;
}

function collectUsedKeys(blob: string): { exact: Set<string>; prefixes: string[] } {
    const exact = new Set<string>();
    for (const match of blob.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
        if (match[1]) {
            exact.add(match[1]);
        }
    }
    for (const match of blob.matchAll(/labelKey:\s*'([^']+)'/g)) {
        if (match[1]) {
            exact.add(match[1]);
        }
    }
    for (const match of blob.matchAll(/descriptionKey:\s*'([^']+)'/g)) {
        if (match[1]) {
            exact.add(match[1]);
        }
    }
    const prefixes = [
        ...blob.matchAll(/\bt\(\s*`([^`$]*)\$\{/g),
        ...blob.matchAll(/setError\(`([^`$]*)\$\{/g),
        ...blob.matchAll(/`([^`$]*fillParcelAdded[^`$]*)\$\{/g),
    ]
        .map((match) => match[1])
        .filter((prefix): prefix is string => Boolean(prefix));
    return { exact, prefixes: [...new Set(prefixes)] };
}

describe('i18n catalogues (L13 §10)', () => {
    it('keeps the same keys in French and English', () => {
        const fr = Object.keys(shellCatalog('fr')).sort();
        const en = Object.keys(shellCatalog('en')).sort();
        expect(fr).toEqual(en);
    });

    it('has a FR and EN entry for every key used in frontend/src', () => {
        const catalog = shellCatalog('fr');
        const blob = walk(SRC)
            .map((path) => readFileSync(path, 'utf8'))
            .join('\n');
        const { exact, prefixes } = collectUsedKeys(blob);
        const missing = [...exact].filter((key) => catalog[key] === undefined);
        expect(missing).toEqual([]);
        for (const prefix of prefixes) {
            const covered = Object.keys(catalog).some((key) => key.startsWith(prefix));
            expect({ prefix, covered }).toEqual({ prefix, covered: true });
        }
    });
});
