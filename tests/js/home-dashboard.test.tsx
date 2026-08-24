import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { HomeDashboard } from '../../frontend/src/app/HomeDashboard';
import {
    EMPTY_COUNTS,
    FARM_KINDS,
    FARM_TYPES,
    farmFolderName,
    type FarmDocument,
    type FarmEntry,
} from '../../frontend/src/app/farm-api';
import type { FarmState } from '../../frontend/src/app/useFarm';
import type { FieldSummary } from '../../frontend/src/fields/types';
import { translate } from '../../frontend/src/i18n/adapter';

afterEach(() => {
    cleanup();
});

const FARM: FarmDocument = {
    schema: 'srbc.farm/1',
    name: 'Ferme des Grands Champs',
    farm_type: 'market_garden',
    start_view: { lat: 45.1, lon: 3.2, zoom: 16 },
    language: 'fr',
    theme: 'light',
    ui_mode: 'advanced',
    units: 'metric',
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-08-19T08:00:00Z',
};

function mission(name: string, extra: Partial<FarmEntry> = {}): FarmEntry {
    return {
        name,
        path: `mission_order/${name}`,
        size: 512,
        modified: Date.parse('2026-08-18T10:00:00Z'),
        simulated: false,
        published: false,
        ...extra,
    };
}

function farmState(overrides: Partial<FarmState> = {}): FarmState {
    const snapshot = {
        farm: FARM,
        root: '/Users/apo/fermes/grands-champs',
        counts: EMPTY_COUNTS,
        recent: [],
        cropPack: 'market_garden',
    };
    return {
        available: true,
        loading: false,
        error: null,
        setError: vi.fn(),
        snapshot,
        farm: snapshot.farm,
        root: snapshot.root,
        counts: snapshot.counts,
        recent: snapshot.recent,
        missions: [],
        work: [],
        reload: vi.fn(),
        save: vi.fn(),
        open: vi.fn(),
        reindex: vi.fn(),
        ...overrides,
    } as FarmState;
}

function renderHome(
    state: FarmState,
    onOpenMission?: (entry: FarmEntry) => void,
    mappedFields?: FieldSummary[],
): ReactElement {
    const element = (
        <MemoryRouter>
            <HomeDashboard
                t={(key, params) => translate(key, params ?? {}, 'fr')}
                language="fr"
                farm={state}
                combinationCount={0}
                mappedFields={mappedFields}
                onOpenMission={onOpenMission}
            />
        </MemoryRouter>
    );
    render(element);
    return element;
}

describe('home dashboard figures (CdC L13 §7.2)', () => {
    it('shows a dash and its reason for work hours, never a zero', () => {
        renderHome(farmState());
        const hours = screen.getByText('Heures de travail réalisées').closest('div');
        expect(hours?.textContent).toContain('—');
        expect(hours?.textContent).toContain('Pas encore de journal robot');
        expect(hours?.textContent).not.toContain('0');
    });

    it('shows 0 ha for an empty farm, since zero mapped hectares is a fact', () => {
        renderHome(farmState());
        const fields = screen.getByText('Hectares cartographiés').closest('div');
        expect(fields?.textContent).toContain('0 ha');
    });

    it('dashes the hectares when fields exist but none carries a usable outline', () => {
        renderHome(
            farmState({
                counts: { ...EMPTY_COUNTS, fields: 3, hectares: null },
            }),
        );
        const fields = screen.getByText('Hectares cartographiés').closest('div');
        expect(fields?.textContent).toContain('—');
        expect(fields?.textContent).toContain('Parcelles sans contour exploitable');
    });

    it('shows measured hectares and the mission and equipment counters', () => {
        renderHome(
            farmState({
                counts: { ...EMPTY_COUNTS, fields: 2, missions: 4, hectares: 12.5 },
            }),
        );
        expect(screen.getByText('12,5 ha')).toBeDefined();
        expect(screen.getByText('Missions prêtes').closest('div')?.textContent).toContain('4');
        expect(screen.getByText('Combinaisons de matériel').closest('div')?.textContent).toContain(
            '0',
        );
    });

    it('computes hectares from the fields currently visible in the catalogue', () => {
        const field: FieldSummary = {
            id: 'field-1',
            name: 'Parcelle test',
            campaign: null,
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [0, 0],
                        [0.0009, 0],
                        [0.0009, 0.0009],
                        [0, 0.0009],
                        [0, 0],
                    ],
                ],
            },
            crs: 'EPSG:4326',
            provenance: {},
            qualified_for_autonomy: false,
            created_at: '2026-08-20T10:00:00Z',
            updated_at: '2026-08-20T10:00:00Z',
        };

        renderHome(farmState(), undefined, [field]);

        expect(screen.getByText('1 ha')).toBeDefined();
    });
});

