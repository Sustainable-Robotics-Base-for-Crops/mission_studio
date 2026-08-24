import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    EMPTY_FIELDS_HISTORY,
    FIELDS_HISTORY_DEPTH,
    recordFieldsAction,
    takeFieldsRedo,
    takeFieldsUndo,
    type FieldsAction,
} from '../../frontend/src/fields/history';
import { useFieldCatalogue } from '../../frontend/src/fields/useFieldCatalogue';

vi.mock('../../frontend/src/fields/api', () => ({
    fetchFieldsHealth: vi.fn(),
    listFields: vi.fn(),
    getField: vi.fn(),
    listVersions: vi.fn(),
    getImpact: vi.fn(),
    diffVersions: vi.fn(),
    exportField: vi.fn(),
    importGeoJSON: vi.fn(),
    linkMission: vi.fn(),
    createField: vi.fn(),
    patchField: vi.fn(),
    deleteField: vi.fn(),
    addZone: vi.fn(),
    patchZone: vi.fn(),
    deleteZone: vi.fn(),
    addObstacle: vi.fn(),
    patchObstacle: vi.fn(),
    deleteObstacle: vi.fn(),
    addGuidanceLine: vi.fn(),
    patchGuidanceLine: vi.fn(),
    deleteGuidanceLine: vi.fn(),
    addTrafficWay: vi.fn(),
    patchTrafficWay: vi.fn(),
    deleteTrafficWay: vi.fn(),
    addTrafficNode: vi.fn(),
    patchTrafficNode: vi.fn(),
    deleteTrafficNode: vi.fn(),
    createRowSet: vi.fn(),
    deleteRowSet: vi.fn(),
    addRow: vi.fn(),
    patchRow: vi.fn(),
    deleteRow: vi.fn(),
}));

const api = await import('../../frontend/src/fields/api');

const FIELD = {
    id: 'field-1',
    name: 'Champ Nord',
    campaign: null,
    geometry: {
        type: 'Polygon' as const,
        coordinates: [
            [
                [3.17, 45.85],
                [3.172, 45.85],
                [3.172, 45.852],
                [3.17, 45.852],
                [3.17, 45.85],
            ],
        ],
    },
    crs: 'EPSG:4326',
    provenance: {},
    qualified_for_autonomy: false,
    created_at: '2026-08-23T08:00:00Z',
    updated_at: '2026-08-23T08:00:00Z',
};

const DETAIL = {
    ...FIELD,
    version: 1,
    zones: [],
    obstacles: [],
    guidance_lines: [],
    row_sets: [],
    traffic_ways: [],
    traffic_nodes: [],
    landmarks: [],
};

function stubCatalogue(): void {
    vi.mocked(api.fetchFieldsHealth).mockResolvedValue({ sqlite: true, jobs: false });
    vi.mocked(api.listFields).mockResolvedValue([FIELD]);
    vi.mocked(api.getField).mockResolvedValue(DETAIL);
    vi.mocked(api.listVersions).mockResolvedValue([]);
    vi.mocked(api.getImpact).mockResolvedValue({
        field_id: FIELD.id,
        missions: [],
        invalidated_count: 0,
        banner: null,
    });
}

