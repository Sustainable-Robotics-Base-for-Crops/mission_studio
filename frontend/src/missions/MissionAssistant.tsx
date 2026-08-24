import { useState, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Accordion } from '../design-system/Disclosure';
import { Input, Select } from '../design-system/Field';
import { isAdvancedUi, type UiMode } from '../app/farm-api';
import type { AgriDocument } from '../domain/agri';
import type { GeofenceId } from '../domain/geofence';
import { readCropPack, workSectionIndices, writeCropPack } from '../domain/crop-pack';
import type { CombinationEnvelope, CombinationTwin, ImplementTwin } from '../domain/equipment';
import type { OddProfile } from '../domain/odd';
import type { FieldDetail, FieldSummary } from '../fields/types';
import type { MissionRef } from '../map/missions-api';
import { ApplyToFieldsDialog } from '../packs/ApplyToFieldsDialog';
import { PacksPanel } from '../packs/PacksPanel';
import { TeachRepeatDialog } from '../packs/TeachRepeatDialog';
import {
    ASSISTANT_STEPS,
    OPERATIONS,
    PRIORITIES,
    suggestedMissionName,
    type AssistantStep,
    type MissionBrief,
} from './brief';
import { MissionTree } from './MissionTree';
import type { MissionTreeModel } from './tree';
import type { useMissionAssistant } from './useMissionAssistant';

type Assistant = ReturnType<typeof useMissionAssistant>;

export interface MissionAssistantProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    overlay?: boolean;
    /** Keep the historical full panel by default; MissionPanel can expose its existing blocks separately. */
    view?: 'all' | 'create' | 'edit';
    assistant: Assistant;
    fields: FieldSummary[];
    selectedField: FieldDetail | null;
    fieldsAvailable: boolean;
    combinations: CombinationTwin[];
    implements: ImplementTwin[];
    missions: MissionRef[];
    activePath: string | null;
    hasWorkingDocument?: boolean;
    onSelectMission: (path: string) => void;
    tree?: MissionTreeModel;
    selectedIndices?: number[];
    hiddenIndices?: number[];
    lockedIndices?: number[];
    onSelectSection?: (index: number, additive: boolean) => void;
    onToggleHidden?: (index: number) => void;
    onToggleLocked?: (index: number) => void;
    selectedGeofenceId?: GeofenceId | null;
    hiddenGeofenceIds?: GeofenceId[];
    lockedGeofenceIds?: GeofenceId[];
    onSelectGeofence?: (id: GeofenceId) => void;
    onToggleGeofenceHidden?: (id: GeofenceId) => void;
    onToggleGeofenceLocked?: (id: GeofenceId) => void;
    onAddGeofenceExclusion?: () => void;
    onDeleteSection?: (index: number) => void;
    onDeleteGeofenceExclusion?: (id: GeofenceId) => void;
    document?: AgriDocument | null;
    envelope?: CombinationEnvelope | null;
    equipmentSnapshot?: Record<string, unknown> | null;
    odd?: OddProfile | null;
    vehicleWidthM?: number | null;
    geofenceMarginM?: number | null;
    canGenerateBeds?: boolean;
    onGenerate18Beds?: () => void;
    onApplyDocument?: (document: AgriDocument) => void;
    uiMode?: UiMode;
}

const STRATEGIES = ['boustrophedon', 'perpendicular', 'best_nswath'] as const;

