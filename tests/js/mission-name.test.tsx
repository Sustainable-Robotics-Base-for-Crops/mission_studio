import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { StudioProviders } from '../../frontend/src/design-system';
import { translate } from '../../frontend/src/i18n/adapter';
import {
    MissionAssistant,
    type MissionAssistantProps,
} from '../../frontend/src/missions/MissionAssistant';
import { defaultMissionBrief, type MissionBrief } from '../../frontend/src/missions/brief';
import type { FieldSummary } from '../../frontend/src/fields/types';

const FIELD: FieldSummary = {
    id: 'field-1',
    name: 'SABI expérience',
    campaign: '2026',
    geometry: { type: 'Polygon', coordinates: [] },
    crs: 'EPSG:4326',
    provenance: {},
    qualified_for_autonomy: true,
    created_at: '2026-08-20T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
};

function renderAssistant(brief: MissionBrief, patch = vi.fn()): ReactElement {
    const assistant = {
        open: true,
        step: 'objective',
        stepIndex: 0,
        brief,
        patch,
        gates: [],
        error: null,
        summary: null,
        busy: false,
        canGenerate: false,
        start: vi.fn(),
        close: vi.fn(),
        setStep: vi.fn(),
        goNext: vi.fn(),
        goBack: vi.fn(),
        generate: vi.fn(),
    };
    const props = {
        t: (key: string, params?: Record<string, string | number>) =>
            translate(key, params ?? {}, 'fr'),
        view: 'create',
        assistant,
        fields: [FIELD],
        selectedField: null,
        fieldsAvailable: true,
        combinations: [],
        implements: [],
        missions: [],
        activePath: null,
        onSelectMission: vi.fn(),
    } as unknown as MissionAssistantProps;
    const element = (
        <StudioProviders>
            <MissionAssistant {...props} />
        </StudioProviders>
    );
    render(element);
    return element;
}

afterEach(() => {
    cleanup();
});

describe('mission name field (assistant objective step)', () => {
    it('prefills a readable name from the job and the field', () => {
        renderAssistant({ ...defaultMissionBrief(), field_id: FIELD.id, field_name: FIELD.name });

        const input = screen.getByLabelText('Nom de la mission') as HTMLInputElement;
        expect(input.value).toBe('Binage — SABI expérience');
    });

    it('lets the operator type their own name', () => {
        const patch = vi.fn();
        renderAssistant(
            { ...defaultMissionBrief(), field_id: FIELD.id, field_name: FIELD.name },
            patch,
        );

        fireEvent.change(screen.getByLabelText('Nom de la mission'), {
            target: { value: 'Binage du soir' },
        });

        expect(patch).toHaveBeenCalledWith({ name: 'Binage du soir' });
    });

    it('shows the stored name once the operator overrode the suggestion', () => {
        renderAssistant({
            ...defaultMissionBrief(),
            name: 'Binage du soir',
            field_id: FIELD.id,
            field_name: FIELD.name,
        });

        expect((screen.getByLabelText('Nom de la mission') as HTMLInputElement).value).toBe(
            'Binage du soir',
        );
    });
});
