import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AdminPanel } from '../../frontend/src/app/AdminPanel';
import {
    EMPTY_COUNTS,
    type FarmDocument,
    type FarmLocation,
    type FarmRecent,
} from '../../frontend/src/app/farm-api';
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
    field_geofence_inset_cm: 25,
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-08-19T08:00:00Z',
};

const LOCATION: FarmLocation = { kind: 'device', label: 'grands-champs', id: 'dev-1' };
const RECENT: FarmRecent[] = [
    { kind: 'device', label: 'grands-champs', id: 'dev-1' },
    { kind: 'browser', label: 'Coteaux', id: 'web-2' },
    { kind: 'device', label: 'ancienne', id: 'dev-3', needsPermission: true },
];

function farmState(overrides: Partial<FarmState> = {}): FarmState {
    const snapshot = {
        farm: FARM,
        root: LOCATION.label,
        location: LOCATION,
        counts: EMPTY_COUNTS,
        recent: RECENT,
        cropPack: 'vineyard',
    };
    const opened = { ...snapshot };
    return {
        available: true,
        loading: false,
        error: null,
        setError: vi.fn(),
        snapshot,
        farm: snapshot.farm,
        root: snapshot.root,
        location: snapshot.location,
        counts: snapshot.counts,
        recent: snapshot.recent,
        deviceFolders: true,
        missions: [],
        work: [],
        reload: vi.fn(),
        save: vi.fn().mockResolvedValue(undefined),
        openFromDevice: vi.fn().mockResolvedValue(opened),
        createOnDevice: vi.fn().mockResolvedValue(opened),
        createInBrowser: vi.fn().mockResolvedValue(opened),
        openRecent: vi.fn().mockResolvedValue(opened),
        importArchive: vi.fn().mockResolvedValue(opened),
        exportArchive: vi.fn().mockResolvedValue(undefined),
        reindex: vi.fn().mockResolvedValue({ errors: 0 }),
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
        expect(screen.getByLabelText('Retrait de la géo-clôture')).toHaveProperty('value', '25');
        expect(document.querySelector('.studio-admin-root')?.textContent).toBe(
            'Dossier sur cet ordinateur : grands-champs',
        );
        expect(screen.getByText(/rien n’est envoyé au serveur/)).toBeDefined();
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
                snapshot: { ...state.snapshot, farm: null, root: null, location: null },
                farm: null,
                root: null,
                location: null,
            }),
        );
        expect(screen.getByText('Aucune ferme ouverte')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Ouvrir un dossier de ferme…' })).toBeDefined();
        expect(
            screen
                .getByRole('button', { name: 'Exporter la ferme (.zip)' })
                .hasAttribute('disabled'),
        ).toBe(true);
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

    it('stores zero or a custom geofence inset and rejects negative values', async () => {
        const state = farmState();
        renderAdmin(state);
        const input = screen.getByLabelText('Retrait de la géo-clôture');

        fireEvent.change(input, { target: { value: '0' } });
        fireEvent.blur(input);
        await waitFor(() =>
            expect(state.save).toHaveBeenCalledWith({ field_geofence_inset_cm: 0 }),
        );

        vi.mocked(state.save).mockClear();
        fireEvent.change(input, { target: { value: '42' } });
        fireEvent.blur(input);
        await waitFor(() =>
            expect(state.save).toHaveBeenCalledWith({ field_geofence_inset_cm: 42 }),
        );

        vi.mocked(state.save).mockClear();
        fireEvent.change(input, { target: { value: '-1' } });
        fireEvent.blur(input);
        expect(
            await screen.findByText('Le retrait doit être un nombre positif ou nul.'),
        ).toBeDefined();
        expect(state.save).not.toHaveBeenCalled();
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
    it('opens a folder of this computer and reloads the catalogues', async () => {
        const state = farmState();
        const onFarmChanged = vi.fn();
        renderAdmin(state, { onFarmChanged });
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un dossier de ferme…' }));
        await waitFor(() => expect(state.openFromDevice).toHaveBeenCalledTimes(1));
        expect(onFarmChanged).toHaveBeenCalledTimes(1);
    });

    it('changes nothing when the folder picker is cancelled', async () => {
        const state = farmState({ openFromDevice: vi.fn().mockResolvedValue(null) });
        const onFarmChanged = vi.fn();
        renderAdmin(state, { onFarmChanged });
        fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un dossier de ferme…' }));
        await waitFor(() => expect(state.openFromDevice).toHaveBeenCalledTimes(1));
        expect(onFarmChanged).not.toHaveBeenCalled();
        expect(screen.queryByText('Enregistré')).toBeNull();
    });

    it('opens a recent farm in one click and says which ones need access again', async () => {
        const state = farmState();
        renderAdmin(state);
        expect(screen.getByRole('button', { name: /ancienne · Autoriser l’accès/ })).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: /Coteaux · navigateur/ }));
        await waitFor(() => expect(state.openRecent).toHaveBeenCalledWith(RECENT[1]));
    });

    it('asks for a name before creating a farm', () => {
        const state = farmState();
        renderAdmin(state);
        const create = screen.getByRole('button', { name: 'Créer dans un dossier vide…' });
        expect(create.hasAttribute('disabled')).toBe(true);
        fireEvent.keyDown(screen.getByLabelText('Nom de la nouvelle ferme'), { key: 'Enter' });
        expect(screen.getByText('Indiquez le nom de la nouvelle ferme.')).toBeDefined();
        expect(state.createOnDevice).not.toHaveBeenCalled();
    });

    it('creates a named farm in a folder or in the browser', async () => {
        const state = farmState();
        const onFarmChanged = vi.fn();
        renderAdmin(state, { onFarmChanged });
        fireEvent.change(screen.getByLabelText('Nom de la nouvelle ferme'), {
            target: { value: 'Ferme Nouvelle' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Créer dans un dossier vide…' }));
        await waitFor(() => expect(state.createOnDevice).toHaveBeenCalledWith('Ferme Nouvelle'));
        expect(onFarmChanged).toHaveBeenCalledTimes(1);

        fireEvent.change(screen.getByLabelText('Nom de la nouvelle ferme'), {
            target: { value: 'Ferme Web' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Créer dans ce navigateur' }));
        await waitFor(() => expect(state.createInBrowser).toHaveBeenCalledWith('Ferme Web'));
    });

    it('keeps the farm in the browser when folders are not supported', () => {
        renderAdmin(farmState({ deviceFolders: false }));
        expect(screen.getByText(/Chrome ou Edge sur ordinateur/)).toBeDefined();
        expect(screen.queryByRole('button', { name: 'Ouvrir un dossier de ferme…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Créer dans un dossier vide…' })).toBeNull();
    });

    it('imports and exports the farm as a zip', async () => {
        const state = farmState();
        renderAdmin(state);
        const file = new File(['PK'], 'ferme.zip', { type: 'application/zip' });
        fireEvent.change(screen.getByTestId('admin-archive-input'), { target: { files: [file] } });
        await waitFor(() => expect(state.importArchive).toHaveBeenCalledWith(file));
        fireEvent.click(screen.getByRole('button', { name: 'Exporter la ferme (.zip)' }));
        await waitFor(() => expect(state.exportArchive).toHaveBeenCalledTimes(1));
    });

    it('re-reads the files on demand', async () => {
        const state = farmState();
        renderAdmin(state);
        fireEvent.click(screen.getByRole('button', { name: 'Relire les fichiers' }));
        await waitFor(() => expect(state.reindex).toHaveBeenCalledTimes(1));
    });

    it('warns when this browser cannot keep a farm', () => {
        renderAdmin(farmState({ available: false }));
        expect(screen.getByRole('status').textContent).toContain('navigation privée');
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
            'admin.folder.openDevice',
            'admin.folder.where.device',
            'admin.folder.where.browser',
            'admin.folder.where.memory',
            'admin.create.onDevice',
            'admin.create.inBrowser',
            'admin.archive.import',
            'admin.archive.export',
            'admin.folder.recent',
            'admin.index.rebuild',
            'admin.preferences',
            'admin.startView.useCurrent',
            'admin.fieldGeofenceInset',
            'admin.fieldGeofenceInset.hint',
            'admin.fieldGeofenceInset.invalid',
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
