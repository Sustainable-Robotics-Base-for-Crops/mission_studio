import { describe, expect, it } from 'vitest';

import {
    closestPointOnSegment,
    hitTestDraftPolyline,
    insertDraftVertex,
    moveDraftVertex,
} from '../../frontend/src/map/draft-hit';

describe('closestPointOnSegment', () => {
    it('projects onto the interior of a horizontal segment', () => {
        const hit = closestPointOnSegment(50, 8, 0, 0, 100, 0);
        expect(hit.t).toBeCloseTo(0.5);
        expect(hit.x).toBeCloseTo(50);
        expect(hit.y).toBeCloseTo(0);
        expect(hit.dist).toBeCloseTo(8);
    });

    it('clamps to the endpoints', () => {
        expect(closestPointOnSegment(-10, 0, 0, 0, 100, 0).t).toBe(0);
        expect(closestPointOnSegment(140, 0, 0, 0, 100, 0).t).toBe(1);
    });
});

describe('hitTestDraftPolyline', () => {
    const square = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
    ];

    it('prefers a vertex over a nearby edge', () => {
        expect(
            hitTestDraftPolyline(square, 2, 2, { closed: true, vertexRadius: 14, edgeRadius: 12 }),
        ).toEqual({ kind: 'vertex', index: 0 });
    });

    it('hits an open polyline edge and reports the preceding vertex', () => {
        expect(
            hitTestDraftPolyline(square, 50, 3, {
                closed: false,
                vertexRadius: 8,
                edgeRadius: 12,
            }),
        ).toEqual({ kind: 'edge', afterIndex: 0, t: 0.5 });
    });

    it('hits the closing edge of a polygon', () => {
        const hit = hitTestDraftPolyline(square, 0, 50, {
            closed: true,
            vertexRadius: 8,
            edgeRadius: 12,
        });
        expect(hit).toMatchObject({ kind: 'edge', afterIndex: 3 });
        expect(hit && hit.kind === 'edge' ? hit.t : -1).toBeCloseTo(0.5);
    });

    it('does not invent a closing edge on an open line', () => {
        expect(
            hitTestDraftPolyline(square, 0, 50, {
                closed: false,
                vertexRadius: 8,
                edgeRadius: 12,
            }),
        ).toBeNull();
    });
});

describe('insertDraftVertex / moveDraftVertex', () => {
    it('inserts after the given index, including on the closing edge', () => {
        expect(insertDraftVertex(['a', 'b', 'c'], 0, 'x')).toEqual(['a', 'x', 'b', 'c']);
        expect(insertDraftVertex(['a', 'b', 'c'], 2, 'x')).toEqual(['a', 'b', 'c', 'x']);
    });

    it('replaces a vertex in place without mutating the source', () => {
        const source = ['a', 'b', 'c'];
        expect(moveDraftVertex(source, 1, 'z')).toEqual(['a', 'z', 'c']);
        expect(source).toEqual(['a', 'b', 'c']);
    });
});
