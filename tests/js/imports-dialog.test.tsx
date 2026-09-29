import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/imports/api', () => ({
    previewImport: vi.fn(),
    listImportAdapters: vi.fn(),
}));

import { StudioProviders } from '../../frontend/src/design-system';
import { translate } from '../../frontend/src/i18n/adapter';
import { previewImport, listImportAdapters } from '../../frontend/src/imports/api';
import { ImportDialog } from '../../frontend/src/imports/ImportDialog';
import {
    ImportBackendAbsent,
    ImportRefused,
    type ImportPreview,
} from '../../frontend/src/imports/types';
import { useFileImport, type FileImport } from '../../frontend/src/imports/useFileImport';

// jsdom still ships no Blob.text(); every browser has had it since 2019.
if (!File.prototype.text) {
    File.prototype.text = function readAsText(this: File): Promise<string> {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsText(this);
        });
    };
}

const t = (key: string, params?: Record<string, string | number>) =>
    translate(key, params ?? {}, 'fr');

const previewImportMock = vi.mocked(previewImport);
const listImportAdaptersMock = vi.mocked(listImportAdapters);

const NAIO_PREVIEW: ImportPreview = {
    source: { filename: '101-106-traces.geojson', bytes: 7997 },
    adapters: [
        {
            id: 'naio_workmap',
            label: 'Naïo WorkMap',
            vendor: 'naio',
            extensions: ['.geojson', '.json'],
            kinds: ['row'],
        },
        {
            id: 'geojson_generic',
            label: 'GeoJSON',
            vendor: 'generic',
            extensions: ['.geojson'],
            kinds: ['landmark'],
        },
    ],
    candidates: [
        {
            adapter: 'naio_workmap',
            confidence: 0.95,
            reason: 'imports.reason.naioWorkMap',
            params: { version: 4 },
        },
        {
            adapter: 'geojson_generic',
            confidence: 0.35,
            reason: 'imports.reason.geojson',
            params: { count: 6 },
        },
    ],
    adapter: 'naio_workmap',
    report: {
        adapter: 'naio_workmap',
        label: 'Naïo WorkMap',
        vendor: 'naio',
        feature_count: 6,
        kinds: { row: 6 },
        geometry_types: { LineString: 6 },
        metrics: [
            { key: 'imports.metric.rows', value: 6, unit: null },
            { key: 'imports.metric.rowSpacing', value: 2.05, unit: 'm' },
        ],
        notices: [
            { key: 'imports.notice.noBoundary', params: {} },
            { key: 'imports.notice.ownerDropped', params: {} },
        ],
        members: [],
        promotions: [{ kind: 'row', target: 'catalogue.row', count: 6, collective: false }],
    },
    collection: {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: { srbc_import: { kind: 'row' } },
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [6.75, 43.61],
                        [6.751, 43.61],
                    ],
                },
            },
        ],
    },
};

function dialogState(overrides: Partial<FileImport> = {}): FileImport {
    return {
        open: true,
        file: new File(['{}'], '101-106-traces.geojson'),
        busy: false,
        preview: NAIO_PREVIEW,
        error: null,
        adapters: NAIO_PREVIEW.adapters,
        candidates: NAIO_PREVIEW.candidates,
        adapter: NAIO_PREVIEW.adapter,
        formats: [],
        format: '',
        intent: 'overlay',
        start: vi.fn(),
        chooseFormat: vi.fn(),
        chooseAdapter: vi.fn(),
        confirm: vi.fn(),
        confirmConvert: vi.fn(),
        close: vi.fn(),
        ...overrides,
    };
}

function renderDialog(state: FileImport) {
    return render(
        <StudioProviders>
            <ImportDialog t={t} state={state} />
        </StudioProviders>,
    );
}

