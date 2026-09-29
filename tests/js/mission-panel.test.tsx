import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchFarmMission, fetchFarmTree, saveFarmMission } from '../../frontend/src/app/farm-api';
import { StudioProviders } from '../../frontend/src/design-system';
import { getField } from '../../frontend/src/fields/api';
import { MissionPanel, type MissionPanelProps } from '../../frontend/src/missions/MissionPanel';
import { translate } from '../../frontend/src/i18n/adapter';
import { downloadAgriDocument } from '../../frontend/src/map/missions-api';

vi.mock('../../frontend/src/app/farm-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../frontend/src/app/farm-api')>();
    return {
        ...actual,
        fetchFarmTree: vi.fn(),
        fetchFarmMission: vi.fn(),
        saveFarmMission: vi.fn(),
    };
});

vi.mock('../../frontend/src/map/missions-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../frontend/src/map/missions-api')>();
    return { ...actual, downloadAgriDocument: vi.fn() };
});

vi.mock('../../frontend/src/fields/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../frontend/src/fields/api')>();
    return { ...actual, getField: vi.fn() };
});

vi.mock('../../frontend/src/missions/MissionAssistant', () => ({
    MissionAssistant: ({ view }: { view?: string }) => (
        <div data-testid={`mission-assistant-${view ?? 'all'}`}>{view}</div>
    ),
}));

const farmTree = vi.mocked(fetchFarmTree);
const farmMission = vi.mocked(fetchFarmMission);
const farmSave = vi.mocked(saveFarmMission);
const agriDownload = vi.mocked(downloadAgriDocument);
const fieldDetail = vi.mocked(getField);

function stubAssistant(open = false) {
    return {
        open,
        start: vi.fn(),
        close: vi.fn(),
    };
}

const emptyPublications: MissionPanelProps['publications'] = {
    available: false,
    items: [],
    error: null,
    loading: false,
    reload: vi.fn(),
    publish: vi.fn(),
    setError: vi.fn(),
};

const sampleDocument = {
    version: '3',
    file_type: 'mission_order',
    vehicle_id: 'v1',
    points: [],
    metadata: {
        srbc_mission_brief: {
            name: 'Binage nord',
            field_id: 'Champ Nord',
            operation: 'hoeing',
        },
    },
};

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    fieldDetail.mockReset();
    farmSave.mockResolvedValue('mission_order/2026-08-20_champ-nord_hoeing.json');
    farmMission.mockResolvedValue({
        version: '3',
        file_type: 'mission_order',
        vehicle_id: 'v1',
        points: [],
    });
    farmTree.mockResolvedValue({
        mission_order: [
            {
                name: '2026-08-20-champ-nord-binage.json',
                path: 'mission_order/2026-08-20-champ-nord-binage.json',
                size: 512,
                modified: Date.parse('2026-08-20T08:00:00Z'),
                field_id: 'champ-nord',
                field_name: 'Champ Nord',
                display_name: 'Binage — Champ Nord',
                operation: 'hoeing',
                simulated: true,
            },
        ],
    });
});

function panelProps(overrides: Partial<MissionPanelProps> = {}): MissionPanelProps {
    return {
        t: (key, params) => translate(key, params ?? {}, 'fr'),
        onSelectMission: vi.fn(),
        onLoadFarmMission: vi.fn(),
        onImportFile: vi.fn(),
        onPublish: vi.fn(),
        publications: emptyPublications,
        vehicles: [],
        combinations: [],
        implements: [],
        activePath: null,
        onApplyDocument: vi.fn(),
        assistant: stubAssistant(),
        fields: [],
        fieldsAvailable: true,
        ...overrides,
    } as unknown as MissionPanelProps;
}

function renderPanel(props = panelProps()): ReactElement {
    const element = (
        <StudioProviders>
            <MissionPanel {...props} />
        </StudioProviders>
    );
    render(element);
    return element;
}