describe('home dashboard identity and lists', () => {
    it('names the farm, its type and its working folder', () => {
        renderHome(farmState());
        expect(screen.getByText('Ferme des Grands Champs')).toBeDefined();
        expect(screen.getByText('Maraîchage')).toBeDefined();
        expect(screen.getByText('grands-champs')).toBeDefined();
        expect(screen.getByText('Hors ligne')).toBeDefined();
    });

    it('invites opening a farm when none is open, and hides the figures', () => {
        const state = farmState();
        renderHome(
            farmState({
                snapshot: { ...state.snapshot, farm: null, root: null },
                farm: null,
                root: null,
            }),
        );
        expect(screen.getByText('Aucune ferme ouverte')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Ouvrir une ferme' })).toBeDefined();
        expect(screen.queryByText('Heures de travail réalisées')).toBeNull();
    });

    it('keeps at most five missions in the resume list', () => {
        const missions = Array.from({ length: 7 }, (_, index) => mission(`m${index}.json`));
        renderHome(farmState({ missions }));
        const resume = screen.getByText('Reprendre').closest('section');
        expect(resume?.querySelectorAll('li')).toHaveLength(5);
    });

    it('lists only unsimulated missions as needing revalidation', () => {
        const missions = [
            mission('ready.json', { simulated: true }),
            mission('todo.json'),
            mission('broken.json', { unreadable: true }),
        ];
        renderHome(farmState({ missions }));
        const revalidate = screen.getByText('À revalider (1)').closest('section');
        expect(revalidate?.textContent).toContain('todo');
        expect(revalidate?.textContent).not.toContain('ready');
    });

    it('opens a mission on click and never offers to open a corrupted one', () => {
        const onOpenMission = vi.fn();
        renderHome(
            farmState({
                missions: [mission('todo.json'), mission('broken.json', { unreadable: true })],
            }),
            onOpenMission,
        );
        const resume = screen.getByText('Reprendre').closest('section');
        const buttons = Array.from(resume?.querySelectorAll('button') ?? []);
        fireEvent.click(buttons[0]);
        expect(onOpenMission).toHaveBeenCalledTimes(1);
        expect(buttons[1].disabled).toBe(true);
    });

    it('warns when the versioned backend is absent instead of failing silently', () => {
        renderHome(farmState({ available: false }));
        expect(screen.getByRole('status').textContent).toContain('BACKEND_FASTAPI');
    });
});

describe('redundant module navigation (CdC L13 §7.1)', () => {
    it('no longer repeats the rail inside the context panel', () => {
        const source = readFileSync('frontend/src/app/PlaceholderModule.tsx', 'utf8');
        expect(source).not.toContain('studio-context-nav');
        expect(source).not.toContain('NavLink');
        expect(source).toContain('studio-mission-list');
    });
});

describe('farm api client', () => {
    it('exposes the four farm folders and the five farm types', () => {
        expect(FARM_KINDS).toEqual(['parcel_map', 'mission_order', 'work_performed', 'equipment']);
        expect(FARM_TYPES).toHaveLength(5);
    });

    it('reduces a root path to its folder name, trailing separator or not', () => {
        expect(farmFolderName('/farms/xy')).toBe('xy');
        expect(farmFolderName('/farms/xy/')).toBe('xy');
        expect(farmFolderName(null)).toBe('');
    });
});

describe('home and farm i18n keys', () => {
    it('exist in French and English', () => {
        const keys = [
            'home.folder',
            'home.sync.offline',
            'home.figure.fields',
            'home.figure.hours',
            'home.figure.hours.hint',
            'home.resume',
            'home.revalidate.empty',
            'home.action.mission',
            'farm.unavailable',
            'farm.type.vineyard',
        ];
        for (const key of keys) {
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
        expect(translate('home.figure.hectares', { value: 4 }, 'en')).toBe('4 ha');
        expect(translate('home.revalidate', { count: 2 }, 'fr')).toBe('À revalider (2)');
    });
});
