import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    planCoverage,
    type CoveragePlanRequest,
    type CoveragePlanResult,
    type CoveragePreview,
} from '../coverage/api';
import type { AgriDocument } from '../domain/agri';
import { roundOriginLatLon } from '../domain/draft';
import type { CombinationTwin, ImplementTwin, VehicleTwin } from '../domain/equipment';
import type { FieldDetail, FieldSummary } from '../fields/types';
import {
    ASSISTANT_STEPS,
    defaultMissionBrief,
    missingBriefGates,
    ringFromPolygon,
    type AssistantStep,
    type MissionBrief,
} from './brief';
import { composeGeneratedMission } from './compose';

export interface AssistantSummary {
    rows: number;
    points: number;
    turns: number;
    swath_count: number;
    length_m: number;
    headland_laps: number;
    engine: string;
}

interface UseMissionAssistantArgs {
    fields: FieldSummary[];
    selectedField: FieldDetail | null;
    combinations: CombinationTwin[];
    vehicles: VehicleTwin[];
    implements: ImplementTwin[];
    equipmentSnapshot: Record<string, unknown> | null;
    vehicleWidthM: number | null;
    geofenceMarginM?: number | null;
    onSelectField: (id: string, options?: { fit?: boolean }) => void;
    onApply: (document: AgriDocument, summary: AssistantSummary) => void;
}

function combinationWorkingWidth(
    combination: CombinationTwin | undefined,
    implementsList: ImplementTwin[],
): number | null {
    if (!combination?.implement_id) {
        return null;
    }
    const tool = implementsList.find((item) => item.id === combination.implement_id);
    return tool && tool.working_width_m > 0 ? tool.working_width_m : null;
}

function combinationKinematics(
    combination: CombinationTwin | undefined,
    vehicles: VehicleTwin[],
): VehicleTwin['kinematics'] | null {
    if (!combination) {
        return null;
    }
    return vehicles.find((item) => item.id === combination.vehicle_id)?.kinematics ?? null;
}

function coveragePlanPayload(
    brief: MissionBrief,
    ring: Array<{ lat: number; lng: number }>,
    vehicleWidthM: number | null,
    variants: boolean,
    geofenceMarginM?: number | null,
): CoveragePlanRequest | null {
    const first = ring[0];
    if (!first) {
        return null;
    }
    const origin = roundOriginLatLon(first.lat, first.lng);
    if (brief.row_set_id) {
        return {
            origin,
            working_width_m: brief.working_width_m,
            vehicle_width_m: vehicleWidthM ?? undefined,
            strategy: brief.strategy,
            variants: false,
            field_id: brief.field_id,
            row_set_id: brief.row_set_id,
            overlap_m: brief.overlap_m,
        };
    }
    return {
        ring,
        origin,
        working_width_m: brief.working_width_m,
        vehicle_width_m: vehicleWidthM ?? undefined,
        strategy: brief.strategy,
        variants,
        headland_width_m: brief.headland_width_m,
        overlap_m: brief.overlap_m,
        geofence_margin_m: geofenceMarginM && geofenceMarginM > 0 ? geofenceMarginM : undefined,
    };
}

