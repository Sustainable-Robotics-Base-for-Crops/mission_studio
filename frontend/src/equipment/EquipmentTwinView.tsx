import type { ReactElement } from 'react';

import { COLOR } from '../design-system/tokens';
import { collisionLengthM, collisionWidthM, type CombinationEnvelope } from '../domain/equipment';
import type { useEquipmentCatalogue } from './useEquipmentCatalogue';

function svgBox(
    box: { minX: number; minY: number; maxX: number; maxY: number },
    scale: number,
    originY: number,
): { x: number; y: number; width: number; height: number } {
    const width = (box.maxX - box.minX) * scale;
    const height = (box.maxY - box.minY) * scale;
    return {
        x: box.minX * scale,
        y: originY - box.maxY * scale,
        width,
        height,
    };
}

function TwinPlan({
    envelope,
    label,
}: {
    envelope: CombinationEnvelope;
    label: (key: string, params?: Record<string, string | number>) => string;
}): ReactElement {
    const pad = envelope.sweptRadiusM + 0.25;
    const scale = 220;
    const width = 2 * pad * scale;
    const height = 2 * pad * scale;
    const originX = pad * scale;
    const originY = pad * scale;
    const vehicle = svgBox(envelope.vehicle, scale, 0);
    const implement = envelope.implement ? svgBox(envelope.implement, scale, 0) : null;
    const collision = svgBox(envelope.collision, scale, 0);
    const toX = (x: number) => originX + x * scale;
    const toY = (y: number) => originY - y * scale;

    return (
        <svg
            className="studio-twin-svg"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={label('equipment.view.top')}
        >
            <g transform={`translate(${originX} ${originY})`}>
                <circle
                    className="studio-twin-swept"
                    r={envelope.sweptRadiusM * scale}
                    fill="none"
                />
                <rect
                    className="studio-twin-collision"
                    x={collision.x}
                    y={-collision.y - collision.height}
                    width={collision.width}
                    height={collision.height}
                    fill="none"
                />
                <rect
                    className="studio-twin-vehicle"
                    x={vehicle.x}
                    y={-vehicle.y - vehicle.height}
                    width={vehicle.width}
                    height={vehicle.height}
                />
                {implement ? (
                    <rect
                        className="studio-twin-implement"
                        x={implement.x}
                        y={-implement.y - implement.height}
                        width={implement.width}
                        height={implement.height}
                    />
                ) : null}
            </g>
            <line
                x1={toX(-pad)}
                y1={toY(0)}
                x2={toX(pad)}
                y2={toY(0)}
                className="studio-twin-axis"
            />
            <line
                x1={toX(0)}
                y1={toY(-pad)}
                x2={toX(0)}
                y2={toY(pad)}
                className="studio-twin-axis"
            />
            <circle
                cx={toX(envelope.navRef.x)}
                cy={toY(envelope.navRef.y)}
                r={5}
                fill={COLOR.focus}
            />
            {envelope.hitchMode === 'trailed' && envelope.hitch && envelope.axle ? (
                <>
                    <line
                        x1={toX(envelope.hitch.x)}
                        y1={toY(envelope.hitch.y)}
                        x2={toX(envelope.axle.x)}
                        y2={toY(envelope.axle.y)}
                        className="studio-twin-drawbar"
                    />
                    {envelope.trailerSwingRadiusM !== null ? (
                        <circle
                            className="studio-twin-swing"
                            cx={toX(envelope.hitch.x)}
                            cy={toY(envelope.hitch.y)}
                            r={envelope.trailerSwingRadiusM * scale}
                            fill="none"
                        />
                    ) : null}
                    <circle
                        cx={toX(envelope.axle.x)}
                        cy={toY(envelope.axle.y)}
                        r={5}
                        fill={COLOR.autonomy}
                    />
                </>
            ) : null}
            {envelope.hitch ? (
                <circle
                    cx={toX(envelope.hitch.x)}
                    cy={toY(envelope.hitch.y)}
                    r={5}
                    fill={COLOR.warning}
                />
            ) : null}
            {envelope.workPoint ? (
                <circle
                    cx={toX(envelope.workPoint.x)}
                    cy={toY(envelope.workPoint.y)}
                    r={5}
                    fill={COLOR.danger}
                />
            ) : null}
        </svg>
    );
}

