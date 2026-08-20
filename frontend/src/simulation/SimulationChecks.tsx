import { CircleCheck, CircleMinus, MapPin, TriangleAlert, X } from 'lucide-react';
import type { ReactElement } from 'react';

import { IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import {
    CHECK_GROUPS,
    type CheckStatus,
    type PoseSample,
    type SimulationCheck,
    type SimulationReport,
} from '../domain/simulation';

function statusIcon(status: CheckStatus): typeof CircleCheck {
    if (status === 'pass') {
        return CircleCheck;
    }
    if (status === 'warn') {
        return TriangleAlert;
    }
    if (status === 'block') {
        return X;
    }
    return CircleMinus;
}

function measuredLabel(check: SimulationCheck): string {
    if (check.measured === null) {
        return '—';
    }
    if (typeof check.measured === 'number') {
        return Number.isInteger(check.measured)
            ? String(check.measured)
            : check.measured.toFixed(2);
    }
    return check.measured;
}

export function SimulationChecks({
    t,
    report,
    onLocate,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    report: SimulationReport;
    onLocate: (sample: PoseSample) => void;
}): ReactElement {
    return (
        <ul className="studio-sim-checks">
            {CHECK_GROUPS.map((group) => {
                const items = report.checks.filter((check) => check.group === group);
                const worst = items.reduce<CheckStatus>((status, check) => {
                    if (check.status === 'block' || status === 'block') {
                        return 'block';
                    }
                    if (check.status === 'warn' || status === 'warn') {
                        return 'warn';
                    }
                    if (check.status === 'pass' || status === 'pass') {
                        return 'pass';
                    }
                    return status;
                }, 'skip');
                const Icon = statusIcon(worst);
                const locatable = items.find((check) => check.at && check.sampleIndex !== null);
                return (
                    <li key={group} data-status={worst}>
                        <Icon size={ICON_SIZE.table} strokeWidth={STROKE} aria-hidden />
                        <div>
                            <p>{t(`sim.group.${group}`)}</p>
                            {items.map((check) => (
                                <p key={check.id} className="studio-muted">
                                    {t(`sim.check.${check.id}`)} · {measuredLabel(check)}
                                    {check.source ? ` · ${t(`sim.source.${check.source}`)}` : ''}
                                </p>
                            ))}
                        </div>
                        {locatable && report.samples[locatable.sampleIndex ?? -1] ? (
                            <IconButton
                                label={t('sim.locate')}
                                onClick={() => {
                                    const target = report.samples[locatable.sampleIndex ?? 0];
                                    if (target) {
                                        onLocate(target);
                                    }
                                }}
                            >
                                <MapPin size={ICON_SIZE.button} strokeWidth={STROKE} />
                            </IconButton>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
