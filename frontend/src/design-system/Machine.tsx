import { createLucideIcon } from 'lucide-react';

/**
 * Wheeled machine platform (robot / electric vehicle / UGV).
 * Product exception to CdCF §4.7 `Tractor`: that glyph is a thermal tractor
 * (cab + exhaust). Equal wheels and a sensor mast stay vehicle-shaped without
 * locking the UI to an ICE silhouette.
 */
export const Machine = createLucideIcon('machine', [
    ['circle', { cx: '7', cy: '17', r: '3', key: 'wheel-l' }],
    ['circle', { cx: '17', cy: '17', r: '3', key: 'wheel-r' }],
    ['path', { d: 'M4 17v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5', key: 'body' }],
    ['path', { d: 'M9 10V7h6v3', key: 'mast' }],
    ['circle', { cx: '12', cy: '6', r: '1', key: 'sensor' }],
]);