describe('MissionPanel (T13.10)', () => {
    it('shows no active mission and keeps Edit unavailable without a document', () => {
        renderPanel();

        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(5);
        expect(screen.getByRole('tab', { name: 'Explorer' }).dataset.state).toBe('active');
        expect(screen.queryByRole('tab', { name: 'Charger' })).toBeNull();
        expect(screen.getByRole('tab', { name: 'Méta-mission' }).hasAttribute('disabled')).toBe(
            true,
        );
        expect(screen.getByRole('tab', { name: 'Comparer' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByRole('tab', { name: 'Éditer' }).hasAttribute('disabled')).toBe(true);
        expect(
            screen.getByRole('button', { name: 'Aucune mission chargée' }).hasAttribute('disabled'),
        ).toBe(true);
        expect(screen.getByRole('heading', { name: 'Créer une nouvelle mission' })).toBeDefined();
        expect(screen.getByRole('heading', { name: 'Missions existantes' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'À partir de zéro' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'À partir d’une parcelle' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'Avec l’assistant' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'À partir d’un fichier importé' })).toBeDefined();
        expect(
            screen
                .getByRole('button', { name: 'À partir d’un fichier importé' })
                .hasAttribute('disabled'),
        ).toBe(false);
        expect(screen.queryByTestId('mission-assistant-create')).toBeNull();
    });

    it('loads the mission_order explorer through the farm API', async () => {
        renderPanel();

        await waitFor(() => expect(farmTree).toHaveBeenCalledWith('mission_order'));

        expect(await screen.findByText('Binage — Champ Nord')).toBeDefined();
        expect(screen.getByText('Parcelle : Champ Nord')).toBeDefined();
        expect(screen.getByText('Simulée')).toBeDefined();
    });

    it('loads a selected farm mission in the existing editor', async () => {
        const onLoadFarmMission = vi.fn();
        renderPanel(panelProps({ onLoadFarmMission }));
        fireEvent.click(await screen.findByText('Binage — Champ Nord'));

        const path = 'mission_order/2026-08-20-champ-nord-binage.json';
        await waitFor(() => expect(farmMission).toHaveBeenCalledWith(path));
        expect(onLoadFarmMission).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ version: '3', file_type: 'mission_order' }),
        );
    });

    it('asks for an editable name before creating a blank mission', () => {
        const onApplyDocument = vi.fn();
        const onStartNewDocument = vi.fn();
        renderPanel(panelProps({ onApplyDocument, onStartNewDocument }));
        fireEvent.click(screen.getByRole('button', { name: 'À partir de zéro' }));

        expect(screen.getByRole('dialog', { name: 'Nommer la nouvelle mission' })).toBeDefined();
        const input = screen.getByLabelText('Nom de la mission');
        expect((input as HTMLInputElement).value).toMatch(
            /^Nouvelle mission — \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
        );
        fireEvent.change(input, { target: { value: 'Mission personnalisée' } });
        fireEvent.click(screen.getByRole('button', { name: 'Créer la mission' }));

        expect(onStartNewDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                version: '3',
                file_type: 'mission_order',
                points: [],
                metadata: expect.objectContaining({
                    srbc_mission_brief: expect.objectContaining({
                        name: 'Mission personnalisée',
                    }),
                }),
            }),
        );
        expect(onApplyDocument).not.toHaveBeenCalled();
    });

    it('shows the active name, enables Edit and renames on double-click', async () => {
        const onApplyDocument = vi.fn();
        renderPanel(
            panelProps({
                document: sampleDocument as never,
                activePath: 'mission_order/binage-nord.json',
                onApplyDocument,
            }),
        );

        expect(screen.getByRole('tab', { name: 'Éditer' }).hasAttribute('disabled')).toBe(false);
        const current = screen.getByRole('button', { name: 'Binage nord' });
        fireEvent.doubleClick(current);
        const input = screen.getByLabelText('Nom de la mission en cours');
        fireEvent.change(input, { target: { value: 'Binage parcelle nord' } });
        fireEvent.blur(input);

        await waitFor(() => expect(onApplyDocument).toHaveBeenCalledTimes(1));
        expect(onApplyDocument.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    srbc_mission_brief: expect.objectContaining({
                        name: 'Binage parcelle nord',
                    }),
                }),
            }),
        );
    });

    it('assigns a farm field later without replacing the mission document', async () => {
        const onApplyDocument = vi.fn();
        renderPanel(
            panelProps({
                document: {
                    ...sampleDocument,
                    metadata: {
                        srbc_mission_brief: {
                            name: 'Mission libre',
                            operation: 'hoeing',
                            field_id: null,
                            field_name: null,
                        },
                    },
                } as never,
                onApplyDocument,
                fields: [
                    {
                        id: 'champ-nord',
                        name: 'Champ Nord',
                        campaign: '2026',
                        geometry: { type: 'Polygon', coordinates: [] },
                        crs: 'EPSG:4326',
                        provenance: {},
                        qualified_for_autonomy: true,
                        created_at: '2026-08-20T00:00:00Z',
                        updated_at: '2026-08-20T00:00:00Z',
                    },
                ],
            }),
        );
        fireEvent.focus(screen.getByRole('tab', { name: 'Éditer' }));
        fireEvent.click(screen.getByLabelText('Parcelle'));
        fireEvent.click(screen.getByRole('option', { name: 'Champ Nord' }));

        await waitFor(() => expect(onApplyDocument).toHaveBeenCalledTimes(1));
        expect(onApplyDocument.mock.calls[0]?.[0]).toEqual(
            expect.objectContaining({
                points: [],
                metadata: expect.objectContaining({
                    srbc_mission_brief: expect.objectContaining({
                        name: 'Mission libre',
                        field_id: 'champ-nord',
                        field_name: 'Champ Nord',
                        campaign: '2026',
                    }),
                }),
            }),
        );
    });

    it('opens the assistant without starting a blank document', () => {
        const assistant = stubAssistant();
        const onStartNewDocument = vi.fn();
        renderPanel(panelProps({ assistant, onStartNewDocument }));
        fireEvent.click(screen.getByRole('button', { name: 'Avec l’assistant' }));

        expect(assistant.start).toHaveBeenCalledTimes(1);
        expect(onStartNewDocument).not.toHaveBeenCalled();
    });

    it('builds a geofenced draft from a farm field', async () => {
        const onStartNewDocument = vi.fn();
        fieldDetail.mockResolvedValue({
            id: 'champ-nord',
            name: 'Champ Nord',
            campaign: '2026',
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [3.17, 45.85],
                        [3.172, 45.85],
                        [3.172, 45.851],
                        [3.17, 45.851],
                        [3.17, 45.85],
                    ],
                    [
                        [3.1705, 45.8503],
                        [3.1708, 45.8503],
                        [3.1708, 45.8505],
                        [3.1705, 45.8505],
                        [3.1705, 45.8503],
                    ],
                ],
            },
            crs: 'EPSG:4326',
            provenance: {},
            qualified_for_autonomy: true,
            created_at: '2026-08-20T00:00:00Z',
            updated_at: '2026-08-20T00:00:00Z',
            zones: [],
            obstacles: [],
            guidance_lines: [],
            row_sets: [],
            traffic_ways: [],
            traffic_nodes: [],
            landmarks: [],
            version: 1,
        });
        renderPanel(
            panelProps({
                onStartNewDocument,
                fieldsAvailable: true,
                fields: [
                    {
                        id: 'champ-nord',
                        name: 'Champ Nord',
                        campaign: '2026',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [
                                [
                                    [3.17, 45.85],
                                    [3.172, 45.85],
                                    [3.172, 45.851],
                                    [3.17, 45.851],
                                    [3.17, 45.85],
                                ],
                            ],
                        },
                        crs: 'EPSG:4326',
                        provenance: {},
                        qualified_for_autonomy: true,
                        created_at: '2026-08-20T00:00:00Z',
                        updated_at: '2026-08-20T00:00:00Z',
                    },
                ],
            }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'À partir d’une parcelle' }));
        fireEvent.click(await screen.findByRole('button', { name: /Champ Nord/ }));

        await waitFor(() => expect(fieldDetail).toHaveBeenCalledWith('champ-nord'));
        const nameInput = await screen.findByLabelText('Nom de la mission');
        expect((nameInput as HTMLInputElement).value).toMatch(
            /^Champ Nord — Mission — \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
        );
        fireEvent.change(nameInput, { target: { value: 'Mission Champ Nord' } });
        fireEvent.click(screen.getByRole('button', { name: 'Créer la mission' }));
        await waitFor(() => expect(onStartNewDocument).toHaveBeenCalled());
        const document = onStartNewDocument.mock.calls[0]?.[0] as {
            geofencing: { values: unknown[] };
            metadata: {
                srbc_geofence_exclusions: unknown[];
                srbc_mission_brief: { name: string };
            };
        };
        expect(document.geofencing.values.length).toBeGreaterThanOrEqual(4);
        expect(document.metadata.srbc_geofence_exclusions).toHaveLength(1);
        expect(document.metadata.srbc_mission_brief.name).toBe('Mission Champ Nord');
    });
});