/** Draw a two point line and validate it, as the map would. */
async function drawLine(
    catalogue: { current: ReturnType<typeof useFieldCatalogue> },
    kind: 'guidance' | 'perennial',
): Promise<void> {
    act(() => {
        catalogue.current.select('field-1');
    });
    await waitFor(() => expect(catalogue.current.selected).not.toBeNull());
    act(() => {
        catalogue.current.setLineKind(kind);
    });
    act(() => {
        catalogue.current.startPolyline();
    });
    act(() => {
        catalogue.current.handleMapClick([3.1705, 45.8505]);
    });
    act(() => {
        catalogue.current.handleMapClick([3.1715, 45.8515]);
    });
    await act(async () => {
        await catalogue.current.finishDraft();
    });
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('fields history stack', () => {
    it('records an action, then hands it back to undo and to redo', () => {
        const action: FieldsAction = {
            labelKey: 'fields.history.line',
            undo: vi.fn(),
            redo: vi.fn(),
        };
        const recorded = recordFieldsAction(EMPTY_FIELDS_HISTORY, action);
        expect(recorded.past).toHaveLength(1);

        const undone = takeFieldsUndo(recorded);
        expect(undone.action).toBe(action);
        expect(undone.history.past).toHaveLength(0);
        expect(undone.history.future).toHaveLength(1);

        const redone = takeFieldsRedo(undone.history);
        expect(redone.action).toBe(action);
        expect(redone.history.past).toHaveLength(1);
        expect(redone.history.future).toHaveLength(0);
    });

    it('drops a stale redo branch and stays bounded', () => {
        const action = (key: string): FieldsAction => ({
            labelKey: key,
            undo: vi.fn(),
            redo: vi.fn(),
        });
        let history = EMPTY_FIELDS_HISTORY;
        for (let index = 0; index < FIELDS_HISTORY_DEPTH + 5; index += 1) {
            history = recordFieldsAction(history, action(`a${index}`));
        }
        expect(history.past).toHaveLength(FIELDS_HISTORY_DEPTH);

        history = takeFieldsUndo(history).history;
        expect(history.future).toHaveLength(1);
        history = recordFieldsAction(history, action('new'));
        expect(history.future).toHaveLength(0);
    });

    it('takes nothing from an empty stack', () => {
        expect(takeFieldsUndo(EMPTY_FIELDS_HISTORY).action).toBeNull();
        expect(takeFieldsRedo(EMPTY_FIELDS_HISTORY).action).toBeNull();
    });
});

describe('useFieldCatalogue — undo after the line was validated', () => {
    it('deletes the line the last validation created', async () => {
        stubCatalogue();
        vi.mocked(api.addGuidanceLine).mockResolvedValue({
            id: 'line-1',
            field_id: 'field-1',
            name: 'Nouvelle ligne de guidage',
            geometry: { type: 'LineString', coordinates: [] },
            provenance: {},
            created_at: '2026-08-23T08:00:00Z',
        });
        const { result } = renderHook(() => useFieldCatalogue());
        await waitFor(() => expect(result.current.available).toBe(true));

        await drawLine(result, 'guidance');
        expect(api.addGuidanceLine).toHaveBeenCalledTimes(1);
        expect(result.current.canUndo).toBe(true);
        expect(result.current.undoLabelKey).toBe('fields.history.line');

        await act(async () => {
            result.current.undo();
        });
        await waitFor(() =>
            expect(api.deleteGuidanceLine).toHaveBeenCalledWith('field-1', 'line-1'),
        );
    });

    it('removes the duplicated rows and gives the drawn line back', async () => {
        stubCatalogue();
        vi.mocked(api.addGuidanceLine).mockResolvedValue({
            id: 'line-1',
            field_id: 'field-1',
            name: 'Nouveau rang',
            geometry: { type: 'LineString', coordinates: [] },
            provenance: {},
            created_at: '2026-08-23T08:00:00Z',
        });
        vi.mocked(api.createRowSet).mockResolvedValue({
            id: 'set-1',
            field_id: 'field-1',
            name: 'Vigne',
            kind: 'rows',
            spacing_m: 2.5,
            width_m: null,
            preferred_direction: null,
            axis_line_id: null,
            geometry: null,
            provenance: {},
            created_at: '2026-08-23T08:00:00Z',
            rows: [],
        });
        const { result } = renderHook(() => useFieldCatalogue());
        await waitFor(() => expect(result.current.available).toBe(true));

        await drawLine(result, 'perennial');
        expect(result.current.followUp).toBe('duplicate_row');

        await act(async () => {
            await result.current.applyFollowUp({ count: 3, spacingM: 2.5, side: 'right' });
        });
        expect(api.createRowSet).toHaveBeenCalledTimes(1);
        expect(api.deleteGuidanceLine).toHaveBeenCalledWith('field-1', 'line-1');
        expect(result.current.undoLabelKey).toBe('fields.history.rows');

        await act(async () => {
            result.current.undo();
        });
        await waitFor(() => expect(api.deleteRowSet).toHaveBeenCalledWith('field-1', 'set-1'));
        expect(api.addGuidanceLine).toHaveBeenCalledTimes(2);
    });
});

describe('deleting from the geometry tree', () => {
    const LINE = {
        id: 'line-1',
        field_id: 'field-1',
        name: 'Ligne AB',
        geometry: { type: 'LineString' as const, coordinates: [] },
        provenance: {},
        created_at: '2026-08-23T08:00:00Z',
    };

    it('puts the deleted line back on undo, and takes it away again on redo', async () => {
        stubCatalogue();
        vi.mocked(api.getField).mockResolvedValue({ ...DETAIL, guidance_lines: [LINE] });
        vi.mocked(api.addGuidanceLine).mockResolvedValue({ ...LINE, id: 'line-2' });
        const { result } = renderHook(() => useFieldCatalogue());
        await waitFor(() => expect(result.current.available).toBe(true));
        act(() => {
            result.current.select('field-1');
        });
        await waitFor(() => expect(result.current.selected).not.toBeNull());

        await act(async () => {
            await result.current.deleteEntity({
                kind: 'guidance',
                fieldId: 'field-1',
                id: 'line-1',
            });
        });
        expect(api.deleteGuidanceLine).toHaveBeenCalledWith('field-1', 'line-1');
        expect(result.current.undoLabelKey).toBe('fields.history.delete');

        await act(async () => {
            result.current.undo();
        });
        await waitFor(() =>
            expect(api.addGuidanceLine).toHaveBeenCalledWith('field-1', {
                geometry: LINE.geometry,
                name: 'Ligne AB',
            }),
        );

        await act(async () => {
            result.current.redo();
        });
        // The restored line came back with a new id: the redo must target that one.
        await waitFor(() =>
            expect(api.deleteGuidanceLine).toHaveBeenCalledWith('field-1', 'line-2'),
        );
    });

    it('refuses to delete a locked object', async () => {
        stubCatalogue();
        vi.mocked(api.getField).mockResolvedValue({ ...DETAIL, guidance_lines: [LINE] });
        const { result } = renderHook(() => useFieldCatalogue());
        await waitFor(() => expect(result.current.available).toBe(true));
        act(() => {
            result.current.toggleLocked('line-1');
        });

        await act(async () => {
            await result.current.deleteEntity({
                kind: 'guidance',
                fieldId: 'field-1',
                id: 'line-1',
            });
        });
        expect(api.deleteGuidanceLine).not.toHaveBeenCalled();
        expect(result.current.error).toBe('fields.error.locked');
    });
});

describe('eye and padlock of the geometry tree', () => {
    it('holds the hidden and locked objects, and toggles them back', async () => {
        stubCatalogue();
        const { result } = renderHook(() => useFieldCatalogue());
        await waitFor(() => expect(result.current.available).toBe(true));

        expect(result.current.hiddenIds).toEqual([]);
        act(() => {
            result.current.toggleHidden('line-1');
            result.current.toggleLocked('line-1');
        });
        expect(result.current.hiddenIds).toEqual(['line-1']);
        expect(result.current.lockedIds).toEqual(['line-1']);

        act(() => {
            result.current.toggleHidden('line-1');
        });
        expect(result.current.hiddenIds).toEqual([]);
        expect(result.current.lockedIds).toEqual(['line-1']);
    });

    it('refuses to edit the geometry of a locked object', async () => {
        stubCatalogue();
        const { result } = renderHook(() => useFieldCatalogue());
        await waitFor(() => expect(result.current.available).toBe(true));
        act(() => {
            result.current.select('field-1');
        });
        await waitFor(() => expect(result.current.selected).not.toBeNull());

        act(() => {
            result.current.toggleLocked('field-1');
        });
        let started = true;
        act(() => {
            started = result.current.beginEditGeometry({ kind: 'field', id: 'field-1' });
        });
        expect(started).toBe(false);
        expect(result.current.editingGeometry).toBe(false);
        expect(result.current.error).toBe('fields.error.locked');

        act(() => {
            result.current.toggleLocked('field-1');
        });
        act(() => {
            started = result.current.beginEditGeometry({ kind: 'field', id: 'field-1' });
        });
        expect(started).toBe(true);
        expect(result.current.editingGeometry).toBe(true);
    });
});
