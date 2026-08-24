import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { StudioProviders } from '../../frontend/src/design-system';
import { nextFieldDraftName } from '../../frontend/src/fields/edit-tools';
import {
    fieldNavigationGroups,
    FieldsPanel,
    type FieldsPanelProps,
} from '../../frontend/src/fields/FieldsPanel';
import { translate } from '../../frontend/src/i18n/adapter';

const ROOT = resolve(import.meta.dirname, '../..');

afterEach(() => {
    cleanup();
});

const field = {
    id: 'field-1',
    name: 'Champ Nord',
    campaign: '2026',
    geometry: {
        type: 'Polygon' as const,
        coordinates: [
            [
                [3.17, 45.85],
                [3.171, 45.85],
                [3.171, 45.851],
                [3.17, 45.851],
                [3.17, 45.85],
            ],
        ],
    },
    crs: 'EPSG:4326',
    provenance: {},
    qualified_for_autonomy: false,
    created_at: '2026-08-20T08:00:00Z',
    updated_at: '2026-08-20T08:00:00Z',
};

function props(overrides: Partial<FieldsPanelProps> = {}): FieldsPanelProps {
    return {
        t: (key, params) => translate(key, params ?? {}, 'fr'),
        catalogue: {
            available: true,
            loading: false,
            error: null,
            fields: [field],
            selectedId: null,
            selected: null,
            select: vi.fn(),
            importFile: vi.fn(),
            hiddenIds: [],
            lockedIds: [],
            toggleHidden: vi.fn(),
            toggleLocked: vi.fn(),
        } as unknown as FieldsPanelProps['catalogue'],
        ...overrides,
    };
}

function renderPanel(panelProps = props()): ReactElement {
    const element = (
        <StudioProviders>
            <FieldsPanel {...panelProps} />
        </StudioProviders>
    );
    render(element);
    return element;
}

