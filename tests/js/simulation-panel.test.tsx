import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { fetchFarmTree } from '../../frontend/src/app/farm-api';
import { LAYOUT } from '../../frontend/src/app/layout';
import { StudioProviders } from '../../frontend/src/design-system';
import type { AgriDocument } from '../../frontend/src/domain/agri';
import type { CombinationEnvelope, CombinationTwin } from '../../frontend/src/domain/equipment';
import { defaultOddProfile } from '../../frontend/src/domain/odd';
import {
    CHECK_GROUPS,
    simulationFingerprint,
    type SimulationReport,
} from '../../frontend/src/domain/simulation';
import { translate } from '../../frontend/src/i18n/adapter';
import { SimulationPanel } from '../../frontend/src/simulation/SimulationPanel';

vi.mock('../../frontend/src/app/farm-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../frontend/src/app/farm-api')>();
    return {
        ...actual,
        fetchFarmTree: vi.fn(),
        fetchFarmMission: vi.fn(),
    };
});

const farmTree = vi.mocked(fetchFarmTree);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    farmTree.mockReset();
    farmTree.mockResolvedValue({
        mission_order: [
            {
                name: '2026-08-20_nord_semis.json',
                path: 'mission_order/2026-08-20_nord_semis.json',
                size: 8,
                modified: 1,
            },
        ],
        work_performed: [
            {
                name: '2026-07-01_nord_semis.json',
                path: 'work_performed/2026-07-01_nord_semis.json',
                size: 8,
                modified: 1,
            },
        ],
    });
});

const COMBOS: CombinationTwin[] = [
    {
        id: 'hoe',
        name: 'SRBC + bineuse',
        vehicle_id: 'srbc',
        implement_id: 'hoe',
        origin: 'oem',
        odd: defaultOddProfile(true),
    },
    {
        id: 'mower',
        name: 'SRBC + faucheuse',
        vehicle_id: 'srbc',
        implement_id: 'mower',
        origin: 'local',
        odd: defaultOddProfile(false),
    },
];

const DOCUMENT: AgriDocument = {
    points: [{ columns: ['x', 'y'], values: [[0, 0]] }],
};

function emptyReport(): SimulationReport {
    return {
        samples: [],
        length_m: 12,
        duration_s: 4,
        minMarginM: null,
        sweptHull: [],
        coverage: null,
        checks: CHECK_GROUPS.map((group) => ({
            id: 'pending',
            group,
            status: 'skip',
            measured: null,
            threshold: null,
            sampleIndex: null,
            at: null,
        })),
        passCount: 0,
        warnCount: 0,
        blockCount: 0,
    };
}

function envelope(radius: number): CombinationEnvelope {
    return {
        vehicle: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        implement: null,
        collision: { minX: 0, minY: 0, maxX: radius, maxY: radius },
        hitch: null,
        axle: null,
        workPoint: null,
        navRef: { x: 0, y: 0 },
        hitchMode: null,
        sweptRadiusM: radius,
        trailerSwingRadiusM: null,
        minTurnRadiusM: 1,
        kinematics: 'skid_steer',
    };
}

function renderPanel(
    extras: {
        selectedCombinationId?: string;
        onSelectCombination?: ReturnType<typeof vi.fn>;
        hash?: string;
        report?: SimulationReport | null;
    } = {},
): { onSelectCombination: ReturnType<typeof vi.fn> } {
    const onSelectCombination = extras.onSelectCombination ?? vi.fn();
    const element: ReactElement = (
        <MemoryRouter initialEntries={[extras.hash ? `/simulation${extras.hash}` : '/simulation']}>
            <StudioProviders>
                <SimulationPanel
                    t={(key, params) => translate(key, params ?? {}, 'fr')}
                    document={DOCUMENT}
                    activePath="mission_order/2026-08-20_nord_semis.json"
                    combinations={COMBOS}
                    selectedCombinationId={extras.selectedCombinationId ?? 'hoe'}
                    onSelectCombination={onSelectCombination}
                    onSaveCombination={vi.fn()}
                    onLoadFarmMission={vi.fn()}
                    report={extras.report === undefined ? emptyReport() : extras.report}
                    publications={[]}
                    onLocate={vi.fn()}
                />
            </StudioProviders>
        </MemoryRouter>
    );
    render(element);
    return { onSelectCombination };
}

describe('SimulationPanel (T13.14)', () => {
    it('exposes the three simulation tabs', () => {
        renderPanel();
        expect(screen.getByRole('tab', { name: 'Configurer' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Résultats' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Rapport' })).toBeTruthy();
    });

    it('keeps every check group in the panel, not in the drawer', () => {
        const panel = readFileSync(
            resolve(ROOT, 'frontend/src/simulation/SimulationPanel.tsx'),
            'utf8',
        );
        const checks = readFileSync(
            resolve(ROOT, 'frontend/src/simulation/SimulationChecks.tsx'),
            'utf8',
        );
        const drawer = readFileSync(
            resolve(ROOT, 'frontend/src/simulation/SimulationDrawer.tsx'),
            'utf8',
        );
        expect(panel).toContain('SimulationChecks');
        expect(checks).toContain('studio-sim-checks');
        expect(checks).toContain('CHECK_GROUPS');
        expect(drawer).not.toContain('studio-sim-checks');
        expect(drawer).not.toContain('CHECK_GROUPS');
        expect(drawer).toContain('sim.allChecks');
        renderPanel();
        fireEvent.focus(screen.getByRole('tab', { name: 'Résultats' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Résultats' }));
        for (const group of CHECK_GROUPS) {
            expect(screen.getByText(translate(`sim.group.${group}`, {}, 'fr'))).toBeTruthy();
        }
    });

    it('invalidates the simulation fingerprint when the combination envelope changes', () => {
        const { onSelectCombination } = renderPanel();
        fireEvent.change(screen.getByLabelText('Combinaison'), { target: { value: 'mower' } });
        expect(onSelectCombination).toHaveBeenCalledWith('mower');
        const first = simulationFingerprint(DOCUMENT, envelope(1.2), 1.5, null);
        const second = simulationFingerprint(DOCUMENT, envelope(2.4), 1.5, null);
        expect(first).not.toBe(second);
    });

    it('pins the reduced drawer height', () => {
        expect(LAYOUT.simulationDefault).toBe(160);
        expect(LAYOUT.simulationMax).toBe(200);
    });
});
