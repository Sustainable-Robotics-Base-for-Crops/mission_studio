import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AdminPanel } from '../../frontend/src/app/AdminPanel';
import { EMPTY_COUNTS, type FarmDocument } from '../../frontend/src/app/farm-api';
import type { FarmState } from '../../frontend/src/app/useFarm';
import { StudioProviders } from '../../frontend/src/design-system';
import { translate } from '../../frontend/src/i18n/adapter';
import { DEFAULT_CENTER, DEFAULT_ZOOM, initialView } from '../../frontend/src/map/styles';

afterEach(() => {
    cleanup();
});

const FARM: FarmDocument = {
    schema: 'srbc.farm/1',
    name: 'Ferme des Grands Champs',
    farm_type: 'vineyard',
    start_view: { lat: 45.12345, lon: 3.54321, zoom: 16 },
    language: 'fr',
    theme: 'light',
    ui_mode: 'advanced',
    units: 'metric',
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-08-19T08:00:00Z',
};

function farmState(overrides: Partial<FarmState> = {}): FarmState {
    const snapshot = {
        farm: FARM,
        root: '/farms/grands-champs',
        counts: EMPTY_COUNTS,
        recent: ['/farms/grands-champs', '/farms/coteaux'],
        cropPack: 'vineyard',
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
        save: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        openExisting: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(undefined),
        reindex: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as FarmState;
}

function renderAdmin(state: FarmState, props: Partial<Parameters<typeof AdminPanel>[0]> = {}) {
    render(
        <StudioProviders>
            <AdminPanel
                t={(key, params) => translate(key, params ?? {}, 'fr')}
                farm={state}
                {...props}
            />
        </StudioProviders>,
    );
}

describe('administration sections (CdC L13 §8)', () => {
    it('shows the farm, the working folder and the preferences', () => {
        renderAdmin(farmState());
        expect(screen.getByText('Ferme')).toBeDefined();
        expect(screen.getByText('Dossier de travail')).toBeDefined();
        expect(screen.getByText('Préférences')).toBeDefined();
        expect(screen.getByLabelText('Nom de la ferme')).toBeDefined();
        expect(screen.getByLabelText('Niveau d’outils')).toBeDefined();
        expect(document.querySelector('.studio-admin-root')?.textContent).toBe(
            '/farms/grands-champs',
        );
        expect(screen.getByText(/Vue de démarrage : 45.12345, 3.54321 — zoom 16/)).toBeDefined();
    });

    it('explains that the farm type drives the default crop pack', () => {
        renderAdmin(farmState());
        expect(screen.getByText(/pack cultural/)).toBeDefined();
    });

    it('keeps the working folder usable when no farm is open, and hides the rest', () => {
        const state = farmState();
        renderAdmin(
            farmState({
                snapshot: { ...state.snapshot, farm: null, root: null },
                farm: null,
                root: null,
            }),
        );
        expect(screen.getByText('Aucun dossier de ferme ouvert')).toBeDefined();
        expect(screen.getByLabelText('Dossier sélectionné')).toBeDefined();
        expect(screen.getByText(/Créez ou ouvrez d’abord une ferme/)).toBeDefined();
        expect(screen.queryByLabelText('Nom de la ferme')).toBeNull();
        expect(screen.queryByText('Préférences')).toBeNull();
    });
});

describe('administration saves through the farm API', () => {
    it('saves a renamed farm on blur, and stays quiet when nothing changed', async () => {
        const state = farmState();
        renderAdmin(state);
        const input = screen.getByLabelText('Nom de la ferme');
        fireEvent.blur(input);
        expect(state.save).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: 'Ferme du Coteau' } });
        fireEvent.blur(input);
        await waitFor(() => expect(state.save).toHaveBeenCalledWith({ name: 'Ferme du Coteau' }));
        expect(screen.getByText('Enregistré')).toBeDefined();
    });

    it('reports a refused save instead of pretending it worked', async () => {
        const state = farmState({
            save: vi.fn().mockRejectedValue(new Error('name must not be empty')),
        });
        renderAdmin(state);
        const input = screen.getByLabelText('Nom de la ferme');
        fireEvent.change(input, { target: { value: 'x' } });
        fireEvent.blur(input);
        await waitFor(() => expect(screen.getByText('name must not be empty')).toBeDefined());
        expect(screen.getByText('Échec de l’enregistrement')).toBeDefined();
    });

    it('stores the current map camera as the start view', async () => {
        const state = farmState();
        renderAdmin(state, {
            readMapView: () => ({ lat: 44.4444449, lon: 1.1111119, zoom: 17.256 }),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Utiliser la vue actuelle' }));
        await waitFor(() =>
            expect(state.save).toHaveBeenCalledWith({
                start_view: { lat: 44.444445, lon: 1.111112, zoom: 17.26 },
            }),
        );
    });

    it('switches visibly between basic and advanced tool levels', async () => {
        const state = farmState();
        renderAdmin(state);
        fireEvent.click(screen.getByLabelText('Niveau d’outils'));
        fireEvent.click(screen.getByRole('option', { name: 'Basique' }));
        await waitFor(() => expect(state.save).toHaveBeenCalledWith({ ui_mode: 'basic' }));
    });

    it('says so when no map is mounted rather than saving a wrong view', async () => {
        const state = farmState();
        renderAdmin(state, { readMapView: () => null });
        fireEvent.click(screen.getByRole('button', { name: 'Utiliser la vue actuelle' }));
        await waitFor(() => expect(screen.getByText(/Carte indisponible/)).toBeDefined());
        expect(state.save).not.toHaveBeenCalled();
    });
});

