import type { ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Tabs } from '../design-system/Disclosure';
import { Input, Select } from '../design-system/Field';
import { LANDMARK_KINDS, ZONE_KINDS, type LandmarkKind, type ZoneKind } from './types';
import { formatLandmarkGps, formatLandmarkMeters } from './landmarks';
import type { FieldLassoHit, FieldsLineKind } from './edit-tools';
import type { FieldsFollowUpForm } from './useFieldsFollowUpForm';
import type { useFieldCatalogue } from './useFieldCatalogue';

type Catalogue = ReturnType<typeof useFieldCatalogue>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

export type FieldsLassoTab = 'entities' | 'portions';

export const LINE_KINDS: FieldsLineKind[] = ['perennial', 'bed', 'guidance', 'path'];

export interface FieldsActionPanelProps {
    t: Translate;
    catalogue: Catalogue;
    form: FieldsFollowUpForm;
    lassoTab: FieldsLassoTab;
    onLassoTab: (tab: FieldsLassoTab) => void;
}

/**
 * Options of the tool currently in use, rendered inside the right panel
 * (CdC §5.2) — the parcellaire twin of the mission `ZoneActionPanel`.
 */
export function FieldsActionPanel({
    t,
    catalogue,
    form,
    lassoTab,
    onLassoTab,
}: FieldsActionPanelProps): ReactElement | null {
    if (catalogue.followUp) {
        return <FollowUpSection t={t} catalogue={catalogue} form={form} />;
    }
    if (catalogue.editIntent === 'create_field') {
        return <FieldDraftSection t={t} catalogue={catalogue} />;
    }
    if (catalogue.editIntent === 'polyline') {
        return <PolylineSection t={t} catalogue={catalogue} />;
    }
    if (catalogue.editIntent === 'surface') {
        return <SurfaceSection t={t} catalogue={catalogue} />;
    }
    if (catalogue.editIntent === 'geofence') {
        return <GeofenceSection t={t} catalogue={catalogue} />;
    }
    if (catalogue.editIntent === 'lasso' || catalogue.lassoHits.length > 0) {
        return <LassoSection t={t} catalogue={catalogue} tab={lassoTab} onTab={onLassoTab} />;
    }
    if (catalogue.editIntent === 'landmark' || catalogue.tool === 'ruler') {
        return <LandmarkSection t={t} catalogue={catalogue} />;
    }
    return null;
}