describe('import dialog', () => {
    beforeEach(() => {
        previewImportMock.mockReset();
        listImportAdaptersMock.mockReset();
    });

    afterEach(cleanup);

    it('shows what the adapter recognised before anything is added', () => {
        renderDialog(dialogState());
        expect(screen.getByText('101-106-traces.geojson · 1 ko')).toBeDefined();
        expect(screen.getByText('Inter-rang')).toBeDefined();
        expect(screen.getByText('2.05 m')).toBeDefined();
        expect(screen.getByText('6 × Rang')).toBeDefined();
    });

    it('draws the figures with a legend, so the formalism can be judged on sight', () => {
        renderDialog(dialogState());
        expect(screen.getByRole('img', { name: /Aperçu du tracé/ })).toBeDefined();
        const legend = screen.getByText('Aperçu').parentElement;
        expect(legend?.querySelectorAll('path').length).toBeGreaterThan(0);
        expect(legend?.textContent).toContain('Rang');
    });

    it('turns the whole drawing grey when the dialect recognised nothing', () => {
        const asLandmarks = {
            ...NAIO_PREVIEW,
            adapter: 'geojson_generic',
            collection: {
                type: 'FeatureCollection' as const,
                features: NAIO_PREVIEW.collection.features.map((item) => ({
                    ...item,
                    properties: { srbc_import: { kind: 'landmark' } },
                })),
            },
        };
        renderDialog(dialogState({ preview: asLandmarks }));
        const preview = screen
            .getByRole('img', { name: /Aperçu du tracé/ })
            .closest('.studio-import-preview');
        expect(preview?.textContent).toContain('Repère');
        expect(preview?.textContent).not.toContain('Rang');
    });

    it('states plainly that the file carries no field limit', () => {
        renderDialog(dialogState());
        expect(screen.getByText(/Aucune limite de parcelle dans ce fichier/)).toBeDefined();
        expect(screen.getByText(/donnée personnelle/)).toBeDefined();
    });

    it('offers an overlay or a conversion, and keeps overlay as the default action', () => {
        renderDialog(dialogState());
        expect(screen.getByText('Que faire de ces objets')).toBeDefined();
        expect(screen.getByRole('button', { name: 'Ajouter comme calque' })).toBeDefined();
        expect(screen.queryByRole('button', { name: /Créer/ })).toBeNull();
    });

    it('keeps the confirm button out of reach while there is nothing to add', () => {
        renderDialog(dialogState({ preview: null, busy: true }));
        const confirm = screen.getByRole('button', { name: 'Ajouter comme calque' });
        expect(confirm.hasAttribute('disabled')).toBe(true);
        expect(screen.getByText('Analyse du fichier…')).toBeDefined();
    });

    it('translates a refusal instead of showing its key', () => {
        renderDialog(
            dialogState({
                preview: null,
                error: { key: 'imports.error.tooLarge', params: { limit_mb: 8 } },
            }),
        );
        expect(screen.getByRole('alert').textContent).toContain('limite 8 Mo');
    });

    it('keeps the formalism picker when the chosen dialect refuses the file', () => {
        renderDialog(
            dialogState({
                preview: null,
                error: { key: 'imports.error.notGeoJSON', params: {} },
                adapter: 'geojson_generic',
            }),
        );
        expect(screen.getByRole('alert').textContent).toMatch(/n.est pas un GeoJSON/);
        expect(screen.getByLabelText('Formalisme')).toBeDefined();
        expect(
            screen.getByRole('button', { name: 'Ajouter comme calque' }).hasAttribute('disabled'),
        ).toBe(true);
    });
});

