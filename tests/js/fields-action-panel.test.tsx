import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { StudioProviders } from '../../frontend/src/design-system';
import { FieldInspector } from '../../frontend/src/fields/FieldInspector';
import { FieldsActionPanel, LINE_KINDS } from '../../frontend/src/fields/FieldsActionPanel';
import type { FieldsFollowUpForm } from '../../frontend/src/fields/useFieldsFollowUpForm';
import type { useFieldCatalogue } from '../../frontend/src/fields/useFieldCatalogue';
import { translate } from '../../frontend/src/i18n/adapter';

type Catalogue = ReturnType<typeof useFieldCatalogue>;

afterEach(() => {
    cleanup();
});

const t = (key: string, params?: Record<string, string | number>): string =>
    translate(key, params ?? {}, 'fr');

function catalogue(overrides: Partial<Catalogue> = {}): Catalogue {
    return {
        available: true,
        selected: null,
        focus: null,
        editIntent: 'none',
        followUp: null,
        lineKind: 'perennial',
        cropName: 'Vigne',
        zoneKind: 'workable',
        trafficKind: 'path',
        newName: 'Nouvelle zone',
        tool: 'select',
        draft: [],
        finishDraft: vi.fn(),
        cancelDraft: vi.fn(),
        lassoHits: [],
        versions: [],
        diff: null,
        impact: null,
        editingGeometry: false,
        setLineKind: vi.fn(),
        setCropName: vi.fn(),
        setZoneKind: vi.fn(),
        setNewName: vi.fn(),
        applyFollowUp: vi.fn(),
        dismissFollowUp: vi.fn(),
        deleteLassoHits: vi.fn(),
        cutLassoHits: vi.fn(),
        lassoOverlay: [],
        deleteGeofence: vi.fn(),
        ...overrides,
    } as unknown as Catalogue;
}

function form(overrides: Partial<FieldsFollowUpForm> = {}): FieldsFollowUpForm {
    return {
        count: '18',
        spacing: '2.5',
        side: 'right',
        bedWidth: '1.2',
        pathWidth: '3',
        setCount: vi.fn(),
        setSpacing: vi.fn(),
        setSide: vi.fn(),
        setBedWidth: vi.fn(),
        setPathWidth: vi.fn(),
        values: { count: 18, spacingM: 2.5, side: 'right', bedWidthM: 1.2, pathWidthM: 3 },
        ...overrides,
    };
}

function renderPanel(cat: Catalogue, followUpForm = form()): ReactElement {
    const element = (
        <StudioProviders>
            <FieldsActionPanel
                t={t}
                catalogue={cat}
                form={followUpForm}
                lassoTab="entities"
                onLassoTab={vi.fn()}
            />
        </StudioProviders>
    );
    render(element);
    return element;
}

