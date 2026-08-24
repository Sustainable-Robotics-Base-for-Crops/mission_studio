import type { EditTool } from '../map/useMissionEditor';
import type { FieldsTool } from './useFieldCatalogue';
import type { FieldsNavId, TrafficDrawKind } from './types';

export type FieldsDrawTarget =
    'field' | 'zone' | 'obstacle' | 'guidance' | 'traffic_way' | 'traffic_node';

export type FieldsDrawKind = 'polygon' | 'line' | 'point';

/** What a draft becomes when the user confirms, given the parcellaire tab. */
export function fieldsDrawTarget(
    nav: FieldsNavId,
    trafficKind: TrafficDrawKind = 'path',
): FieldsDrawTarget | null {
    if (nav === 'obstacles') {
        return 'obstacle';
    }
    if (nav === 'zones') {
        return 'zone';
    }
    if (nav === 'guidance') {
        return 'guidance';
    }
    if (nav === 'traffic') {
        return trafficKind === 'path' ? 'traffic_way' : 'traffic_node';
    }
    if (nav === 'parcels' || nav === 'io') {
        return 'field';
    }
    return null;
}

export function fieldsDrawKind(
    nav: FieldsNavId,
    trafficKind: TrafficDrawKind = 'path',
): FieldsDrawKind | null {
    const target = fieldsDrawTarget(nav, trafficKind);
    if (target === null) {
        return null;
    }
    if (target === 'guidance' || target === 'traffic_way') {
        return 'line';
    }
    if (target === 'traffic_node') {
        return 'point';
    }
    return 'polygon';
}

/** MapCanvas only knows line/polygon; a traffic point still needs the draw click path. */
export function fieldsCanvasTool(tool: FieldsTool): EditTool {
    if (tool === 'ruler') {
        return 'ruler';
    }
    if (tool === 'draw_point' || tool === 'draw_line') {
        return 'draw_line';
    }
    if (tool === 'draw_polygon' || tool === 'select_polygon') {
        return 'draw_polygon';
    }
    return 'none';
}
