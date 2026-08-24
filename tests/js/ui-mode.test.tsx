import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { fetchFarmTree, isAdvancedUi } from '../../frontend/src/app/farm-api';
import { StudioProviders } from '../../frontend/src/design-system';
import { defaultOddProfile } from '../../frontend/src/domain/odd';
import { FieldsPanel, type FieldsPanelProps } from '../../frontend/src/fields/FieldsPanel';
import { translate } from '../../frontend/src/i18n/adapter';
import { EditToolbar } from '../../frontend/src/map/EditToolbar';
import { ZoneActionPanel } from '../../frontend/src/map/ZoneActionPanel';
import { SectionEditPanel } from '../../frontend/src/map/SectionEditPanel';
import { MissionPanel, type MissionPanelProps } from '../../frontend/src/missions/MissionPanel';
import { SimulationPanel } from '../../frontend/src/simulation/SimulationPanel';

vi.mock('../../frontend/src/app/farm-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../frontend/src/app/farm-api')>();
    return {
        ...actual,
        fetchFarmTree: vi.fn(),
        fetchFarmMission: vi.fn(),
        saveFarmMission: vi.fn(),
    };
});

vi.mock('../../frontend/src/missions/MissionAssistant', () => ({
    MissionAssistant: ({ view }: { view?: string }) => (
        <div data-testid={`mission-assistant-${view ?? 'all'}`}>{view}</div>
    ),
}));

const farmTree = vi.mocked(fetchFarmTree);

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    farmTree.mockResolvedValue({ mission_order: [], work_performed: [] });
});

const t = (key: string, params?: Record<string, string | number>) =>
    translate(key, params ?? {}, 'fr');

function wrap(node: ReactElement): ReactElement {
    return (
        <MemoryRouter>
            <StudioProviders>{node}</StudioProviders>
        </MemoryRouter>
    );
}

