import { Eye, EyeOff, Layers } from 'lucide-react';
import type { ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { Popover } from '../design-system/Overlay';
import {
    CATALOGUE_KIND_PAINT,
    CATALOGUE_OVERLAY_SWATCH,
    CATALOGUE_ZONE_KINDS,
    type CatalogueOverlayId,
} from './catalogue-style';
import { LAYER_CATALOG, type BasemapId, type OverlayId } from './styles';

interface LayersPopoverProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    basemap: BasemapId;
    onBasemap: (id: BasemapId) => void;
    overlays: Partial<Record<OverlayId, boolean>>;
    onOverlay: (id: OverlayId, visible: boolean) => void;
}

const BASEMAP_IDS: BasemapId[] = ['plan', 'satellite', 'terrain'];

export function LayersPopover({
    t,
    basemap,
    onBasemap,
    overlays,
    onOverlay,
}: LayersPopoverProps): ReactElement {
    return (
        <div className="studio-layers-anchor">
            <Popover
                label={t('map.layers')}
                trigger={
                    <span className="studio-layers-trigger">
                        <Button variant="secondary" icon={Layers}>
                            {t('map.layers')}
                        </Button>
                    </span>
                }
            >
                <div className="studio-layers">
                    <h3>{t('map.basemap')}</h3>
                    <div
                        className="studio-layers-basemap"
                        role="radiogroup"
                        aria-label={t('map.basemap')}
                    >
                        {BASEMAP_IDS.map((id) => (
                            <label key={id}>
                                <input
                                    type="radio"
                                    name="studio-basemap"
                                    checked={basemap === id}
                                    onChange={() => onBasemap(id)}
                                />
                                {t(`map.basemap.${id}`)}
                            </label>
                        ))}
                    </div>
                    <h3>{t('map.overlays')}</h3>
                    <ul>
                        {LAYER_CATALOG.map((layer) => {
                            const enabled = layer.lot === null || layer.lot === 'L10';
                            const visible = overlays[layer.id] !== false;
                            return (
                                <li key={layer.id}>
                                    <button
                                        type="button"
                                        className="studio-layers-row"
                                        disabled={!enabled}
                                        onClick={() => enabled && onOverlay(layer.id, !visible)}
                                        aria-pressed={enabled ? visible : undefined}
                                    >
                                        {visible && enabled ? (
                                            <Eye
                                                size={ICON_SIZE.table}
                                                strokeWidth={STROKE}
                                                aria-hidden
                                            />
                                        ) : (
                                            <EyeOff
                                                size={ICON_SIZE.table}
                                                strokeWidth={STROKE}
                                                aria-hidden
                                            />
                                        )}
                                        {layer.id in CATALOGUE_OVERLAY_SWATCH ? (
                                            <span
                                                className="studio-layers-swatch"
                                                style={{
                                                    background:
                                                        CATALOGUE_OVERLAY_SWATCH[
                                                            layer.id as CatalogueOverlayId
                                                        ],
                                                }}
                                                aria-hidden="true"
                                            />
                                        ) : null}
                                        <span>{t(`map.layer.${layer.id}`)}</span>
                                        {layer.lot ? (
                                            <span className="studio-layers-lot">{layer.lot}</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <h3>{t('fields.nav.zones')}</h3>
                    <ul className="studio-layers-legend">
                        {CATALOGUE_ZONE_KINDS.map((kind) => (
                            <li key={kind}>
                                <span
                                    className="studio-layers-swatch"
                                    style={{ background: CATALOGUE_KIND_PAINT[kind].line }}
                                    aria-hidden="true"
                                />
                                {t(`fields.kind.${kind}`)}
                            </li>
                        ))}
                    </ul>
                </div>
            </Popover>
        </div>
    );
}
