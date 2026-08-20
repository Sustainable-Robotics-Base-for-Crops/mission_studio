export type Breakpoint = 'full' | 'compact' | 'drawer' | 'review';

export function breakpointFromWidth(width: number): Breakpoint {
    if (width >= 1440) {
        return 'full';
    }
    if (width >= 1200) {
        return 'compact';
    }
    if (width >= 1024) {
        return 'drawer';
    }
    return 'review';
}

/**
 * Which CSS grid tracks are mounted. Empty tracks must not stay in the
 * template: otherwise a folded panel still occupies its column and the
 * canvas shrinks to the left (CdCF §6.1 — collapsible panels, map ≥ 50 %).
 */
export type ShellTracks = 'full' | 'left-only' | 'right-only' | 'canvas';

export function shellTracks(leftOpen: boolean, rightOpen: boolean): ShellTracks {
    if (leftOpen && rightOpen) {
        return 'full';
    }
    if (leftOpen) {
        return 'left-only';
    }
    if (rightOpen) {
        return 'right-only';
    }
    return 'canvas';
}

export const LAYOUT = {
    appBar: 56,
    rail: 64,
    contextDefault: 304,
    contextMin: 280,
    contextMax: 420,
    inspectorDefault: 360,
    inspectorMin: 320,
    inspectorMax: 440,
    canvasMin: 640,
    simulationDefault: 160,
    simulationMax: 200,
    handle: 6,
} as const;
