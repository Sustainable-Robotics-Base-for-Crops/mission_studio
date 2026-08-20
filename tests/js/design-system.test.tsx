import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

import {
    House,
    Lasso,
    MousePointer2,
    MoveHorizontal,
    Pentagon,
    Scissors,
    Spline,
    Sprout,
} from 'lucide-react';

import {
    COLOR,
    CONTROL,
    DESIGN_SYSTEM_PATH,
    ICON_BY_FUNCTION,
    ICON_SIZE,
    Input,
    LUCIDE_PINNED_VERSION,
    Machine,
    StudioProviders,
    Tabs,
} from '../../frontend/src/design-system';
import { DesignSystemPage } from '../../frontend/src/design-system/DesignSystemPage';
import { translate } from '../../frontend/src/i18n/adapter';

afterEach(() => {
    cleanup();
});

describe('design tokens (CdCF §4)', () => {
    it('pins the exact palette', () => {
        expect(COLOR.bgApp).toBe('#F4F7F3');
        expect(COLOR.primary700).toBe('#166534');
        expect(COLOR.focus).toBe('#2563EB');
        expect(COLOR.selected).toBe('#7C3AED');
        expect(COLOR.valid).toBe('#15803D');
        expect(COLOR.warning).toBe('#B45309');
        expect(COLOR.danger).toBe('#B91C1C');
        expect(COLOR.autonomy).toBe('#0E7490');
    });

    it('pins interaction timings and icon sizes', () => {
        expect(CONTROL.tooltipDelayMs).toBe(400);
        expect(CONTROL.toastMs).toBe(5000);
        expect(CONTROL.focusWidth).toBe(2);
        expect(CONTROL.focusOffset).toBe(2);
        expect(ICON_SIZE).toEqual({ menu: 20, button: 18, table: 16 });
    });

    it('places icon-button tooltips to the right so vertical rails stay clickable', () => {
        const source = readFileSync('frontend/src/design-system/Button.tsx', 'utf8');
        expect(source).toContain("tooltipSide = 'right'");
    });

    it('pins lucide-react to the exact CdCF version, not a range', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
            dependencies: Record<string, string>;
        };
        expect(LUCIDE_PINNED_VERSION).toBe('0.544.0');
        expect(pkg.dependencies['lucide-react']).toBe(LUCIDE_PINNED_VERSION);
    });
});

describe('Lucide mapping (CdCF §4.7)', () => {
    it('exposes the required metaphors', () => {
        expect(Object.keys(ICON_BY_FUNCTION)).toEqual(
            expect.arrayContaining([
                'Accueil',
                'Parcellaire',
                'Matériel',
                'Missions',
                'Simulation',
                'Publication',
                'Rapports',
                'Intégrations',
                'Administration',
                'Couches',
                'Recherche',
                'Annuler',
                'Rétablir',
                'Avertissement',
                'Bloqueur',
                'Conforme',
                'Tracer ligne',
                'Tracer polygone',
            ]),
        );
        expect(ICON_BY_FUNCTION.Accueil).toBe(House);
        expect(ICON_BY_FUNCTION.Matériel).toBe(Machine);
        expect(ICON_BY_FUNCTION['Tracer ligne']).toBe(Spline);
        expect(ICON_BY_FUNCTION['Tracer polygone']).toBe(Pentagon);
        expect(ICON_BY_FUNCTION.Découper).toBe(Scissors);
        expect(ICON_BY_FUNCTION.Offset).toBe(MoveHorizontal);
        expect(ICON_BY_FUNCTION['Zone de travail']).toBe(Sprout);
        expect(ICON_BY_FUNCTION.Sélectionner).toBe(MousePointer2);
        expect(ICON_BY_FUNCTION['Sélection par zone']).toBe(Lasso);
    });
});

describe('design-system page', () => {
    it('is routed outside the nine modules', () => {
        expect(DESIGN_SYSTEM_PATH).toBe('/design-system');
        expect(translate('ds.title', {}, 'fr')).toBe('Système de design');
        expect(translate('ds.title', {}, 'en')).toBe('Design system');
    });

    it('has no critical or serious axe-core violations', async () => {
        const { container } = render(
            <StudioProviders>
                <DesignSystemPage />
            </StudioProviders>,
        );
        expect(container.querySelector('[data-ds-lot="L2"]')).not.toBeNull();
        const results = await axe(container, {
            rules: {
                // jsdom cannot compute contrast; palette contrast is pinned by token tests.
                'color-contrast': { enabled: false },
            },
        });
        const blocking = results.violations.filter(
            (violation) => violation.impact === 'critical' || violation.impact === 'serious',
        );
        expect(blocking).toEqual([]);
    });

    it('renders a disabled tab visibly but refuses to open it', () => {
        render(
            <StudioProviders>
                <Tabs
                    defaultValue="create"
                    items={[
                        { value: 'create', label: 'Créer', content: <p>Assistant</p> },
                        {
                            value: 'meta',
                            label: 'Méta-mission',
                            content: <p>Jamais affiché</p>,
                            disabled: true,
                            tooltip: 'Développement à venir',
                        },
                    ]}
                />
            </StudioProviders>,
        );

        const planned = screen.getByRole('tab', { name: 'Méta-mission' });
        expect(planned.hasAttribute('disabled')).toBe(true);

        fireEvent.click(planned);

        expect(screen.getByText('Assistant')).toBeTruthy();
        expect(screen.queryByText('Jamais affiché')).toBeNull();
    });

    it('falls back on the first openable tab when the default one is disabled', () => {
        render(
            <StudioProviders>
                <Tabs
                    defaultValue="compare"
                    items={[
                        { value: 'load', label: 'Charger', content: <p>Explorateur</p> },
                        {
                            value: 'compare',
                            label: 'Comparer',
                            content: <p>Comparaison</p>,
                            disabled: true,
                        },
                    ]}
                />
            </StudioProviders>,
        );

        expect(screen.getByText('Explorateur')).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Charger' }).dataset.state).toBe('active');
    });

    it('styles tabs inside a left context panel, not only inside the inspector', () => {
        const css = readFileSync('frontend/src/styles/shell.css', 'utf8');
        expect(css).toContain('.studio-context .ds-tabs');
        expect(css).toContain('.studio-context .ds-tab');
        expect(css).toContain('.studio-context .ds-tab:focus-visible');
        const primitives = readFileSync('frontend/src/design-system/primitives.css', 'utf8');
        expect(primitives).toContain('.ds-tab:disabled');
    });

    it('opens a field help dialog from the i-button', () => {
        render(
            <StudioProviders>
                <Input
                    id="eq-physical"
                    label="Largeur physique"
                    help="Largeur hors-tout de l’outil : le gabarit de collision."
                />
            </StudioProviders>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'À propos — Largeur physique' }));
        expect(
            screen.getByText('Largeur hors-tout de l’outil : le gabarit de collision.'),
        ).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy();
    });
});