function LandmarkSection({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    const measure = catalogue.landmarkMeasure;
    const last = formatLandmarkMeters(measure.lastSegmentM);
    const area =
        measure.areaM2 !== null && Number.isFinite(measure.areaM2)
            ? `${Math.round(measure.areaM2)} m²`
            : null;
    const point =
        catalogue.draft[0] ?? (catalogue.landmarkKind === 'point' ? catalogue.landmarkHover : null);
    return (
        <section className="studio-fields-action" aria-label={t('fields.edit.ruler')}>
            <h3>{t('fields.edit.ruler')}</h3>
            <Select
                id="fields-landmark-kind"
                label={t('fields.landmark.kind')}
                value={catalogue.landmarkKind}
                onValueChange={(value) => catalogue.setLandmarkKind(value as LandmarkKind)}
                options={LANDMARK_KINDS.map((kind) => ({
                    value: kind,
                    label: t(`fields.landmark.kind.${kind}`),
                }))}
            />
            <p className="studio-muted">{t(`fields.landmark.help.${catalogue.landmarkKind}`)}</p>
            {catalogue.landmarkKind === 'circle' ? (
                <Input
                    id="fields-circle-radius"
                    label={t('fields.landmark.radius')}
                    unit="m"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={catalogue.circleRadiusM}
                    onChange={(event) => catalogue.updateCircleRadius(event.target.value)}
                />
            ) : null}
            {catalogue.landmarkKind === 'point' && point ? (
                <p className="studio-muted">
                    {t('fields.landmark.gps', { coords: formatLandmarkGps(point) })}
                </p>
            ) : null}
            {last && catalogue.landmarkKind !== 'point' ? (
                <p>{t('fields.landmark.distance', { distance: last })}</p>
            ) : null}
            {catalogue.landmarkKind === 'polygon' && measure.segmentsM.length > 0 ? (
                <ul className="studio-fields-lasso-hits" aria-label={t('fields.landmark.segments')}>
                    {measure.segmentsM.map((meters, index) => (
                        <li key={`${index}-${meters}`}>
                            {t('fields.landmark.segment', {
                                n: index + 1,
                                distance: formatLandmarkMeters(meters) ?? '—',
                            })}
                        </li>
                    ))}
                </ul>
            ) : null}
            {area ? <p>{t('fields.landmark.area', { area })}</p> : null}
            <Input
                id="fields-landmark-name"
                label={t('fields.landmark.name')}
                value={catalogue.newName}
                onChange={(event) => catalogue.setNewName(event.target.value)}
            />
            <div className="studio-field-draw-actions">
                <Button
                    type="button"
                    variant="primary"
                    disabled={!catalogue.canPinLandmark}
                    onClick={() => void catalogue.pinLandmark()}
                >
                    {t('fields.landmark.pin')}
                </Button>
                <Button type="button" variant="secondary" onClick={catalogue.cancelDraft}>
                    {t('fields.tool.cancel')}
                </Button>
            </div>
        </section>
    );
}

function FollowUpSection({
    t,
    catalogue,
    form,
}: {
    t: Translate;
    catalogue: Catalogue;
    form: FieldsFollowUpForm;
}): ReactElement {
    const followUp = catalogue.followUp;
    return (
        <section className="studio-fields-action" aria-label={t('fields.edit.followUp')}>
            <h3>{t(`fields.edit.followUp.${followUp}`)}</h3>
            {followUp === 'path_width' ? (
                <Input
                    id="fields-path-width"
                    label={t('fields.edit.pathWidth')}
                    unit="m"
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={form.pathWidth}
                    onChange={(event) => form.setPathWidth(event.target.value)}
                />
            ) : (
                <>
                    <Input
                        id="fields-dup-count"
                        label={t('fields.edit.duplicateCount')}
                        type="number"
                        min="0"
                        step="1"
                        value={form.count}
                        onChange={(event) => form.setCount(event.target.value)}
                    />
                    <Input
                        id="fields-dup-spacing"
                        label={t('fields.edit.duplicateSpacing')}
                        unit="m"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={form.spacing}
                        onChange={(event) => form.setSpacing(event.target.value)}
                    />
                    <Select
                        id="fields-dup-side"
                        label={t('fields.edit.duplicateSide')}
                        value={form.side}
                        onValueChange={(value) => form.setSide(value as 'left' | 'right')}
                        options={[
                            { value: 'left', label: t('fields.edit.side.left') },
                            { value: 'right', label: t('fields.edit.side.right') },
                        ]}
                    />
                    {followUp === 'duplicate_bed' ? (
                        <Input
                            id="fields-bed-width"
                            label={t('fields.edit.bedWidth')}
                            unit="m"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={form.bedWidth}
                            onChange={(event) => form.setBedWidth(event.target.value)}
                        />
                    ) : null}
                </>
            )}
            <div className="studio-publish-actions">
                <Button type="button" variant="secondary" onClick={catalogue.dismissFollowUp}>
                    {t('pub.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    onClick={() => void catalogue.applyFollowUp(form.values)}
                >
                    {t('fields.edit.followUp.confirm')}
                </Button>
            </div>
        </section>
    );
}

/** True while the map is collecting points for a new object. */
function isDrawing(catalogue: Catalogue): boolean {
    return (
        catalogue.tool === 'draw_line' ||
        catalogue.tool === 'draw_polygon' ||
        catalogue.tool === 'draw_point'
    );
}

/**
 * Validate and cancel live next to the options of the tool (CdC §5.2), so the
 * whole creation happens in one panel instead of straddling both sides.
 */
function DraftActions({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    const points = catalogue.draft.length;
    const canFinish =
        catalogue.tool === 'draw_point'
            ? points >= 1
            : catalogue.tool === 'draw_line'
              ? points >= 2
              : points >= 3;
    return (
        <div className="studio-field-draw-actions">
            <Button
                type="button"
                variant="primary"
                disabled={!canFinish}
                onClick={() => void catalogue.finishDraft()}
            >
                {t(
                    catalogue.tool === 'draw_point'
                        ? 'fields.tool.finishPoint'
                        : catalogue.tool === 'draw_line'
                          ? 'fields.tool.finishLine'
                          : 'fields.tool.finish',
                )}
            </Button>
            <Button type="button" variant="secondary" onClick={catalogue.cancelDraft}>
                {t('fields.tool.cancel')}
            </Button>
        </div>
    );
}

function FieldDraftSection({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    return (
        <section className="studio-fields-action" aria-label={t('fields.create.heading')}>
            <h3>{t('fields.create.heading')}</h3>
            <Input
                id="fields-parcel-name"
                label={t('fields.create.nameDialog.label')}
                value={catalogue.newName}
                onChange={(event) => catalogue.setNewName(event.target.value)}
            />
            <p className="studio-muted">{t('fields.drawHint')}</p>
            {isDrawing(catalogue) ? <DraftActions t={t} catalogue={catalogue} /> : null}
        </section>
    );
}

function PolylineSection({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    const drawing = isDrawing(catalogue);
    return (
        <section className="studio-fields-action" aria-label={t('fields.edit.polyline')}>
            <h3>{t('fields.edit.polylineType')}</h3>
            <Select
                id="fields-line-kind"
                label={t('fields.edit.polylineType')}
                value={catalogue.lineKind}
                onValueChange={(value) => catalogue.setLineKind(value as FieldsLineKind)}
                options={LINE_KINDS.map((kind) => ({
                    value: kind,
                    label: t(`fields.edit.line.${kind}`),
                }))}
            />
            {catalogue.lineKind === 'perennial' ? (
                <Input
                    id="fields-crop-name"
                    label={t('fields.edit.cropName')}
                    value={catalogue.cropName}
                    onChange={(event) => catalogue.setCropName(event.target.value)}
                />
            ) : null}
            <p className="studio-muted">{t(`fields.edit.line.help.${catalogue.lineKind}`)}</p>
            {drawing ? (
                <>
                    <Input
                        id="fields-line-name"
                        label={t('fields.edit.lineName')}
                        value={catalogue.newName}
                        onChange={(event) => catalogue.setNewName(event.target.value)}
                    />
                    <DraftActions t={t} catalogue={catalogue} />
                </>
            ) : null}
        </section>
    );
}

function SurfaceSection({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    return (
        <section className="studio-fields-action" aria-label={t('fields.edit.surface')}>
            <h3>{t('fields.edit.surfaceType')}</h3>
            <Select
                id="fields-zone-kind"
                label={t('fields.zoneKind')}
                value={catalogue.zoneKind}
                onValueChange={(value) => catalogue.setZoneKind(value as ZoneKind)}
                options={ZONE_KINDS.map((kind) => ({
                    value: kind,
                    label: t(`fields.kind.${kind}`),
                }))}
            />
            <Input
                id="fields-zone-name"
                label={t('fields.edit.otherZoneName')}
                value={catalogue.newName}
                onChange={(event) => catalogue.setNewName(event.target.value)}
            />
            {isDrawing(catalogue) ? <DraftActions t={t} catalogue={catalogue} /> : null}
        </section>
    );
}

function GeofenceSection({ t, catalogue }: { t: Translate; catalogue: Catalogue }): ReactElement {
    if (isDrawing(catalogue)) {
        return (
            <section className="studio-fields-action" aria-label={t('fields.edit.geofence')}>
                <h3>{t('fields.edit.geofence')}</h3>
                <p className="studio-muted">{t('fields.drawHint')}</p>
                <DraftActions t={t} catalogue={catalogue} />
            </section>
        );
    }
    return (
        <section className="studio-fields-action" aria-label={t('fields.edit.geofence')}>
            <h3>{t('fields.edit.geofence')}</h3>
            <p className="studio-muted">{t('fields.edit.geofence.editHint')}</p>
            <Button
                type="button"
                variant="destructive"
                confirmLabel={t('fields.edit.geofence.deleteConfirm')}
                onClick={() => void catalogue.deleteGeofence()}
            >
                {t('fields.edit.geofence.delete')}
            </Button>
        </section>
    );
}

function LassoSection({
    t,
    catalogue,
    tab,
    onTab,
}: {
    t: Translate;
    catalogue: Catalogue;
    tab: FieldsLassoTab;
    onTab: (tab: FieldsLassoTab) => void;
}): ReactElement {
    const hits = catalogue.lassoHits;
    const deleteHits = () => void catalogue.deleteLassoHits();
    return (
        <section className="studio-fields-action" aria-label={t('fields.edit.lasso')}>
            <Tabs
                defaultValue="entities"
                value={tab}
                onValueChange={(value) => onTab(value as FieldsLassoTab)}
                items={[
                    {
                        value: 'entities',
                        label: t('zone.mode.entities'),
                        content: (
                            <div className="studio-panel-tab">
                                <p className="studio-muted">
                                    {t('fields.edit.lasso.entitiesHelp')}
                                </p>
                                <LassoList hits={hits} empty={t('fields.edit.lasso.empty')} />
                                <Button
                                    type="button"
                                    variant="destructive"
                                    disabled={hits.length === 0}
                                    confirmLabel={t('zone.deleteEntitiesConfirm')}
                                    onClick={deleteHits}
                                >
                                    {t('zone.deleteEntities')}
                                </Button>
                            </div>
                        ),
                    },
                    {
                        value: 'portions',
                        label: t('zone.mode.portions'),
                        content: (
                            <div className="studio-panel-tab">
                                <p className="studio-muted">
                                    {t('fields.edit.lasso.portionsHelp')}
                                </p>
                                <LassoList hits={hits} empty={t('fields.edit.lasso.empty')} />
                                <Button
                                    type="button"
                                    variant="destructive"
                                    disabled={hits.length === 0}
                                    confirmLabel={t('fields.edit.lasso.cutConfirm')}
                                    onClick={deleteHits}
                                >
                                    {t('fields.edit.lasso.cut')}
                                </Button>
                            </div>
                        ),
                    },
                ]}
            />
        </section>
    );
}

function LassoList({ hits, empty }: { hits: FieldLassoHit[]; empty: string }): ReactElement {
    if (hits.length === 0) {
        return <p className="studio-muted">{empty}</p>;
    }
    return (
        <ul className="studio-fields-lasso-hits">
            {hits.map((hit) => (
                <li key={`${hit.kind}:${hit.id}`}>{hit.label}</li>
            ))}
        </ul>
    );
}