export function EquipmentTwinView({
    t,
    catalogue,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    catalogue: ReturnType<typeof useEquipmentCatalogue>;
}): ReactElement {
    const envelope = catalogue.envelope;
    if (!envelope || !catalogue.preview.vehicle) {
        return (
            <div className="studio-twin" role="img" aria-label={t('equipment.view.empty')}>
                <p className="studio-muted">{t('equipment.view.empty')}</p>
            </div>
        );
    }
    const length = collisionLengthM(envelope).toFixed(2);
    const width = collisionWidthM(envelope).toFixed(2);
    const radius = envelope.sweptRadiusM.toFixed(2);
    const turn = envelope.minTurnRadiusM.toFixed(2);
    const height = catalogue.preview.vehicle.height_m;

    return (
        <div className="studio-twin">
            <div className="studio-twin-metrics" role="status">
                <span>{t('equipment.metric.collision', { length, width })}</span>
                <span>{t('equipment.metric.swept', { radius })}</span>
                <span>
                    {envelope.kinematics === 'skid_steer'
                        ? t('equipment.metric.pivot', { turn })
                        : t('equipment.metric.turn', { turn })}
                </span>
            </div>
            <div className="studio-twin-canvas">
                <figure>
                    <figcaption>{t('equipment.view.top')}</figcaption>
                    <TwinPlan envelope={envelope} label={t} />
                    <p className="studio-twin-legend">
                        <span className="is-nav">{t('equipment.legend.nav')}</span>
                        <span className="is-hitch">
                            {envelope.hitchMode === 'trailed'
                                ? t('equipment.legend.hitchArticulation')
                                : t('equipment.legend.hitch')}
                        </span>
                        {envelope.hitchMode === 'trailed' ? (
                            <>
                                <span className="is-drawbar">{t('equipment.legend.drawbar')}</span>
                                <span className="is-axle">{t('equipment.legend.axle')}</span>
                                <span className="is-swing">
                                    {t('equipment.legend.trailerSwing')}
                                </span>
                            </>
                        ) : (
                            <span className="is-work">{t('equipment.legend.work')}</span>
                        )}
                        <span className="is-swept">{t('equipment.legend.swept')}</span>
                    </p>
                </figure>
                <figure>
                    <figcaption>{t('equipment.view.side')}</figcaption>
                    <svg
                        className="studio-twin-svg"
                        viewBox="0 0 400 160"
                        role="img"
                        aria-label={t('equipment.view.side')}
                    >
                        <rect
                            className="studio-twin-vehicle"
                            x="140"
                            y={height ? 40 : 50}
                            width="180"
                            height={height ? 80 : 60}
                        />
                        {catalogue.preview.implement ? (
                            envelope.hitchMode === 'trailed' ? (
                                <>
                                    <line
                                        x1="140"
                                        y1="100"
                                        x2="70"
                                        y2="100"
                                        className="studio-twin-drawbar"
                                    />
                                    <circle cx="140" cy="100" r="4" fill={COLOR.warning} />
                                    <rect
                                        className="studio-twin-implement"
                                        x="18"
                                        y="65"
                                        width="55"
                                        height="65"
                                    />
                                </>
                            ) : (
                                <rect
                                    className="studio-twin-implement"
                                    x="100"
                                    y="70"
                                    width="50"
                                    height="50"
                                />
                            )
                        ) : null}
                        <line x1="20" y1="130" x2="380" y2="130" className="studio-twin-axis" />
                        <text x="200" y="150" textAnchor="middle" className="studio-twin-caption">
                            {height
                                ? t('equipment.metric.height', { height: height.toFixed(2) })
                                : t('equipment.metric.heightUnknown')}
                        </text>
                    </svg>
                </figure>
            </div>
        </div>
    );
}
