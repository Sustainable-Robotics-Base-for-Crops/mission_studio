import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchFarmAvailable, fetchFarmMissionsForField } from '../../frontend/src/app/farm-api';
import { StudioProviders } from '../../frontend/src/design-system';
import {
    FieldMissionsTab,
    partitionFieldMissions,
} from '../../frontend/src/fields/FieldMissionsTab';
import { translate } from '../../frontend/src/i18n/adapter';

vi.mock('../../frontend/src/app/farm-api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../frontend/src/app/farm-api')>();
    return {
        ...actual,
        fetchFarmAvailable: vi.fn(),
        fetchFarmMissionsForField: vi.fn(),
    };
});

const farmAvailable = vi.mocked(fetchFarmAvailable);
const farmMissions = vi.mocked(fetchFarmMissionsForField);

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    farmAvailable.mockReset();
    farmMissions.mockReset();
    farmAvailable.mockResolvedValue(true);
    farmMissions.mockResolvedValue([
        {
            name: '2026-08-20_champ-nord_semis.json',
            path: 'mission_order/2026-08-20_champ-nord_semis.json',
            size: 12,
            modified: Date.parse('2026-08-20T08:00:00Z'),
            kind: 'mission_order',
            field_id: 'field-1',
            simulated: true,
        },
        {
            name: '2026-07-01_champ-nord_semis.json',
            path: 'work_performed/2026-07-01_champ-nord_semis.json',
            size: 12,
            modified: Date.parse('2026-07-01T08:00:00Z'),
            kind: 'work_performed',
            field_id: 'field-1',
            simulated: false,
        },
    ]);
});

function renderTab(
    fieldId: string | null = 'field-1',
    onOpenMission = vi.fn(),
): { onOpenMission: ReturnType<typeof vi.fn> } {
    const element: ReactElement = (
        <StudioProviders>
            <FieldMissionsTab
                t={(key, params) => translate(key, params ?? {}, 'fr')}
                language="fr"
                fieldId={fieldId}
                onOpenMission={onOpenMission}
            />
        </StudioProviders>
    );
    render(element);
    return { onOpenMission };
}

describe('partitionFieldMissions', () => {
    it('keeps generated missions and performed work apart by kind', () => {
        const split = partitionFieldMissions([
            {
                name: 'a.json',
                path: 'mission_order/a.json',
                size: 1,
                modified: 1,
                kind: 'mission_order',
            },
            {
                name: 'b.json',
                path: 'work_performed/b.json',
                size: 1,
                modified: 1,
                kind: 'work_performed',
            },
        ]);
        expect(split.generated.map((item) => item.name)).toEqual(['a.json']);
        expect(split.work.map((item) => item.name)).toEqual(['b.json']);
    });
});

describe('FieldMissionsTab (T13.13)', () => {
    it('lists generated missions and performed work, then opens one on click', async () => {
        const { onOpenMission } = renderTab();

        await waitFor(() => expect(farmMissions).toHaveBeenCalledWith('field-1'));
        expect(await screen.findByText('2026-08-20_champ-nord_semis')).toBeDefined();
        expect(screen.getByText('Simulée')).toBeDefined();
        expect(screen.getByText('2026-07-01_champ-nord_semis')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: /2026-08-20_champ-nord_semis/ }));
        expect(onOpenMission).toHaveBeenCalledWith(
            'mission_order/2026-08-20_champ-nord_semis.json',
        );
    });

    it('explains how to proceed when the field has no mission', async () => {
        farmMissions.mockResolvedValueOnce([]);
        renderTab();

        expect(await screen.findByText(/Aucune mission générée/)).toBeDefined();
        expect(screen.getByText(/Aucun travail réalisé/)).toBeDefined();
    });

    it('explains how to proceed when no field is selected', () => {
        renderTab(null);
        expect(screen.getByText(/Sélectionnez une parcelle/)).toBeDefined();
        expect(farmMissions).not.toHaveBeenCalled();
    });

    it('explains how to proceed when no farm is open', async () => {
        farmMissions.mockRejectedValueOnce(
            new Error('no farm is open; open one from Administration first'),
        );
        renderTab();
        expect(await screen.findByText(/Aucune ferme n’est ouverte/)).toBeDefined();
    });

    it('explains how to proceed when the backend is missing', async () => {
        farmAvailable.mockResolvedValueOnce(false);
        renderTab();
        expect(await screen.findByText(/n’est pas joignable/)).toBeDefined();
        expect(farmMissions).not.toHaveBeenCalled();
    });

    it('provides the new labels in French and English', () => {
        const keys = [
            'fields.tab.missions',
            'fields.missions.needField',
            'fields.missions.noFarm',
            'fields.missions.unavailable',
            'fields.missions.generatedEmpty',
            'fields.missions.workEmpty',
        ];
        for (const key of keys) {
            expect(translate(key, {}, 'fr')).not.toBe(key);
            expect(translate(key, {}, 'en')).not.toBe(key);
        }
    });
});
