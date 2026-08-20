import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { StudioProviders } from '../../frontend/src/design-system';
import {
    fieldNavigationGroups,
    FieldsPanel,
    type FieldsPanelProps,
} from '../../frontend/src/fields/FieldsPanel';
import { translate } from '../../frontend/src/i18n/adapter';

const ROOT = resolve(import.meta.dirname, '../..');

vi.mock('../../frontend/src/fields/FieldsContextPanel', () => ({
    FieldsContextPanel: () => <div data-testid="fields-context-panel">éditeur existant</div>,
}));

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
    it('renders four tabs with Browse open by default', () => {
        renderPanel();

        expect(screen.getAllByRole('tab')).toHaveLength(4);
        expect(screen.getByRole('tab', { name: 'Naviguer' }).dataset.state).toBe('active');
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
        expect(maplibre).toContain('map.fitBounds([sw, ne]');
    });

    it('mounts the existing editor unchanged in the second tab', () => {
        renderPanel();
        fireEvent.focus(screen.getByRole('tab', { name: 'Éditer' }));

        expect(screen.getByTestId('fields-context-panel')).toBeDefined();
    });

    it('announces unsupported third-party formats instead of ignoring them', () => {
        renderPanel();
        fireEvent.focus(screen.getByRole('tab', { name: 'Importer depuis un tiers' }));

        expect(screen.getByText('KML')).toBeDefined();
        expect(screen.getByText('Shapefile (.shp + annexes)')).toBeDefined();
        expect(screen.getByText('GeoPackage (.gpkg)')).toBeDefined();
        expect(screen.getAllByText('Non disponible — convertissez en GeoJSON')).toHaveLength(3);
    });

    it('provides all new visible labels in French and English', () => {
        const keys = [
            'fields.tab.navigate',
            'fields.tab.edit',
            'fields.tab.workPerformed',
            'fields.tab.thirdParty',
            'fields.work.needField',
            'fields.thirdParty.notAvailable',
        ];
        for (const key of keys) {
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
    });
});