export function useMissionAssistant({
    fields,
    selectedField,
    combinations,
    vehicles,
    implements: implementsList,
    equipmentSnapshot,
    vehicleWidthM,
    geofenceMarginM,
    onSelectField,
    onApply,
}: UseMissionAssistantArgs) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<AssistantStep>('objective');
    const [brief, setBrief] = useState<MissionBrief>(() => defaultMissionBrief());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<AssistantSummary | null>(null);
    const [preview, setPreview] = useState<CoveragePreview | null>(null);
    const [plan, setPlan] = useState<CoveragePlanResult | null>(null);
    const planRef = useRef<CoveragePlanResult | null>(null);
    const briefRef = useRef(brief);
    briefRef.current = brief;
    planRef.current = plan;

    const patch = useCallback(
        (partial: Partial<MissionBrief>) => {
            setBrief((current) => ({ ...current, ...partial }));
            setSummary(null);
            setError(null);
            if (partial.field_id) {
                onSelectField(partial.field_id, { fit: true });
            }
        },
        [onSelectField],
    );

    const start = useCallback(() => {
        const next = defaultMissionBrief();
        const firstField = fields[0];
        const firstCombination = combinations[0];
        if (firstField) {
            next.field_id = firstField.id;
            if (firstField.campaign) {
                next.campaign = firstField.campaign;
            }
        }
        if (firstCombination) {
            next.combination_id = firstCombination.id;
            const width = combinationWorkingWidth(firstCombination, implementsList);
            if (width) {
                next.working_width_m = width;
            }
            const kinematics = combinationKinematics(firstCombination, vehicles);
            next.connect_turns = kinematics !== 'ackermann';
            next.turn_type = kinematics === 'ackermann' ? 'u_turn' : 'square';
        }
        setBrief(next);
        setStep('objective');
        setOpen(true);
        setSummary(null);
        setError(null);
        setPlan(null);
        setPreview(null);
        if (next.field_id) {
            onSelectField(next.field_id, { fit: true });
        }
    }, [combinations, fields, implementsList, onSelectField, vehicles]);

    const close = useCallback(() => {
        setOpen(false);
        setPreview(null);
        setBusy(false);
    }, []);

    const stepIndex = ASSISTANT_STEPS.indexOf(step);

    const goNext = useCallback(() => {
        const next = ASSISTANT_STEPS[stepIndex + 1];
        if (next) {
            setStep(next);
        }
    }, [stepIndex]);

    const goBack = useCallback(() => {
        const previous = ASSISTANT_STEPS[stepIndex - 1];
        if (previous) {
            setStep(previous);
        }
    }, [stepIndex]);

    const gates = useMemo(() => missingBriefGates(brief), [brief]);
    const ring = useMemo(
        () =>
            ringFromPolygon(
                selectedField?.geometry ??
                    fields.find((item) => item.id === brief.field_id)?.geometry,
            ),
        [brief.field_id, fields, selectedField],
    );

    useEffect(() => {
        const combination = combinations.find((item) => item.id === brief.combination_id);
        if (!combination) {
            return;
        }
        const width = combinationWorkingWidth(combination, implementsList);
        const kinematics = combinationKinematics(combination, vehicles);
        setBrief((current) => {
            const next = { ...current };
            let changed = false;
            if (width && current.working_width_m === defaultMissionBrief().working_width_m) {
                next.working_width_m = width;
                changed = true;
            }
            if (kinematics === 'ackermann' && current.turn_type === 'square') {
                next.turn_type = 'u_turn';
                next.connect_turns = false;
                changed = true;
            }
            return changed ? next : current;
        });
    }, [brief.combination_id, combinations, implementsList, vehicles]);

    useEffect(() => {
        if (!open || (step !== 'strategy' && step !== 'generate')) {
            setPreview(null);
            return;
        }
        if (ring.length < 3 || !(brief.working_width_m > 0)) {
            return;
        }
        let cancelled = false;
        const timer = window.setTimeout(() => {
            const payload = coveragePlanPayload(brief, ring, vehicleWidthM, true, geofenceMarginM);
            if (!payload) {
                return;
            }
            void planCoverage(payload)
                .then((nextPlan) => {
                    if (cancelled) {
                        return;
                    }
                    setPlan(nextPlan);
                    const chosen =
                        nextPlan.variants.find(
                            (item) => item.strategy === briefRef.current.strategy,
                        ) ?? nextPlan;
                    setPreview({
                        origin: nextPlan.origin,
                        work: chosen.sections,
                        headlands: nextPlan.headland_sections,
                    });
                })
                .catch(() => {
                    if (!cancelled) {
                        setPreview(null);
                    }
                });
        }, 280);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [
        brief.headland_width_m,
        brief.overlap_m,
        brief.row_set_id,
        brief.strategy,
        brief.working_width_m,
        open,
        ring,
        step,
        vehicleWidthM,
        geofenceMarginM,
        brief.field_id,
    ]);

    const generate = useCallback(async () => {
        if (gates.length > 0) {
            setError('assist.blocked');
            return;
        }
        const first = ring[0];
        if (!first || ring.length < 3) {
            setError('assist.gate.field');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const payload = coveragePlanPayload(brief, ring, vehicleWidthM, true, geofenceMarginM);
            if (!payload) {
                setError('assist.gate.field');
                return;
            }
            const nextPlan = await planCoverage(payload);
            const composed = composeGeneratedMission({
                ring,
                plan: nextPlan,
                brief,
                equipment: equipmentSnapshot,
                strategy: brief.strategy,
                connectTurns: brief.connect_turns,
                turnType: brief.turn_type,
                vehicleWidthM,
                geofenceMarginM,
            });
            if (!composed.ok) {
                setError(`assist.fail.${composed.reason}`);
                return;
            }
            const nextSummary: AssistantSummary = {
                rows: composed.rows,
                points: composed.points,
                turns: composed.turns,
                swath_count: nextPlan.metrics.swath_count,
                length_m: nextPlan.metrics.length_m,
                headland_laps: nextPlan.metrics.headland_laps,
                engine: nextPlan.engine,
            };
            onApply(composed.document, nextSummary);
            setSummary(nextSummary);
            setPreview(null);
            setPlan(nextPlan);
        } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : 'assist.fail.plan');
        } finally {
            setBusy(false);
        }
    }, [brief, equipmentSnapshot, gates.length, geofenceMarginM, onApply, ring, vehicleWidthM]);

    return {
        open,
        start,
        close,
        step,
        setStep,
        stepIndex,
        brief,
        patch,
        goNext,
        goBack,
        gates,
        busy,
        error,
        summary,
        preview,
        plan,
        generate,
        canGenerate: gates.length === 0 && ring.length >= 3,
        ringCount: ring.length,
    };
}
