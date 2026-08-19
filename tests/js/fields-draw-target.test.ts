import { describe, expect, it } from 'vitest';

import {
    fieldsCanvasTool,
    fieldsDrawKind,
    fieldsDrawTarget,
} from '../../frontend/src/fields/draw-target';

describe('fieldsDrawTarget', () => {
    it('creates a field from the parcels and import tabs', () => {
        expect(fieldsDrawTarget('parcels')).toBe('field');
        expect(fieldsDrawTarget('io')).toBe('field');
    });

    it('attaches a zone, obstacle or guidance line to the selected field', () => {
        expect(fieldsDrawTarget('zones')).toBe('zone');
        expect(fieldsDrawTarget('obstacles')).toBe('obstacle');
        expect(fieldsDrawTarget('guidance')).toBe('guidance');
        expect(fieldsDrawKind('guidance')).toBe('line');
        expect(fieldsDrawKind('parcels')).toBe('polygon');
    });

    it('does not draw on lots without a geometry tool', () => {
        expect(fieldsDrawTarget('rows')).toBeNull();
        expect(fieldsDrawTarget('history')).toBeNull();
    });

    it('draws a path or a named traffic point on the circulation tab', () => {
        expect(fieldsDrawTarget('traffic')).toBe('traffic_way');
        expect(fieldsDrawKind('traffic')).toBe('line');
        expect(fieldsDrawTarget('traffic', 'gate')).toBe('traffic_node');
        expect(fieldsDrawKind('traffic', 'gate')).toBe('point');
        expect(fieldsDrawKind('traffic', 'service')).toBe('point');
        expect(fieldsCanvasTool('draw_point')).toBe('draw_line');
        expect(fieldsCanvasTool('draw_line')).toBe('draw_line');
        expect(fieldsCanvasTool('select')).toBe('none');
    });
});
