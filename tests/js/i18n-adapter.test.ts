import { describe, expect, it } from 'vitest';

import { resolveLanguage, translate } from '../../frontend/src/i18n/adapter';

describe('i18n adapter', () => {
    it('falls back to French for unknown languages', () => {
        expect(resolveLanguage(undefined)).toBe('fr');
        expect(resolveLanguage('pt')).toBe('fr');
        expect(resolveLanguage('en')).toBe('en');
    });

    it('translates shell keys in French and English', () => {
        expect(translate('nav.equipment', {}, 'fr')).toBe('Matériel');
        expect(translate('equipment.nav.combinations', {}, 'fr')).toBe('Combinaisons');
        expect(translate('equipment.field.workingWidth', {}, 'en')).toBe('Working width');
        expect(translate('equipment.kind.trailed', {}, 'fr')).toBe('Traîné');
        expect(translate('equipment.field.drawbar', {}, 'en')).toBe('Drawbar length');
        expect(translate('equipment.help.physicalWidth', {}, 'fr')).toContain('gabarit');
        expect(translate('ds.fieldHelp', { label: 'Largeur physique' }, 'fr')).toContain(
            'Largeur physique',
        );
        expect(translate('nav.fields', {}, 'en')).toBe('Fields');
        expect(translate('map.layers', {}, 'fr')).toBe('Couches');
        expect(translate('map.layer.guidance', {}, 'fr')).toBe('Guidage');
        expect(translate('map.layer.traffic', {}, 'fr')).toBe('Circulation');
        expect(translate('map.layer.labels', {}, 'fr')).toBe('Libellés');
        expect(translate('map.layer.labels', {}, 'en')).toBe('Labels');
        expect(translate('fields.editGeometry', {}, 'fr')).toBe('Modifier le tracé');
        expect(translate('module.coming', { lot: 'L5' }, 'fr')).toContain('L5');
        expect(translate('tool.drawLine', {}, 'fr')).toBe('Tracer une ligne');
        expect(translate('tool.drawLine', {}, 'en')).toBe('Draw a line');
        expect(translate('tool.drawPolygon', {}, 'fr')).toContain('polygone');
        expect(translate('tool.drawPolygon', {}, 'en')).toContain('polygon');
        expect(translate('tool.drawPolygonHint', {}, 'fr')).toContain('segment');
        expect(translate('tool.drawLineHint', {}, 'fr')).toContain('Glissez');
        expect(translate('tool.workingZone', {}, 'fr')).toContain('travail');
        expect(translate('tool.fillParcel', {}, 'fr')).toContain('parcelle');
        expect(translate('tool.coverageStrategy.best_nswath', {}, 'fr')).toContain('passes');
        expect(translate('assist.new', {}, 'fr')).toBe('Nouvelle mission');
        expect(translate('assist.step.generate', {}, 'en')).toBe('Generation');
        expect(translate('tree.title', {}, 'fr')).toBe('Arbre de mission');
        expect(
            translate('metrics.strip', { length: 12, duration: '1:14', rows: 2, turns: 1 }, 'fr'),
        ).toContain('12 m');
        expect(translate('tool.fillConnectTurns', {}, 'en')).toContain('pivot');
        expect(translate('tool.connectTurns', {}, 'fr')).toContain('demi-tours');
        expect(translate('tool.ruler', {}, 'fr')).toBe('Règle');
        expect(translate('tool.editSpeed', {}, 'fr')).toContain('vitesse');
        expect(translate('tool.selectZone', {}, 'fr')).toContain('sections');
        expect(translate('tool.selectZoneHint', {}, 'fr')).toContain('Glissez');
        expect(translate('tool.offset', {}, 'fr')).toBe('Décaler');
        expect(translate('tool.offset', {}, 'en')).toBe('Offset');
        expect(translate('map.resetNorth', {}, 'fr')).toContain('Nord');
        expect(translate('map.resetNorth', {}, 'en')).toContain('North');
        expect(translate('inspector.edit.extend', {}, 'fr')).toContain('Rallonger');
        expect(translate('inspector.edit.move', {}, 'en')).toBe('Move');
        expect(translate('fields.tab.impact', {}, 'fr')).toBe('Impact');
        expect(translate('fields.seeMissions', {}, 'fr')).toBe('Voir les missions');
        expect(translate('fields.generateRows', {}, 'fr')).toBe('Générer les rangs');
        expect(translate('fields.generateBeds18', {}, 'fr')).toBe('18 planches type');
        expect(translate('fields.typeRow', { number: 3 }, 'fr')).toBe('Rang 3');
        expect(translate('fields.unavailable', {}, 'en')).toContain('BACKEND_FASTAPI');
        expect(translate('tool.selectPolygon', {}, 'en')).toContain('area');
        expect(translate('tool.deleteZone', {}, 'en')).toContain('Cut');
        expect(translate('tool.saving', {}, 'fr')).toBe('Enregistrement…');
        expect(translate('pack.vineyard', {}, 'fr')).toBe('Vigne');
        expect(translate('teach.open', {}, 'en')).toBe('Teach-and-repeat');
        expect(translate('fields.kind.gnss_degraded', {}, 'fr')).toContain('GNSS');
    });

    it('never returns a blank string for a missing key', () => {
        expect(translate('does.not.exist', {}, 'fr')).toBe('does.not.exist');
    });
});