function StepFields({
    step,
    brief,
    patch,
    t,
    fields,
    selectedField,
    fieldsAvailable,
    combinations,
    implements: implementsList,
}: {
    step: AssistantStep;
    brief: MissionBrief;
    patch: (partial: Partial<MissionBrief>) => void;
    t: MissionAssistantProps['t'];
    fields: FieldSummary[];
    selectedField: FieldDetail | null;
    fieldsAvailable: boolean;
    combinations: CombinationTwin[];
    implements: ImplementTwin[];
}): ReactElement {
    if (step === 'objective') {
        const fieldName =
            brief.field_name || fields.find((item) => item.id === brief.field_id)?.name || '';
        const suggestion = suggestedMissionName(
            t(`assist.operation.${brief.operation}`),
            fieldName,
        );
        return (
            <>
                <Input
                    id="assist-name"
                    label={t('assist.field.name')}
                    value={brief.name || suggestion}
                    onChange={(event) => patch({ name: event.target.value })}
                    help={t('assist.help.name')}
                />
                <Select
                    id="assist-operation"
                    label={t('assist.field.operation')}
                    value={brief.operation}
                    onValueChange={(value) =>
                        patch({ operation: value as MissionBrief['operation'] })
                    }
                    options={OPERATIONS.map((item) => ({
                        value: item,
                        label: t(`assist.operation.${item}`),
                    }))}
                    help={t('assist.help.operation')}
                />
                <Input
                    id="assist-campaign"
                    label={t('assist.field.campaign')}
                    value={brief.campaign}
                    onChange={(event) => patch({ campaign: event.target.value })}
                />
                <Input
                    id="assist-from"
                    label={t('assist.field.windowFrom')}
                    type="date"
                    value={brief.window_from}
                    onChange={(event) => patch({ window_from: event.target.value })}
                />
                <Input
                    id="assist-to"
                    label={t('assist.field.windowTo')}
                    type="date"
                    value={brief.window_to}
                    onChange={(event) => patch({ window_to: event.target.value })}
                />
                <Select
                    id="assist-priority"
                    label={t('assist.field.priority')}
                    value={brief.priority}
                    onValueChange={(value) =>
                        patch({ priority: value as MissionBrief['priority'] })
                    }
                    options={PRIORITIES.map((item) => ({
                        value: item,
                        label: t(`assist.priority.${item}`),
                    }))}
                />
            </>
        );
    }
    if (step === 'parcel') {
        return (
            <>
                {!fieldsAvailable ? (
                    <p className="studio-muted">{t('fields.unavailable')}</p>
                ) : null}
                <Select
                    id="assist-field"
                    label={t('assist.field.parcel')}
                    value={brief.field_id}
                    onValueChange={(value) => patch({ field_id: value, row_set_id: '' })}
                    options={[
                        { value: '', label: t('assist.choose') },
                        ...fields.map((item) => ({ value: item.id, label: item.name })),
                    ]}
                    help={t('assist.help.parcel')}
                />
                {selectedField ? (
                    <p className="studio-muted">
                        {selectedField.qualified_for_autonomy
                            ? t('assist.autonomyOk')
                            : t('assist.autonomyWarn')}
                    </p>
                ) : null}
                <Select
                    id="assist-rows"
                    label={t('assist.field.rowSet')}
                    value={brief.row_set_id}
                    onValueChange={(value) => patch({ row_set_id: value })}
                    options={[
                        { value: '', label: t('assist.rowSetNone') },
                        ...(selectedField?.row_sets ?? []).map((item) => ({
                            value: item.id,
                            label: item.name || item.id,
                        })),
                    ]}
                    help={t('assist.help.rowSet')}
                />
            </>
        );
    }
    if (step === 'machine') {
        return (
            <Select
                id="assist-combo"
                label={t('assist.field.combination')}
                value={brief.combination_id}
                onValueChange={(value) => patch({ combination_id: value })}
                options={[
                    { value: '', label: t('assist.choose') },
                    ...combinations.map((item) => ({ value: item.id, label: item.name })),
                ]}
                help={t('assist.help.combination')}
            />
        );
    }
    if (step === 'recipe') {
        const tool = combinations.find((item) => item.id === brief.combination_id)?.implement_id
            ? implementsList.find(
                  (item) =>
                      item.id ===
                      combinations.find((combo) => combo.id === brief.combination_id)?.implement_id,
              )
            : null;
        return (
            <>
                <Input
                    id="assist-width"
                    label={t('tool.rowSpacing')}
                    unit="m"
                    type="number"
                    step="0.1"
                    min="0.1"
                    source={
                        tool
                            ? t('tool.rowSpacingSourceEquipment', {
                                  width: tool.working_width_m,
                                  name: tool.name,
                              })
                            : undefined
                    }
                    value={String(brief.working_width_m)}
                    onChange={(event) => patch({ working_width_m: Number(event.target.value) })}
                    help={t('assist.help.recipe')}
                />
                <Input
                    id="assist-overlap"
                    label={t('assist.field.overlap')}
                    unit="m"
                    type="number"
                    step="0.05"
                    min="0"
                    value={String(brief.overlap_m)}
                    onChange={(event) => patch({ overlap_m: Number(event.target.value) })}
                />
                <Input
                    id="assist-speed"
                    label={t('tool.rowSpeed')}
                    unit="m/s"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="50"
                    value={String(brief.speed_mps)}
                    onChange={(event) => patch({ speed_mps: Number(event.target.value) })}
                />
                <Input
                    id="assist-recipe-note"
                    label={t('assist.field.recipeNote')}
                    value={brief.recipe_note}
                    onChange={(event) => patch({ recipe_note: event.target.value })}
                    help={t('assist.help.recipeNote')}
                />
            </>
        );
    }
    if (step === 'strategy') {
        return (
            <>
                <Select
                    id="assist-strategy"
                    label={t('tool.coverageStrategy')}
                    value={brief.strategy}
                    onValueChange={(value) =>
                        patch({ strategy: value as MissionBrief['strategy'] })
                    }
                    options={STRATEGIES.map((item) => ({
                        value: item,
                        label: t(`tool.coverageStrategy.${item}`),
                    }))}
                    help={t('tool.coverageStrategyHelp')}
                />
                <Input
                    id="assist-headland"
                    label={t('tool.headlandWidth')}
                    unit="m"
                    type="number"
                    step="0.1"
                    min="0"
                    value={String(brief.headland_width_m)}
                    onChange={(event) => patch({ headland_width_m: Number(event.target.value) })}
                    help={t('tool.headlandWidthHelp')}
                />
                <Select
                    id="assist-turn"
                    label={t('tool.turnType')}
                    value={brief.turn_type}
                    onValueChange={(value) =>
                        patch({ turn_type: value as MissionBrief['turn_type'] })
                    }
                    options={[
                        { value: 'square', label: t('tool.turnTypeSquare') },
                        { value: 'u_turn', label: t('tool.turnTypeUTurn') },
                    ]}
                />
                <label className="studio-turns-loop" htmlFor="assist-connect">
                    <input
                        id="assist-connect"
                        type="checkbox"
                        checked={brief.connect_turns}
                        onChange={(event) => patch({ connect_turns: event.target.checked })}
                    />
                    {t('tool.fillConnectTurns')}
                </label>
            </>
        );
    }
    if (step === 'logistics') {
        const nodes = selectedField?.traffic_nodes ?? [];
        return (
            <>
                <Input
                    id="assist-transit"
                    label={t('assist.field.transit')}
                    value={brief.transit_note}
                    onChange={(event) => patch({ transit_note: event.target.value })}
                    help={t('assist.help.transit')}
                />
                <Select
                    id="assist-service"
                    label={t('assist.field.service')}
                    value={brief.service_node_id}
                    onValueChange={(value) => patch({ service_node_id: value })}
                    options={[
                        { value: '', label: t('assist.none') },
                        ...nodes.map((item) => ({
                            value: item.id,
                            label: item.name || `${item.kind} ${item.id.slice(0, 6)}`,
                        })),
                    ]}
                />
                <Input
                    id="assist-weather"
                    label={t('assist.field.weather')}
                    value={brief.weather_note}
                    onChange={(event) => patch({ weather_note: event.target.value })}
                    help={t('assist.help.weather')}
                />
            </>
        );
    }
    return <p className="studio-muted">{t('assist.generateHint')}</p>;
}

