export type PixelPoint = { x: number; y: number };

export type DraftHit =
    { kind: 'vertex'; index: number } | { kind: 'edge'; afterIndex: number; t: number };

export function closestPointOnSegment(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
): { x: number; y: number; t: number; dist: number } {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < 1e-12) {
        const dist = Math.hypot(px - ax, py - ay);
        return { x: ax, y: ay, t: 0, dist };
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    const x = ax + t * dx;
    const y = ay + t * dy;
    return { x, y, t, dist: Math.hypot(px - x, py - y) };
}

export function hitTestDraftPolyline(
    points: PixelPoint[],
    x: number,
    y: number,
    options: { closed: boolean; vertexRadius: number; edgeRadius: number },
): DraftHit | null {
    let closestVertex = -1;
    let closestVertexDist = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        if (!point) {
            continue;
        }
        const dist = Math.hypot(x - point.x, y - point.y);
        if (dist < closestVertexDist) {
            closestVertex = index;
            closestVertexDist = dist;
        }
    }
    if (closestVertex >= 0 && closestVertexDist <= options.vertexRadius) {
        return { kind: 'vertex', index: closestVertex };
    }

    const segmentCount = options.closed ? points.length : Math.max(0, points.length - 1);
    let best: { afterIndex: number; t: number; dist: number } | null = null;
    for (let index = 0; index < segmentCount; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        if (!start || !end) {
            continue;
        }
        const hit = closestPointOnSegment(x, y, start.x, start.y, end.x, end.y);
        if (hit.t <= 0.04 || hit.t >= 0.96) {
            continue;
        }
        if (!best || hit.dist < best.dist) {
            best = { afterIndex: index, t: hit.t, dist: hit.dist };
        }
    }
    if (best && best.dist <= options.edgeRadius) {
        return { kind: 'edge', afterIndex: best.afterIndex, t: best.t };
    }
    return null;
}

export function insertDraftVertex<T>(points: T[], afterIndex: number, point: T): T[] {
    if (afterIndex < -1 || afterIndex >= points.length) {
        return points.slice();
    }
    const next = points.slice();
    next.splice(afterIndex + 1, 0, point);
    return next;
}

export function moveDraftVertex<T>(points: T[], index: number, point: T): T[] {
    if (index < 0 || index >= points.length) {
        return points.slice();
    }
    const next = points.slice();
    next[index] = point;
    return next;
}
