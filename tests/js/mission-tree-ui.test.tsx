import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { StudioProviders } from '../../frontend/src/design-system';
import { Accordion } from '../../frontend/src/design-system/Disclosure';
import { translate } from '../../frontend/src/i18n/adapter';
import { MissionTree } from '../../frontend/src/missions/MissionTree';
import type { MissionTreeModel } from '../../frontend/src/missions/tree';

afterEach(() => {
    cleanup();
});

const t = (key: string, params?: Record<string, string | number>) =>
    translate(key, params ?? {}, 'fr');

const tree: MissionTreeModel = {
    groups: [
        {
            kind: 'group',
            id: 'work-1',
            bucket: 'work',
            length_m: 20,
            children: [
                {
                    kind: 'leaf',
                    id: 'leaf-0',
                    index: 0,
                    role: 'work',
                    ordinal: 1,
                    length_m: 10,
                    speed_mps: 0.5,
                    points: 2,
                },
                {
                    kind: 'leaf',
                    id: 'leaf-1',
                    index: 1,
                    role: 'work',
                    ordinal: 2,
                    length_m: 10,
                    speed_mps: 0.5,
                    points: 2,
                },
            ],
        },
    ],
    leaves: [],
    metrics: {
        length_m: 20,
        duration_s: 40,
        rows: 2,
        turns: 0,
        headlands: 0,
        sections: 2,
    },
};

function renderTree(): ReactElement {
    const element = (
        <StudioProviders>
            <MissionTree
                t={t}
                tree={{ ...tree, leaves: tree.groups[0]!.children }}
                selectedIndices={[]}
                hiddenIndices={[]}
                lockedIndices={[]}
                onSelect={vi.fn()}
                onMove={vi.fn()}
                onReorderTo={vi.fn()}
                onToggleHidden={vi.fn()}
                onToggleLocked={vi.fn()}
                onReverse={vi.fn()}
            />
        </StudioProviders>
    );
    render(element);
    return element;
}

describe('mission tree collapse', () => {
    it('collapses a pass group so the list no longer occupies the panel', () => {
        renderTree();
        expect(screen.getByText('Passe 1')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'Replier Passes (2)' }));

        expect(screen.queryByText('Passe 1')).toBeNull();
        expect(screen.getByRole('button', { name: 'Déplier Passes (2)' })).toBeDefined();
    });

    it('collapses the whole tree accordion used above the ODD editor', () => {
        render(
            <StudioProviders>
                <Accordion
                    defaultValue="tree"
                    items={[
                        {
                            value: 'tree',
                            title: t('tree.title'),
                            content: <p>contenu-arbre</p>,
                        },
                    ]}
                />
            </StudioProviders>,
        );

        expect(screen.getByText('contenu-arbre')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'Arbre de mission' }));
        expect(screen.queryByText('contenu-arbre')).toBeNull();
    });

    it('provides collapse labels in French and English', () => {
        expect(translate('tree.collapse', { name: 'Passes (400)' }, 'fr')).toBe(
            'Replier Passes (400)',
        );
        expect(translate('tree.expand', { name: 'Passes (400)' }, 'en')).toBe(
            'Expand Passes (400)',
        );
    });
});