describe('mission panel i18n', () => {
    it('provides the new visible labels in French and English', () => {
        const keys = [
            'mission.tab.explore',
            'mission.tab.edit',
            'mission.explore.heading',
            'mission.tab.meta',
            'mission.tab.compare',
            'mission.tab.publish',
            'mission.tab.comingSoon',
            'mission.active.none',
            'mission.active.unnamed',
            'mission.active.name',
            'mission.active.renameHint',
            'mission.create.heading',
            'mission.create.scratch',
            'mission.create.defaultScratchName',
            'mission.create.defaultMission',
            'mission.create.nameDialog.title',
            'mission.create.nameDialog.label',
            'mission.create.nameDialog.hint',
            'mission.create.nameDialog.confirm',
            'mission.create.fromField',
            'mission.create.assistant',
            'mission.create.fromFile',
            'mission.create.fromFile.comingSoon',
            'mission.load.empty',
            'mission.load.loadingMission',
            'mission.load.unreadable',
            'mission.load.simulated',
            'mission.load.notSimulated',
            'mission.edit.needDocument',
            'mission.edit.field',
            'mission.edit.field.hint',
            'mission.edit.equipment',
            'mission.edit.identity',
            'mission.publish.needDocument',
            'mission.publish.saveAs',
            'mission.publish.duplicate',
            'mission.publish.export',
            'mission.publish.history',
        ];
        for (const key of keys) {
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
    });
});

describe('MissionPanel (T13.11)', () => {
    it('edits mission identity through the command-stack callback', () => {
        const onApplyDocument = vi.fn();
        renderPanel(panelProps({ document: sampleDocument, onApplyDocument }));
        fireEvent.focus(screen.getByRole('tab', { name: 'Éditer' }));

        const name = screen.getByLabelText('Nom');
        fireEvent.change(name, { target: { value: 'Binage soir' } });

        expect(onApplyDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({
                    srbc_mission_brief: expect.objectContaining({
                        name: 'Binage soir',
                        operation: 'hoeing',
                    }),
                }),
            }),
        );
    });

    it('hides publish actions until a mission is open', () => {
        renderPanel();
        fireEvent.focus(screen.getByRole('tab', { name: 'Publier' }));

        expect(screen.getByText(/Aucune mission en cours/)).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
        expect(screen.getByText('Historique des publications')).toBeDefined();
    });

    it('opens the existing publish dialog and saves into mission_order', async () => {
        const onPublish = vi.fn();
        const onLoadFarmMission = vi.fn();
        renderPanel(
            panelProps({
                document: sampleDocument,
                onPublish,
                onLoadFarmMission,
            }),
        );
        fireEvent.focus(screen.getByRole('tab', { name: 'Publier' }));

        fireEvent.click(screen.getByRole('button', { name: 'Publier' }));
        expect(onPublish).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
        await waitFor(() =>
            expect(farmSave).toHaveBeenCalledWith(
                expect.stringMatching(/^mission_order\/\d{4}-\d{2}-\d{2}_binage-nord\.json$/),
                expect.objectContaining({ file_type: 'mission_order' }),
            ),
        );
        await waitFor(() => expect(onLoadFarmMission).toHaveBeenCalled());
    });

    it('duplicates without overwriting an existing farm file', async () => {
        renderPanel(
            panelProps({
                document: sampleDocument,
                activePath: 'mission_order/2026-08-20-champ-nord-binage.json',
            }),
        );
        fireEvent.focus(screen.getByRole('tab', { name: 'Publier' }));
        fireEvent.click(screen.getByRole('button', { name: 'Dupliquer' }));

        await waitFor(() =>
            expect(farmSave).toHaveBeenCalledWith(
                'mission_order/2026-08-20-champ-nord-binage-2.json',
                expect.any(Object),
            ),
        );
    });

    it('exports a naked Agri document', () => {
        renderPanel(panelProps({ document: sampleDocument }));
        fireEvent.focus(screen.getByRole('tab', { name: 'Publier' }));
        fireEvent.click(screen.getByRole('button', { name: 'Exporter le fichier mission' }));

        expect(agriDownload).toHaveBeenCalledWith(sampleDocument, expect.stringMatching(/\.json$/));
    });
});