describe('file import flow', () => {
    beforeEach(() => {
        previewImportMock.mockReset();
        listImportAdaptersMock.mockReset();
        listImportAdaptersMock.mockResolvedValue({
            adapters: NAIO_PREVIEW.adapters,
            formats: [],
        });
    });

    it('analyses the picked file and keeps the overlay untouched until confirmation', async () => {
        previewImportMock.mockResolvedValue(NAIO_PREVIEW);
        const onAdd = vi.fn();
        const { result } = renderHook(() => useFileImport({ onAdd }));
        const file = new File(['{}'], '101-106-traces.geojson');

        act(() => result.current.start(file));
        await waitFor(() => expect(result.current.preview).not.toBeNull());

        expect(result.current.open).toBe(true);
        expect(previewImportMock).toHaveBeenCalledWith(file, undefined, undefined);
        expect(onAdd).not.toHaveBeenCalled();

        act(() => result.current.confirm());
        expect(onAdd).toHaveBeenCalledWith(NAIO_PREVIEW.collection, '101-106-traces.geojson');
        expect(result.current.open).toBe(false);
    });

    it('re-reads the same file when the operator picks another formalism', async () => {
        previewImportMock.mockResolvedValue(NAIO_PREVIEW);
        const { result } = renderHook(() => useFileImport({ onAdd: vi.fn() }));
        const file = new File(['{}'], '101-106-traces.geojson');

        act(() => result.current.start(file));
        await waitFor(() => expect(result.current.preview).not.toBeNull());

        previewImportMock.mockResolvedValue({ ...NAIO_PREVIEW, adapter: 'geojson_generic' });
        act(() => result.current.chooseAdapter('geojson_generic'));
        await waitFor(() => expect(result.current.preview?.adapter).toBe('geojson_generic'));

        expect(previewImportMock).toHaveBeenLastCalledWith(file, 'geojson_generic', undefined);
    });

    it('falls back to local GeoJSON when the backend does not serve imports', async () => {
        previewImportMock.mockRejectedValue(new ImportBackendAbsent());
        const { result } = renderHook(() => useFileImport({ onAdd: vi.fn() }));
        const survey = JSON.stringify({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { srbc_kind: 'landmark', name: 'P1' },
                    geometry: { type: 'Point', coordinates: [3.17, 45.85] },
                },
            ],
        });

        act(() => result.current.start(new File([survey], 'sabi-expe.geojson')));
        await waitFor(() => expect(result.current.preview).not.toBeNull());

        expect(result.current.preview?.adapter).toBe('geojson_local');
        expect(result.current.preview?.report.notices[0].key).toBe('imports.notice.localOnly');
        expect(result.current.error).toBeNull();
    });

    it('surfaces a refusal and leaves the dialog open on the same file', async () => {
        previewImportMock.mockRejectedValue(new ImportRefused('imports.error.notRaven'));
        const { result } = renderHook(() => useFileImport({ onAdd: vi.fn() }));

        act(() => result.current.start(new File(['x'], 'job.zip')));
        await waitFor(() => expect(result.current.error).not.toBeNull());

        expect(result.current.error?.key).toBe('imports.error.notRaven');
        expect(result.current.preview).toBeNull();
        expect(result.current.open).toBe(true);
        expect(result.current.adapters.length).toBeGreaterThan(0);
    });

    it('keeps the picker after a refused override so another dialect can be tried', async () => {
        previewImportMock.mockResolvedValue(NAIO_PREVIEW);
        const { result } = renderHook(() => useFileImport({ onAdd: vi.fn() }));
        const file = new File(['{}'], '101-106-traces.geojson');

        act(() => result.current.start(file));
        await waitFor(() => expect(result.current.preview).not.toBeNull());

        previewImportMock.mockRejectedValue(new ImportRefused('imports.error.notGeoJSON'));
        act(() => result.current.chooseAdapter('geojson_generic'));
        await waitFor(() => expect(result.current.error).not.toBeNull());

        expect(result.current.error?.key).toBe('imports.error.notGeoJSON');
        expect(result.current.preview).toBeNull();
        expect(result.current.adapter).toBe('geojson_generic');
        expect(result.current.adapters.map((entry) => entry.id)).toContain('naio_workmap');
        expect(result.current.open).toBe(true);

        previewImportMock.mockResolvedValue(NAIO_PREVIEW);
        act(() => result.current.chooseAdapter('naio_workmap'));
        await waitFor(() => expect(result.current.preview).not.toBeNull());

        expect(result.current.error).toBeNull();
        expect(result.current.adapter).toBe('naio_workmap');
    });

    it('drops an answer that arrives after the dialog was closed', async () => {
        let release: ((value: ImportPreview) => void) | null = null;
        previewImportMock.mockReturnValue(
            new Promise<ImportPreview>((resolve) => {
                release = resolve;
            }),
        );
        const { result } = renderHook(() => useFileImport({ onAdd: vi.fn() }));

        act(() => result.current.start(new File(['{}'], 'slow.geojson')));
        act(() => result.current.close());
        await act(async () => {
            release?.(NAIO_PREVIEW);
        });

        expect(result.current.preview).toBeNull();
        expect(result.current.open).toBe(false);
    });
});