describe('FieldsActionPanel — polyline options (CdC §5.2)', () => {
    it('offers the four line types while drawing a polyline', () => {
        renderPanel(catalogue({ editIntent: 'polyline', lineKind: 'bed' }));

        expect(screen.getByRole('heading', { name: 'Type d’objet' })).toBeDefined();
        expect(screen.getByRole('combobox', { name: 'Type d’objet' }).textContent).toContain(
            'Centre d’une planche maraîchère',
        );
        expect(LINE_KINDS).toEqual(['perennial', 'bed', 'guidance', 'path']);
        for (const kind of LINE_KINDS) {
            const key = `fields.edit.line.${kind}`;
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
    });

    it('asks for the crop only on a perennial row', () => {
        renderPanel(catalogue({ editIntent: 'polyline', lineKind: 'perennial' }));
        expect(screen.getByLabelText('Type de culture')).toBeDefined();

        cleanup();
        renderPanel(catalogue({ editIntent: 'polyline', lineKind: 'guidance' }));
        expect(screen.queryByLabelText('Type de culture')).toBeNull();
    });

    it('asks for copies, spacing and side after a perennial row', () => {
        renderPanel(catalogue({ followUp: 'duplicate_row' }));

        expect(screen.getByLabelText(/Nombre à dupliquer/)).toBeDefined();
        expect(screen.getByLabelText(/Entraxe/)).toBeDefined();
        expect(screen.getByLabelText('Côté')).toBeDefined();
        expect(screen.queryByLabelText(/Largeur cultivée/)).toBeNull();
    });

    it('adds the cultivated width after a vegetable bed centreline', () => {
        renderPanel(catalogue({ followUp: 'duplicate_bed' }));

        expect(screen.getByLabelText(/Largeur cultivée/)).toBeDefined();
        expect(screen.getByLabelText(/Nombre à dupliquer/)).toBeDefined();
    });

    it('asks only for the width after a traffic path, and generates the sweep', () => {
        const applyFollowUp = vi.fn();
        renderPanel(catalogue({ followUp: 'path_width', applyFollowUp }));

        expect(screen.getByLabelText(/Largeur du chemin/)).toBeDefined();
        expect(screen.queryByLabelText(/Nombre à dupliquer/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Générer' }));
        expect(applyFollowUp).toHaveBeenCalledWith({
            count: 18,
            spacingM: 2.5,
            side: 'right',
            bedWidthM: 1.2,
            pathWidthM: 3,
        });
    });

    it('shows nothing for a guidance line, which has no option', () => {
        renderPanel(catalogue({ editIntent: 'none', followUp: null }));
        expect(screen.queryByRole('heading', { name: 'Type d’objet' })).toBeNull();
    });

    it('carries the line name and both draft buttons while the trace is open', () => {
        const finishDraft = vi.fn();
        const cancelDraft = vi.fn();
        renderPanel(
            catalogue({
                editIntent: 'polyline',
                lineKind: 'guidance',
                tool: 'draw_line',
                draft: [
                    { lat: 45.85, lng: 3.17 },
                    { lat: 45.851, lng: 3.171 },
                ],
                newName: 'Nouvelle ligne de guidage',
                finishDraft,
                cancelDraft,
            }),
        );

        expect(screen.getByLabelText('Nom de la ligne')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Valider la ligne' }));
        expect(finishDraft).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Annuler le tracé' }));
        expect(cancelDraft).toHaveBeenCalled();
    });

    it('keeps validation disabled until the line has two points', () => {
        renderPanel(
            catalogue({
                editIntent: 'polyline',
                tool: 'draw_line',
                draft: [{ lat: 45.85, lng: 3.17 }],
            }),
        );

        expect(
            screen.getByRole('button', { name: 'Valider la ligne' }).hasAttribute('disabled'),
        ).toBe(true);
    });
});

describe('FieldsActionPanel — lasso portions', () => {
    it('cuts the selected portions instead of deleting the whole rows', () => {
        const cutLassoHits = vi.fn();
        const deleteLassoHits = vi.fn();
        render(
            <StudioProviders>
                <FieldsActionPanel
                    t={t}
                    catalogue={catalogue({
                        editIntent: 'lasso',
                        lassoHits: [
                            {
                                kind: 'row',
                                fieldId: 'field-1',
                                rowSetId: 'set-1',
                                id: 'row-1',
                                label: 'Vigne 1',
                            },
                        ],
                        cutLassoHits,
                        deleteLassoHits,
                    })}
                    form={form()}
                    lassoTab="portions"
                    onLassoTab={vi.fn()}
                />
            </StudioProviders>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Couper la sélection' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirmer la coupe' }));
        expect(cutLassoHits).toHaveBeenCalledTimes(1);
        expect(deleteLassoHits).not.toHaveBeenCalled();
    });
});

describe('FieldsActionPanel placement', () => {
    it('renders inside the right inspector, not in a panel below the map', () => {
        render(
            <StudioProviders>
                <FieldInspector
                    t={t}
                    language="fr"
                    catalogue={catalogue({ editIntent: 'polyline' })}
                    missionPath={null}
                    actions={
                        <FieldsActionPanel
                            t={t}
                            catalogue={catalogue({ editIntent: 'polyline' })}
                            form={form()}
                            lassoTab="entities"
                            onLassoTab={vi.fn()}
                        />
                    }
                />
            </StudioProviders>,
        );

        const inspector = document.querySelector('[data-field-inspector="true"]');
        const action = document.querySelector('.studio-fields-action');
        expect(inspector).not.toBeNull();
        expect(action).not.toBeNull();
        expect(inspector?.contains(action as Node)).toBe(true);
    });

    it('offers the four landmark tools and pins the trace', () => {
        const pinLandmark = vi.fn();
        const setLandmarkKind = vi.fn();
        renderPanel(
            catalogue({
                editIntent: 'landmark',
                tool: 'ruler',
                landmarkKind: 'measure',
                landmarkMeasure: { lastSegmentM: 12.4, segmentsM: [12.4], areaM2: null },
                landmarkHover: null,
                circleRadiusM: '10',
                setLandmarkKind,
                setCircleRadiusM: vi.fn(),
                canPinLandmark: true,
                pinLandmark,
                newName: 'Règle',
            }),
        );

        expect(screen.getByRole('heading', { name: 'Règle' })).toBeDefined();
        expect(screen.getByRole('combobox', { name: 'Outil de repère' }).textContent).toContain(
            'Règle',
        );
        expect(screen.getByText('Distance : 12.4 m')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Tracer sur la carte' }));
        expect(pinLandmark).toHaveBeenCalledTimes(1);
    });

    it('shows a live radius field for the circle tool', () => {
        renderPanel(
            catalogue({
                editIntent: 'landmark',
                tool: 'ruler',
                landmarkKind: 'circle',
                landmarkMeasure: { lastSegmentM: null, segmentsM: [], areaM2: null },
                landmarkHover: null,
                circleRadiusM: '8.5',
                setLandmarkKind: vi.fn(),
                setCircleRadiusM: vi.fn(),
                canPinLandmark: true,
                pinLandmark: vi.fn(),
                draft: [{ lat: 45.85, lng: 3.17 }],
                newName: 'Cercle',
            }),
        );
        expect(screen.getByLabelText('Rayon')).toBeDefined();
        expect((screen.getByLabelText('Rayon') as HTMLInputElement).value).toBe('8.5');
    });

    it('drops the inspector heading and its tab bar from the right panel', () => {
        render(
            <StudioProviders>
                <FieldInspector
                    t={t}
                    language="fr"
                    catalogue={catalogue({ editIntent: 'polyline' })}
                    missionPath={null}
                    actions={null}
                />
            </StudioProviders>,
        );

        expect(screen.queryByRole('heading', { name: 'Inspecteur' })).toBeNull();
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
        expect(screen.getByRole('heading', { name: 'Options' })).toBeDefined();
    });

    it('folds the details of the selected object under the options', () => {
        const field = {
            id: 'field-1',
            name: 'Champ Nord',
            campaign: null,
            geometry: { type: 'Polygon' as const, coordinates: [[]] },
            crs: 'EPSG:4326',
            provenance: {},
            qualified_for_autonomy: false,
            created_at: '2026-08-23T08:00:00Z',
            updated_at: '2026-08-23T08:00:00Z',
            version: 1,
            zones: [],
            obstacles: [],
            guidance_lines: [],
            row_sets: [],
            traffic_ways: [],
            traffic_nodes: [],
            landmarks: [],
        };
        render(
            <StudioProviders>
                <FieldInspector
                    t={t}
                    language="fr"
                    catalogue={catalogue({
                        selected: field,
                        focus: { kind: 'field', id: 'field-1' },
                    })}
                    missionPath={null}
                    actions={null}
                />
            </StudioProviders>,
        );

        const trigger = screen.getByRole('button', { name: /Objet sélectionné/ });
        expect(trigger.getAttribute('data-state')).toBe('closed');
        expect(screen.queryByLabelText('Nom')).toBeNull();

        fireEvent.click(trigger);
        expect(screen.getByLabelText('Nom')).toBeDefined();
    });
});
