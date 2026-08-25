export type PixelPoint = { x: number; y: number };

export type ProjectLngLat = (lng: number, lat: number) => PixelPoint | null;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function coordinatesToSvgPath(
    coordinates: Array<[number, number] | undefined>,
    project: ProjectLngLat,
    close = false,
): string {
    let path = '';
    let started = false;
    for (const pair of coordinates) {
        const lng = pair?.[0];
        const lat = pair?.[1];
        if (lng === undefined || lat === undefined) {
            continue;
        }
        const point = project(lng, lat);
        if (!point) {
            continue;
        }
        path += `${started ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        started = true;
    }
    if (started && close) {
        path += 'Z';
    }
    return path;
}

export function lineFeaturesToSvgPath(
    features: Array<{ geometry?: { type?: string; coordinates?: unknown } }>,
    project: ProjectLngLat,
): string {
    return features
        .map((feature) => {
            if (feature.geometry?.type !== 'LineString') {
                return '';
            }
            const coordinates = feature.geometry.coordinates;
            if (!Array.isArray(coordinates)) {
                return '';
            }
            return coordinatesToSvgPath(coordinates as Array<[number, number]>, project);
        })
        .filter(Boolean)
        .join('');
}

export function polygonFeaturesToSvgPath(
    features: Array<{ geometry?: { type?: string; coordinates?: unknown } }>,
    project: ProjectLngLat,
): string {
    return features
        .map((feature) => {
            if (feature.geometry?.type !== 'Polygon') {
                return '';
            }
            const rings = feature.geometry.coordinates;
            if (!Array.isArray(rings) || !Array.isArray(rings[0])) {
                return '';
            }
            return rings
                .filter((ring): ring is Array<[number, number]> => Array.isArray(ring))
                .map((ring) => coordinatesToSvgPath(ring, project, true))
                .join('');
        })
        .filter(Boolean)
        .join('');
}

export function svgById(svg: SVGSVGElement, id: string): Element | null {
    const escaped = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return svg.querySelector(`[id="${escaped}"]`);
}

export function ensureForbiddenHatchPattern(svg: SVGSVGElement): void {
    if (svgById(svg, 'studio-hatch-forbidden')) {
        return;
    }
    const defs = document.createElementNS(SVG_NS, 'defs');
    const pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.id = 'studio-hatch-forbidden';
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '8');
    pattern.setAttribute('height', '8');
    const hatch = document.createElementNS(SVG_NS, 'path');
    hatch.setAttribute('d', 'M0 8L8 0M-2 2L2 -2M6 10L10 6');
    hatch.setAttribute('stroke', '#B91C1C');
    hatch.setAttribute('stroke-width', '1.5');
    hatch.setAttribute('fill', 'none');
    pattern.appendChild(hatch);
    defs.appendChild(pattern);
    svg.insertBefore(defs, svg.firstChild);
}

export function removeSvgPathsByPrefix(
    svg: SVGSVGElement,
    prefix: string,
    keep: Set<string>,
): void {
    for (const node of [...svg.querySelectorAll('path, text')]) {
        if (!node.id.startsWith(prefix) || keep.has(node.id)) {
            continue;
        }
        node.remove();
    }
}

export function createMapSvgOverlay(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('studio-map-svg');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
}

export function sizeMapSvgOverlay(svg: SVGSVGElement, width: number, height: number): void {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    svg.setAttribute('width', String(safeWidth));
    svg.setAttribute('height', String(safeHeight));
    svg.setAttribute('viewBox', `0 0 ${safeWidth} ${safeHeight}`);
}

export function upsertSvgPath(
    svg: SVGSVGElement,
    id: string,
    d: string,
    attrs: Record<string, string>,
    options?: { beforeId?: string },
): void {
    const existing = svgById(svg, id);
    let path =
        existing !== null && existing.namespaceURI === SVG_NS && existing.localName === 'path'
            ? (existing as SVGPathElement)
            : null;
    const beforeNode = options?.beforeId != null ? svgById(svg, options.beforeId) : null;
    if (!path) {
        existing?.remove();
        path = document.createElementNS(SVG_NS, 'path');
        path.id = id;
        if (beforeNode) {
            svg.insertBefore(path, beforeNode);
        } else {
            svg.appendChild(path);
        }
    } else if (beforeNode && path !== beforeNode) {
        svg.insertBefore(path, beforeNode);
    }
    path.setAttribute('d', d);
    path.setAttribute('fill', attrs.fill ?? 'none');
    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'fill') {
            continue;
        }
        path.setAttribute(name, value);
    }
    path.setAttribute('visibility', d ? 'visible' : 'hidden');
}

export function upsertSvgText(
    svg: SVGSVGElement,
    id: string,
    text: string,
    x: number,
    y: number,
    attrs: Record<string, string> = {},
): void {
    const existing = svgById(svg, id);
    let node =
        existing !== null && existing.namespaceURI === SVG_NS && existing.localName === 'text'
            ? (existing as SVGTextElement)
            : null;
    if (!node) {
        existing?.remove();
        node = document.createElementNS(SVG_NS, 'text');
        node.id = id;
        node.setAttribute('class', 'studio-cat-label');
    }
    svg.appendChild(node);
    node.textContent = text;
    node.setAttribute('x', x.toFixed(1));
    node.setAttribute('y', y.toFixed(1));
    node.setAttribute('text-anchor', attrs['text-anchor'] ?? 'middle');
    node.setAttribute('dominant-baseline', attrs['dominant-baseline'] ?? 'central');
    for (const [name, value] of Object.entries(attrs)) {
        if (name === 'text-anchor' || name === 'dominant-baseline') {
            continue;
        }
        node.setAttribute(name, value);
    }
}