describe('ui_mode (L13 §8 / T13.17)', () => {
    it('treats only explicit basic as the reduced chrome', () => {
        expect(isAdvancedUi('basic')).toBe(false);
        expect(isAdvancedUi('advanced')).toBe(true);
        expect(isAdvancedUi(undefined)).toBe(true);
    });

    it('hides the Mission Edit tab in basic and keeps the Administration link', () => {
        const props = {
            t,
            onSelectMission: vi.fn(),
            onLoadFarmMission: vi.fn(),
            onPublish: vi.fn(),
            publications: {
                available: false,
                items: [],
                error: null,
                loading: false,
                reload: vi.fn(),
                publish: vi.fn(),
                setError: vi.fn(),
            },
            vehicles: [],
            combinations: [],
            implements: [],
            activePath: null,
            assistant: { open: false, start: vi.fn(), close: vi.fn() },
            uiMode: 'basic' as const,
        } as unknown as MissionPanelProps;
        render(wrap(<MissionPanel {...props} />));

        expect(screen.queryByRole('tab', { name: 'Éditer' })).toBeNull();
        expect(screen.getByRole('tab', { name: 'Explorer' })).toBeTruthy();
        expect(
            screen.getByRole('link', { name: 'Passer en mode avancé' }).getAttribute('href'),
        ).toBe('/administration');
    });

    it('shows the Mission Edit tab in advanced without the switch link', () => {
        const props = {
            t,
            onSelectMission: vi.fn(),
            onLoadFarmMission: vi.fn(),
            onPublish: vi.fn(),
            publications: {
                available: false,
                items: [],
                error: null,
                loading: false,
                reload: vi.fn(),
                publish: vi.fn(),
                setError: vi.fn(),
            },
            vehicles: [],
            combinations: [],
            implements: [],
            activePath: null,
            assistant: { open: false, start: vi.fn(), close: vi.fn() },
            uiMode: 'advanced' as const,
        } as unknown as MissionPanelProps;
        render(wrap(<MissionPanel {...props} />));

        expect(screen.getByRole('tab', { name: 'Éditer' })).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Passer en mode avancé' })).toBeNull();
    });

    it('hides advanced row generation in basic, not the import tabs', () => {
        const catalogue = {
            available: true,
            loading: false,
            error: null,
            fields: [],
            selectedId: null,
            selected: null,
            select: vi.fn(),
            importFile: vi.fn(),
        } as unknown as FieldsPanelProps['catalogue'];
        render(wrap(<FieldsPanel t={t} catalogue={catalogue} uiMode="basic" />));

        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.queryByRole('tab', { name: 'Importer un travail réalisé' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Importer depuis un tiers' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Passer en mode avancé' })).toBeTruthy();
    });

    it('keeps two parcel tabs in advanced', () => {
        const catalogue = {
            available: true,
            loading: false,
            error: null,
            fields: [],
            selectedId: null,
            selected: null,
            select: vi.fn(),
            importFile: vi.fn(),
        } as unknown as FieldsPanelProps['catalogue'];
        render(wrap(<FieldsPanel t={t} catalogue={catalogue} uiMode="advanced" />));

        expect(screen.getAllByRole('tab')).toHaveLength(2);
        expect(screen.queryByRole('tab', { name: 'Importer un travail réalisé' })).toBeNull();
        expect(screen.getByRole('tab', { name: 'Explorer' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Éditer' })).toBeTruthy();
    });

    it('shows the slim edit rail in basic', () => {
        const noop = vi.fn();
        render(
            wrap(
                <EditToolbar
                    t={t}
                    uiMode="basic"
                    tool="none"
                    draftCount={0}
                    canUndo={false}
                    canRedo={false}
                    onSelectZone={noop}
                    onSelectPolygon={noop}
                    onDrawLine={noop}
                    onDrawPolygon={noop}
                    onFillParcel={noop}
                    onConnectEnds={noop}
                    onRuler={noop}
                    onFinish={noop}
                    onUndo={noop}
                    onRedo={noop}
                />,
            ),
        );

        expect(screen.getByRole('button', { name: 'Sélectionner une entité' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Sélectionner par zone' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Tracer une trajectoire' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remplir la parcelle' })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Géo-clôture/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Connecter' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Règle' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /zone de travail/i })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Décaler' })).toBeNull();
        expect(screen.queryByRole('button', { name: /vitesse/i })).toBeNull();
        expect(screen.getByRole('link', { name: 'Passer en mode avancé' })).toBeTruthy();
    });

    it('hides the advanced-mode link in advanced', () => {
        const noop = vi.fn();
        render(
            wrap(
                <EditToolbar
                    t={t}
                    uiMode="advanced"
                    tool="none"
                    draftCount={0}
                    canUndo={false}
                    canRedo={false}
                    onSelectZone={noop}
                    onSelectPolygon={noop}
                    onDrawLine={noop}
                    onDrawPolygon={noop}
                    onFillParcel={noop}
                    onConnectEnds={noop}
                    onRuler={noop}
                    onFinish={noop}
                    onUndo={noop}
                    onRedo={noop}
                />,
            ),
        );

        expect(screen.getByRole('button', { name: 'Connecter' })).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Passer en mode avancé' })).toBeNull();
    });

    it('hides rotation, duplication and extension in basic', () => {
        const noop = vi.fn();
        render(
            wrap(
                <SectionEditPanel
                    t={t}
                    uiMode="basic"
                    selectedCount={1}
                    moveStep="0.1"
                    onMoveStep={noop}
                    onMove={noop}
                    rotationStep="5"
                    onRotationStep={noop}
                    onRotate={noop}
                    duplicateCount="1"
                    onDuplicateCount={noop}
                    duplicateDistance="2"
                    onDuplicateDistance={noop}
                    duplicateSide="left"
                    onDuplicateSide={noop}
                    onDuplicate={noop}
                    extendDirection={null}
                    onStartExtend={noop}
                    onCancelExtend={noop}
                />,
            ),
        );

        expect(screen.getByRole('heading', { name: 'Déplacer' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Tourner' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Dupliquer' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Rallonger' })).toBeNull();
        expect(screen.getByRole('link', { name: 'Passer en mode avancé' })).toBeTruthy();
    });

    it('shows transforms in advanced', () => {
        const noop = vi.fn();
        render(
            wrap(
                <SectionEditPanel
                    t={t}
                    uiMode="advanced"
                    selectedCount={1}
                    moveStep="0.1"
                    onMoveStep={noop}
                    onMove={noop}
                    rotationStep="5"
                    onRotationStep={noop}
                    onRotate={noop}
                    duplicateCount="1"
                    onDuplicateCount={noop}
                    duplicateDistance="2"
                    onDuplicateDistance={noop}
                    duplicateSide="left"
                    onDuplicateSide={noop}
                    onDuplicate={noop}
                    extendDirection={null}
                    onStartExtend={noop}
                    onCancelExtend={noop}
                />,
            ),
        );

        expect(screen.getByRole('heading', { name: 'Tourner' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Dupliquer' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Rallonger' })).toBeTruthy();
    });

    it('hides manual ODD editing in the simulation panel in basic', () => {
        render(
            wrap(
                <SimulationPanel
                    t={t}
                    uiMode="basic"
                    document={{ points: [] }}
                    activePath={null}
                    combinations={[
                        {
                            id: 'hoe',
                            name: 'SRBC + bineuse',
                            vehicle_id: 'srbc',
                            implement_id: 'hoe',
                            origin: 'oem',
                            odd: defaultOddProfile(true),
                        },
                    ]}
                    selectedCombinationId="hoe"
                    onSelectCombination={vi.fn()}
                    onSaveCombination={vi.fn()}
                    onLoadFarmMission={vi.fn()}
                    report={null}
                    publications={[]}
                    onLocate={vi.fn()}
                />,
            ),
        );

        expect(screen.getByLabelText('Combinaison')).toBeTruthy();
        expect(screen.queryByLabelText('Approbation ODD')).toBeNull();
        expect(screen.getByRole('link', { name: 'Passer en mode avancé' })).toBeTruthy();
    });

    it('offers entity and portion actions after a lasso selection', () => {
        const onMode = vi.fn();
        render(
            wrap(
                <ZoneActionPanel
                    t={t}
                    mode="entities"
                    workingZoneOn
                    speedDraft="0.5"
                    entityTools={<p>Déplacer</p>}
                    onMode={onMode}
                    onCut={vi.fn()}
                    onWorkingZone={vi.fn()}
                    onSpeedDraft={vi.fn()}
                    onApplySpeed={vi.fn()}
                    onConnectTurns={vi.fn()}
                    onReverse={vi.fn()}
                    onDelete={vi.fn()}
                />,
            ),
        );

        expect(screen.getByRole('tab', { name: 'Sélection par entité' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Sélection par zone' })).toBeTruthy();
        expect(screen.getByText('Déplacer')).toBeTruthy();
        expect(screen.getByRole('button', { name: /demi-tours/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Inverser le sens' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Suppression des entités' })).toBeTruthy();
    });

    it('keeps reverse and delete off the edit rail', () => {
        const noop = vi.fn();
        render(
            wrap(
                <EditToolbar
                    t={t}
                    uiMode="basic"
                    tool="select_zone"
                    draftCount={0}
                    canUndo={false}
                    canRedo={false}
                    onSelectZone={noop}
                    onSelectPolygon={noop}
                    onDrawLine={noop}
                    onDrawPolygon={noop}
                    onFillParcel={noop}
                    onConnectEnds={noop}
                    onRuler={noop}
                    onFinish={noop}
                    onUndo={noop}
                    onRedo={noop}
                />,
            ),
        );

        expect(screen.queryByRole('button', { name: 'Inverser le sens' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Supprimer la sélection' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Suppression des entités' })).toBeNull();
    });
});
