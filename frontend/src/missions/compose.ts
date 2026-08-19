import type { CoveragePlanResult, CoverageStrategy } from '../coverage/api';
import { appendConnectedCoverage, createEmptyDocument, setDrawnGeofence } from '../domain/draft';
import type { AgriDocument } from '../domain/agri';
import type { LatLng } from '../domain/geometry';
import { DEFAULT_CONNECT_TURNS, type TurnKind } from '../domain/turns';
import { briefToMetadata, type MissionBrief } from './brief';

export interface ComposeGeneratedMissionInput {
    ring: LatLng[];
    plan: CoveragePlanResult;
    brief: MissionBrief;
    equipment: Record<string, unknown> | null;
    strategy: CoverageStrategy;
    connectTurns: boolean;
    turnType: TurnKind;
    vehicleWidthM?: number | null;
    geofenceMarginM?: number | null;
}

export type ComposeGeneratedMissionResult =
    | {
          ok: true;
          document: AgriDocument;
          rows: number;
          points: number;
          turns: number;
      }
    | { ok: false; reason: string };

export function composeGeneratedMission(
    input: ComposeGeneratedMissionInput,
): ComposeGeneratedMissionResult {
    const first = input.ring[0];
    if (!first || input.ring.length < 3) {
        return { ok: false, reason: 'field' };
    }
    const chosen =
        input.plan.variants.find((item) => item.strategy === input.strategy) ?? input.plan;
    const empty = createEmptyDocument();
    const fenced = setDrawnGeofence(empty, input.ring);
    const base = fenced.ok ? fenced.document : empty;
    const coverageMeta =
        input.plan.srbc_coverage !== null && typeof input.plan.srbc_coverage === 'object'
            ? input.plan.srbc_coverage
            : {};
    const plannedHeadland = Number(coverageMeta.headland_width_m);
    const plannedKeepout = Number(coverageMeta.geofence_margin_m);
    const next = appendConnectedCoverage(
        base,
        first,
        chosen.sections,
        input.plan.headland_sections,
        input.plan.srbc_coverage,
        input.connectTurns
            ? { ...DEFAULT_CONNECT_TURNS, turnType: input.turnType, densifyRows: false }
            : null,
        input.plan.origin,
        input.connectTurns
            ? {
                  clearanceM: input.geofenceMarginM,
                  alreadyReservedM: Math.max(
                      Number.isFinite(plannedHeadland) && plannedHeadland > 0
                          ? plannedHeadland
                          : input.brief.headland_width_m > 0
                            ? input.brief.headland_width_m
                            : 0,
                      Number.isFinite(plannedKeepout) && plannedKeepout > 0 ? plannedKeepout : 0,
                  ),
              }
            : undefined,
    );
    if (!next.ok) {
        return { ok: false, reason: next.reason };
    }
    const metadata =
        next.document.metadata !== null && typeof next.document.metadata === 'object'
            ? { ...(next.document.metadata as Record<string, unknown>) }
            : {};
    if (input.equipment) {
        metadata.srbc_equipment = input.equipment;
    }
    metadata.srbc_mission_brief = briefToMetadata(input.brief);
    return {
        ok: true,
        document: { ...next.document, metadata },
        rows: next.rows,
        points: next.points,
        turns: next.turns,
    };
}
