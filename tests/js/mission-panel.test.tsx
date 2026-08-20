import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchFarmMission, fetchFarmTree, saveFarmMission } from '../../frontend/src/app/farm-api';
import { StudioProviders } from '../../frontend/src/design-system';
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

vi.mock('../../frontend/src/missions/MissionAssistant', () => ({
    MissionAssistant: ({ view }: { view?: string }) => (
        <div data-testid={`mission-assistant-${view ?? 'all'}`}>{view}</div>
    ),
}));

const farmTree = vi.mocked(fetchFarmTree);
const farmMission = vi.mocked(fetchFarmMission);
const farmSave = vi.mocked(saveFarmMission);
const agriDownload = vi.mocked(downloadAgriDocument);

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
        onPublish: vi.fn(),
        publications: emptyPublications,
        vehicles: [],
        combinations: [],
        implements: [],
        activePath: null,
        onApplyDocument: vi.fn(),
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
    it('renders six tabs, opens Create by default and disables only future features', () => {
        renderPanel();

        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(6);
        expect(screen.getByRole('tab', { name: 'Créer' }).dataset.state).toBe('active');
        expect(screen.getByRole('tab', { name: 'Méta-mission' }).hasAttribute('disabled')).toBe(
            true,
        );
        expect(screen.getByRole('tab', { name: 'Comparer' }).hasAttribute('disabled')).toBe(true);
        expect(screen.getByTestId('mission-assistant-create')).toBeDefined();
    });

    it('loads the mission_order explorer through the farm API', async () => {
        renderPanel();

        await waitFor(() => expect(farmTree).toHaveBeenCalledWith('mission_order'));
        fireEvent.focus(screen.getByRole('tab', { name: 'Charger' }));

        expect(await screen.findByText('2026-08-20-champ-nord-binage')).toBeDefined();
        expect(screen.getByText('Parcelle : champ-nord')).toBeDefined();
        expect(screen.getByText('Simulée')).toBeDefined();
    });

    it('loads a selected farm mission in the existing editor', async () => {
        const onLoadFarmMission = vi.fn();
        renderPanel(panelProps({ onLoadFarmMission }));
        fireEvent.focus(screen.getByRole('tab', { name: 'Charger' }));
        fireEvent.click(await screen.findByText('2026-08-20-champ-nord-binage'));

        const path = 'mission_order/2026-08-20-champ-nord-binage.json';
        await waitFor(() => expect(farmMission).toHaveBeenCalledWith(path));
        expect(onLoadFarmMission).toHaveBeenCalledWith(
            path,
            expect.objectContaining({ version: '3', file_type: 'mission_order' }),
        );
    });

    it('creates an empty Agri document and switches to Edit from scratch', () => {
        const onApplyDocument = vi.fn();
        renderPanel(panelProps({ onApplyDocument }));
        fireEvent.click(screen.getByRole('button', { name: 'Partir de zéro' }));

        expect(onApplyDocument).toHaveBeenCalledWith(
            expect.objectContaining({ version: '3', file_type: 'mission_order', points: [] }),
        );
        expect(screen.getByRole('tab', { name: 'Éditer' }).dataset.state).toBe('active');
        expect(screen.getByTestId('mission-assistant-edit')).toBeDefined();
    });
});

describe('mission panel i18n', () => {
    it('provides the new visible labels in French and English', () => {
        const keys = [
            'mission.tab.create',
            'mission.tab.edit',
            'mission.tab.load',
            'mission.tab.meta',
            'mission.tab.compare',
            'mission.tab.publish',
            'mission.tab.comingSoon',
            'mission.create.scratch',
            'mission.load.empty',
            'mission.load.loadingMission',
            'mission.load.unreadable',
            'mission.load.simulated',
            'mission.load.notSimulated',
            'mission.edit.needDocument',
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
                expect.stringMatching(/^mission_order\/\d{4}-\d{2}-\d{2}_champ-nord_hoeing\.json$/),
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
        fireEvent.click(screen.getByRole('button', { name: 'Exporter Agri' }));

        expect(agriDownload).toHaveBeenCalledWith(sampleDocument, expect.stringMatching(/\.json$/));
    });
});