export function MissionAssistant({
    t,
    overlay = false,
    view = 'all',
    assistant,
    fields,
    selectedField,
    fieldsAvailable,
    combinations,
    implements: implementsList,
    missions,
    activePath,
    hasWorkingDocument = false,
    onSelectMission,
    tree,
    selectedIndices = [],
    hiddenIndices = [],
    lockedIndices = [],
    onSelectSection,
    onToggleHidden,
    onToggleLocked,
    selectedGeofenceId = null,
    hiddenGeofenceIds = [],
    lockedGeofenceIds = [],
    onSelectGeofence,
    onToggleGeofenceHidden,
    onToggleGeofenceLocked,
    onAddGeofenceExclusion,
    onDeleteSection,
    onDeleteGeofenceExclusion,
    document = null,
    envelope = null,
    equipmentSnapshot = null,
    odd = null,
    vehicleWidthM = null,
    geofenceMarginM = null,
    canGenerateBeds = false,
    onGenerate18Beds,
    onApplyDocument,
    uiMode,
}: MissionAssistantProps): ReactElement {
    const [teachOpen, setTeachOpen] = useState(false);
    const [applyFieldsOpen, setApplyFieldsOpen] = useState(false);
    const [skipN, setSkipN] = useState('1');
    const pack = document ? readCropPack(document) : assistant.brief.crop_pack;
    const workCount = document ? workSectionIndices(document).length : 0;
    const mutate = (next: AgriDocument) => {
        onApplyDocument?.(next);
    };
    const skipEveryN = Math.max(0, Math.floor(Number(skipN)) || 0);
    return (
        <aside
            className={[
                overlay ? 'studio-context is-overlay' : 'studio-context',
                view === 'all' ? '' : `studio-mission-view-${view}`,
            ]
                .filter(Boolean)
                .join(' ')}
            aria-label={t('nav.missions')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.missions')}</h2>
            </header>
            <div className="studio-assist-toolbar">
                {view === 'create' ? null : (
                    <Button type="button" variant="primary" onClick={assistant.start}>
                        {t('assist.new')}
                    </Button>
                )}
                {assistant.open ? (
                    <Button type="button" variant="secondary" onClick={assistant.close}>
                        {t('assist.close')}
                    </Button>
                ) : null}
            </div>
            {assistant.open ? (
                <div className="studio-assist">
                    <ol className="studio-assist-steps" aria-label={t('assist.title')}>
                        {ASSISTANT_STEPS.map((item, index) => {
                            const current = item === assistant.step;
                            const done = index < assistant.stepIndex;
                            return (
                                <li key={item}>
                                    <button
                                        type="button"
                                        className={
                                            current
                                                ? 'studio-assist-step is-current'
                                                : done
                                                  ? 'studio-assist-step is-done'
                                                  : 'studio-assist-step'
                                        }
                                        aria-current={current ? 'step' : undefined}
                                        onClick={() => assistant.setStep(item)}
                                    >
                                        <span className="studio-assist-index">{index + 1}</span>
                                        <span>{t(`assist.step.${item}`)}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <div className="studio-assist-body">
                        <h3>{t(`assist.step.${assistant.step}`)}</h3>
                        <StepFields
                            step={assistant.step}
                            brief={assistant.brief}
                            patch={assistant.patch}
                            t={t}
                            fields={fields}
                            selectedField={selectedField}
                            fieldsAvailable={fieldsAvailable}
                            combinations={combinations}
                            implements={implementsList}
                        />
                        {assistant.step === 'generate' ? (
                            <>
                                {assistant.gates.length > 0 ? (
                                    <ul className="studio-assist-gates">
                                        {assistant.gates.map((gate) => (
                                            <li key={gate}>{t(`assist.gate.${gate}`)}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="studio-muted">{t('assist.ready')}</p>
                                )}
                                {assistant.error ? (
                                    <p className="ds-field-error" role="alert">
                                        {assistant.error.startsWith('assist.')
                                            ? t(assistant.error)
                                            : assistant.error}
                                    </p>
                                ) : null}
                                {assistant.summary ? (
                                    <p className="studio-assist-summary">
                                        {t('assist.summary', {
                                            rows: assistant.summary.rows,
                                            turns: assistant.summary.turns,
                                            length: Math.round(assistant.summary.length_m),
                                            engine: assistant.summary.engine,
                                        })}
                                    </p>
                                ) : null}
                            </>
                        ) : null}
                        <div className="studio-assist-nav">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={assistant.goBack}
                                disabled={assistant.stepIndex === 0}
                            >
                                {t('assist.back')}
                            </Button>
                            {assistant.step === 'generate' ? (
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={() => void assistant.generate()}
                                    disabled={!assistant.canGenerate || assistant.busy}
                                >
                                    {assistant.busy ? t('assist.generating') : t('assist.generate')}
                                </Button>
                            ) : (
                                <Button type="button" variant="primary" onClick={assistant.goNext}>
                                    {t('assist.next')}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <p className="studio-muted">{t('assist.intro')}</p>
            )}
            <PacksPanel
                t={t}
                pack={pack}
                workCount={workCount}
                hasDocument={Boolean(document)}
                canGenerateBeds={canGenerateBeds}
                document={document}
                skipN={skipN}
                onSkipNChange={setSkipN}
                onPackChange={(next) => {
                    assistant.patch({ crop_pack: next });
                    if (document) {
                        mutate(writeCropPack(document, next));
                    }
                }}
                onMutate={mutate}
                onOpenTeach={() => setTeachOpen(true)}
                onOpenApplyFields={() => setApplyFieldsOpen(true)}
                onGenerate18Beds={() => onGenerate18Beds?.()}
            />
            <TeachRepeatDialog
                open={teachOpen}
                envelope={envelope}
                onOpenChange={setTeachOpen}
                onApply={(next) => mutate(next)}
                t={t}
            />
            <ApplyToFieldsDialog
                open={applyFieldsOpen}
                fields={fields}
                currentFieldId={assistant.brief.field_id || selectedField?.id || ''}
                brief={{ ...assistant.brief, crop_pack: pack }}
                equipment={equipmentSnapshot}
                odd={odd}
                vehicleWidthM={vehicleWidthM}
                geofenceMarginM={geofenceMarginM}
                skipEveryN={skipEveryN}
                onOpenChange={setApplyFieldsOpen}
                t={t}
            />
            <div className="studio-mission-list">
                <h3>{t('map.loaded')}</h3>
                {missions.length === 0 ? (
                    <p className="studio-muted">
                        {hasWorkingDocument ? t('map.draftNotListed') : t('map.empty')}
                    </p>
                ) : (
                    <ul>
                        {missions.map((mission) => (
                            <li key={mission.path}>
                                <button
                                    type="button"
                                    className={
                                        mission.path === activePath ? 'is-active' : undefined
                                    }
                                    onClick={() => onSelectMission(mission.path)}
                                >
                                    <span>{mission.name}</span>
                                    <span className="studio-muted">
                                        {mission.type}/{mission.vehicle}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {isAdvancedUi(uiMode) &&
            tree &&
            (tree.leaves.length > 0 || tree.geofence.length > 0) &&
            onSelectSection &&
            onToggleHidden &&
            onToggleLocked ? (
                <div className="studio-tree-panel">
                    <Accordion
                        defaultValue="tree"
                        items={[
                            {
                                value: 'tree',
                                title: t('tree.title'),
                                content: (
                                    <MissionTree
                                        t={t}
                                        tree={tree}
                                        selectedIndices={selectedIndices}
                                        hiddenIndices={hiddenIndices}
                                        lockedIndices={lockedIndices}
                                        onSelect={onSelectSection}
                                        onToggleHidden={onToggleHidden}
                                        onToggleLocked={onToggleLocked}
                                        selectedGeofenceId={selectedGeofenceId}
                                        hiddenGeofenceIds={hiddenGeofenceIds}
                                        lockedGeofenceIds={lockedGeofenceIds}
                                        onSelectGeofence={onSelectGeofence}
                                        onToggleGeofenceHidden={onToggleGeofenceHidden}
                                        onToggleGeofenceLocked={onToggleGeofenceLocked}
                                        onAddGeofenceExclusion={onAddGeofenceExclusion}
                                        onDelete={onDeleteSection}
                                        onDeleteGeofenceExclusion={onDeleteGeofenceExclusion}
                                    />
                                ),
                            },
                        ]}
                    />
                </div>
            ) : null}
        </aside>
    );
}
