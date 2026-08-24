import { describe, expect, it } from 'vitest';

import { offsetLocalRing } from '../../frontend/src/domain/polygon-offset';

const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
];

const clockwise: [number, number][] = [...square].reverse() as [number, number][];

describe('offsetLocalRing', () => {
    it('shrinks a square by the requested margin on every edge', () => {
        expect(offsetLocalRing(square, 0.25)).toEqual([
            [0.25, 0.25],
            [9.75, 0.25],
            [9.75, 9.75],
            [0.25, 9.75],
        ]);
    });

    it('shrinks inward whatever the winding order', () => {
        const offset = offsetLocalRing(clockwise, 0.25);
        expect(offset).not.toBeNull();
        for (const [x, y] of offset ?? []) {
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(10);
            expect(y).toBeGreaterThan(0);
            expect(y).toBeLessThan(10);
        }
    });

    it('grows the ring when the margin is negative', () => {
        expect(offsetLocalRing(square, -0.25)).toEqual([
            [-0.25, -0.25],
            [10.25, -0.25],
            [10.25, 10.25],
            [-0.25, 10.25],
        ]);
    });

    it('refuses to collapse a ring narrower than twice the margin', () => {
        const sliver: [number, number][] = [
            [0, 0],
            [10, 0],
            [10, 0.2],
            [0, 0.2],
        ];
        expect(offsetLocalRing(sliver, 0.25)).toBeNull();
    });

    it('rejects degenerate input', () => {
        expect(offsetLocalRing([[0, 0]], 0.25)).toBeNull();
        expect(
            offsetLocalRing(
                [
                    [0, 0],
                    [1, 0],
                    [2, 0],
                ],
                0.25,
            ),
        ).toBeNull();
    });
});