describe('FieldsPanel (T13.12)', () => {
    it('renders two tabs with Explore open by default', () => {
        renderPanel();

        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.getByRole('tab', { name: 'Explorer' }).dataset.state).toBe('active');
        expect(screen.getByRole('button', { name: 'Aucune parcelle sélectionnée' })).toBeDefined();
        expect(screen.getByRole('heading', { name: 'Créer une nouvelle parcelle' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'À partir de la carte' })).toBeDefined();
        expect(
            screen
                .getByRole('button', { name: 'À partir d’un fichier importé' })
                .hasAttribute('disabled'),
        ).toBe(true);
        expect(screen.getByText('Champ Nord')).toBeDefined();
        expect(screen.getByText(/ha$/)).toBeDefined();
        expect(fieldNavigationGroups([field])).toEqual([{ id: 'all', fields: [field] }]);
    });

    it('selects a field with fit requested, which drives MapEngine.fitBounds', () => {
        const select = vi.fn();
        renderPanel(
            props({
                catalogue: {
                    ...props().catalogue,
                    select,
                },
            }),
        );

        fireEvent.click(screen.getByRole('button', { name: /Champ Nord/ }));
        expect(select).toHaveBeenCalledWith('field-1', { fit: true });

        const canvas = readFileSync(resolve(ROOT, 'frontend/src/map/MapCanvas.tsx'), 'utf8');
        const engine = readFileSync(resolve(ROOT, 'frontend/src/map/engine.ts'), 'utf8');
        const maplibre = readFileSync(resolve(ROOT, 'frontend/src/map/maplibre-engine.ts'), 'utf8');
        expect(engine).toContain('fitBounds(');
        expect(canvas).toContain('engine.fitBounds(bounds)');
        expect(maplibre).toContain('instance.fitBounds([sw, ne]');
    });

    it('keeps Edit disabled until a field is selected', () => {
        renderPanel();
        expect(screen.getByRole('tab', { name: 'Éditer' }).hasAttribute('disabled')).toBe(true);
    });

    it('opens Edit on the geometry tree of the selected field', () => {
        renderPanel(
            props({
                catalogue: {
                    ...props().catalogue,
                    selectedId: 'field-1',
                    selected: {
                        ...field,
                        version: 1,
                        zones: [],
                        obstacles: [],
                        guidance_lines: [
                            {
                                id: 'line-1',
                                field_id: 'field-1',
                                name: 'Ligne AB',
                                geometry: { type: 'LineString', coordinates: [] },
                                provenance: {},
                                created_at: '2026-08-20T08:00:00Z',
                            },
                        ],
                        row_sets: [],
                        traffic_ways: [],
                        traffic_nodes: [],
                        landmarks: [],
                    },
                },
                uiMode: 'advanced',
                tab: 'edit',
            }),
        );

        expect(screen.getByRole('heading', { name: 'Arbre de géométrie' })).toBeDefined();
        expect(screen.getByRole('button', { name: /Limite de parcelle/ })).toBeDefined();
        expect(screen.getByRole('button', { name: /Ligne AB/ })).toBeDefined();
        expect(screen.getAllByRole('button', { name: 'Masquer sur la carte' })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Verrouiller la géométrie' })).toHaveLength(2);
        expect(
            screen.getByRole('button', { name: 'Importer un fichier' }).hasAttribute('disabled'),
        ).toBe(true);
        expect(
            screen.getByRole('button', { name: 'Exporter la parcelle (GeoJSON)' }),
        ).toBeDefined();
    });

    it('offers the exclusion area only once the geofence is selected', () => {
        const startExclusionZone = vi.fn();
        const geofenced = {
            ...props().catalogue,
            selectedId: 'field-1',
            selected: {
                ...field,
                version: 1,
                zones: [
                    {
                        id: 'fence-1',
                        field_id: 'field-1',
                        kind: 'autonomy',
                        name: null,
                        geometry: field.geometry,
                        provenance: {},
                        created_at: '2026-08-20T08:00:00Z',
                    },
                ],
                obstacles: [],
                guidance_lines: [],
                row_sets: [],
                traffic_ways: [],
                traffic_nodes: [],
                landmarks: [],
            },
            startExclusionZone,
        };

        renderPanel(
            props({
                catalogue: geofenced as unknown as FieldsPanelProps['catalogue'],
                uiMode: 'advanced',
                tab: 'edit',
            }),
        );
        expect(screen.queryByRole('button', { name: /zone d’exclusion/i })).toBeNull();
        cleanup();

        renderPanel(
            props({
                catalogue: {
                    ...geofenced,
                    focus: { kind: 'zone', fieldId: 'field-1', id: 'fence-1' },
                } as unknown as FieldsPanelProps['catalogue'],
                uiMode: 'advanced',
                tab: 'edit',
            }),
        );
        fireEvent.click(screen.getByRole('button', { name: /Ajouter une zone d’exclusion/ }));
        expect(startExclusionZone).toHaveBeenCalledTimes(1);
    });

    it('does not keep the retired import tabs', () => {
        renderPanel(props({ uiMode: 'advanced' }));
        expect(screen.queryByRole('tab', { name: 'Importer un travail réalisé' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Importer depuis un tiers' })).toBeNull();
        expect(screen.queryByText('Importer depuis un tiers')).toBeNull();
    });

    it('provides all new visible labels in French and English', () => {
        const keys = [
            'fields.tab.navigate',
            'fields.tab.explore',
            'fields.tab.edit',
            'fields.create.fromMap',
            'fields.create.fromFile',
            'fields.create.fromFile.comingSoon',
            'fields.importFile',
            'fields.importFile.comingSoon',
            'fields.active.none',
        ];
        for (const key of keys) {
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
    });

    it('suggests a numbered default field name', () => {
        expect(nextFieldDraftName([])).toBe('Nouvelle parcelle n°1');
        expect(nextFieldDraftName([{ name: 'Nouvelle parcelle n°1' } as typeof field])).toBe(
            'Nouvelle parcelle n°2',
        );
    });

    it('keeps the header name when the detail fetch is still pending', () => {
        renderPanel(
            props({
                catalogue: {
                    ...props().catalogue,
                    selectedId: 'field-1',
                    selected: null,
                },
            }),
        );

        expect(screen.getByRole('button', { name: 'Champ Nord' })).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Aucune parcelle sélectionnée' })).toBeNull();
    });
});