describe('administration switches farm without a page reload', () => {
    it('opens a typed root and reloads the catalogues', async () => {
        const state = farmState();
        const onFarmChanged = vi.fn();
        renderAdmin(state, { onFarmChanged });
        fireEvent.change(screen.getByLabelText('Dossier sélectionné'), {
            target: { value: '  /farms/nouvelle  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la ferme' }));
        await waitFor(() => expect(state.openExisting).toHaveBeenCalledWith('/farms/nouvelle'));
        expect(onFarmChanged).toHaveBeenCalledTimes(1);
    });

    it('opens a recent farm in one click', async () => {
        const state = farmState();
        renderAdmin(state);
        fireEvent.click(screen.getByRole('button', { name: '/farms/coteaux' }));
        await waitFor(() => expect(state.openExisting).toHaveBeenCalledWith('/farms/coteaux'));
    });

    it('refuses an empty path and keeps the button out of reach', () => {
        const state = farmState();
        renderAdmin(state);
        const open = screen.getByRole('button', { name: 'Ouvrir la ferme' });
        expect(open.hasAttribute('disabled')).toBe(true);
        fireEvent.keyDown(screen.getByLabelText('Dossier sélectionné'), { key: 'Enter' });
        expect(screen.getByText('Indiquez le chemin du dossier de la ferme.')).toBeDefined();
        expect(state.openExisting).not.toHaveBeenCalled();
    });

    it('creates a named farm in the selected empty folder', async () => {
        const state = farmState();
        const onFarmChanged = vi.fn();
        renderAdmin(state, { onFarmChanged });
        fireEvent.change(screen.getByLabelText('Dossier sélectionné'), {
            target: { value: '/farms/nouvelle' },
        });
        fireEvent.change(screen.getByLabelText('Nom de la nouvelle ferme'), {
            target: { value: 'Ferme Nouvelle' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Créer la ferme ici' }));
        await waitFor(() =>
            expect(state.create).toHaveBeenCalledWith('/farms/nouvelle', 'Ferme Nouvelle'),
        );
        expect(onFarmChanged).toHaveBeenCalledTimes(1);
    });

    it('rebuilds the index on demand', async () => {
        const state = farmState();
        renderAdmin(state);
        fireEvent.click(screen.getByRole('button', { name: 'Reconstruire l’index' }));
        await waitFor(() => expect(state.reindex).toHaveBeenCalledTimes(1));
    });

    it('warns when the versioned backend is absent', () => {
        renderAdmin(farmState({ available: false }));
        expect(screen.getByRole('status').textContent).toContain('BACKEND_FASTAPI');
    });
});

describe('map start view (CdC L13 §8)', () => {
    it('comes from the farm when it exists', () => {
        expect(initialView({ lat: 45.1, lon: 3.2, zoom: 16 })).toEqual({
            center: [3.2, 45.1],
            zoom: 16,
        });
    });

    it('falls back to the constants without a farm', () => {
        expect(initialView(null)).toEqual({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
        expect(initialView(undefined)).toEqual({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM });
    });

    it('falls back rather than sending the map out of the world', () => {
        const fallback = { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
        expect(initialView({ lat: 120, lon: 3, zoom: 12 })).toEqual(fallback);
        expect(initialView({ lat: 45, lon: 200, zoom: 12 })).toEqual(fallback);
        expect(initialView({ lat: 45, lon: 3, zoom: 99 })).toEqual(fallback);
        expect(initialView({ lat: Number.NaN, lon: 3, zoom: 12 })).toEqual(fallback);
    });
});

describe('admin i18n keys', () => {
    it('exist in French and English', () => {
        const keys = [
            'admin.farm',
            'admin.farmName',
            'admin.farmType.hint',
            'admin.folder.openAction',
            'admin.folder.pickAction',
            'admin.create.action',
            'admin.folder.recent',
            'admin.index.rebuild',
            'admin.preferences',
            'admin.startView.useCurrent',
            'admin.theme.hint',
            'admin.uiMode.hint',
            'admin.uiMode.needFarm',
        ];
        for (const key of keys) {
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
        expect(translate('admin.startView.value', { lat: 1, lon: 2, zoom: 3 }, 'en')).toBe(
            'Start view: 1, 2 — zoom 3',
        );
    });
});
