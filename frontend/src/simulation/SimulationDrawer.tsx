import {
    CircleCheck,
    CircleMinus,
    CirclePlay,
    MapPin,
    Pause,
    TriangleAlert,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Button, IconButton } from '../design-system/Button';
import { Banner } from '../design-system/Feedback';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { formatDurationCompact } from '../missions/tree';
import {
    CHECK_GROUPS,
    playbackIndexAtTime,
    type CheckStatus,
    type PoseSample,
    type SimulationCheck,
    type SimulationReport,
} from '../domain/simulation';

const RATES = [1, 2, 5, 10, 20] as const;

interface SimulationDrawerProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    report: SimulationReport | null;
    stale: boolean;
    seekIndex?: number | null;
    onRun?: () => void;
    onCursor: (sample: PoseSample | null) => void;
    onLocate: (sample: PoseSample) => void;
}

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

export function SimulationDrawer({
    t,
    report,
    stale,
    seekIndex = null,
    onRun,
    onCursor,
    onLocate,
}: SimulationDrawerProps): ReactElement {
    const [index, setIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState<(typeof RATES)[number]>(1);
    const indexRef = useRef(0);
    indexRef.current = index;

    useEffect(() => {
        setIndex(0);
        setPlaying(false);
    }, [report]);

    useEffect(() => {
        if (seekIndex === null || !report || report.samples.length === 0) {
            return;
        }
        setIndex(Math.min(Math.max(seekIndex, 0), report.samples.length - 1));
        setPlaying(false);
    }, [seekIndex, report]);

    const sample = report?.samples[index] ?? null;
    useEffect(() => {
        onCursor(sample);
    }, [onCursor, sample]);

    useEffect(() => {
        if (!playing || !report || report.samples.length < 2) {
            return;
        }
        const endT = report.samples[report.samples.length - 1]?.t ?? 0;
        let elapsed = report.samples[indexRef.current]?.t ?? 0;
        let last = performance.now();
        let frame = 0;
        const tick = (now: number) => {
            elapsed += ((now - last) / 1000) * rate;
            last = now;
            if (elapsed >= endT) {
                setIndex(report.samples.length - 1);
                setPlaying(false);
                return;
            }
            setIndex(playbackIndexAtTime(report.samples, elapsed));
            frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frame);
    }, [playing, rate, report]);

    const maxIndex = Math.max((report?.samples.length ?? 1) - 1, 0);

    return (
        <section className="studio-simulation" aria-label={t('simulation.title')}>
            <header className="studio-panel-header">
                <h2>{t('simulation.title')}</h2>
            </header>
            {stale && report ? (
                <Banner tone="warning" icon={TriangleAlert}>
                    {t('sim.stale')}
                </Banner>
            ) : null}
            {!report ? (
                <div className="studio-sim-empty">
                    <p className="studio-muted">{t('sim.needRun')}</p>
                    {onRun ? (
                        <Button variant="primary" onClick={onRun}>
                            {t('app.simulate')}
                        </Button>
                    ) : null}
                </div>
            ) : (
                <>
                    <p className="studio-sim-summary">
                        {t('sim.summary', {
                            pass: report.passCount,
                            warn: report.warnCount,
                            block: report.blockCount,
                            length: Math.round(report.length_m),
                            duration: formatDurationCompact(report.duration_s),
                        })}
                    </p>
                    <p className="studio-muted">{t('sim.footprintHint')}</p>
                    {report.blockCount > 0 ? (
                        <p className="studio-sim-blocked">{t('sim.publishBlocked')}</p>
                    ) : null}
                    <div
                        className="studio-sim-timeline"
                        role="group"
                        aria-label={t('sim.timeline')}
                    >
                        <IconButton
                            label={playing ? t('sim.pause') : t('sim.play')}
                            onClick={() => setPlaying((value) => !value)}
                            disabled={report.samples.length < 2}
                        >
                            {playing ? (
                                <Pause size={ICON_SIZE.button} strokeWidth={STROKE} />
                            ) : (
                                <CirclePlay size={ICON_SIZE.button} strokeWidth={STROKE} />
                            )}
                        </IconButton>
                        <input
                            type="range"
                            min={0}
                            max={maxIndex}
                            value={index}
                            aria-label={t('sim.cursor')}
                            onChange={(event) => {
                                setPlaying(false);
                                setIndex(Number(event.target.value));
                            }}
                        />
                        <span className="studio-muted">
                            {formatDurationCompact(sample?.t ?? 0)} /{' '}
                            {formatDurationCompact(report.duration_s)}
                        </span>
                        {RATES.map((item) => (
                            <Button
                                key={item}
                                variant={item === rate ? 'primary' : 'secondary'}
                                onClick={() => setRate(item)}
                            >
                                {item}×
                            </Button>
                        ))}
                    </div>
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
                            const locatable = items.find(
                                (check) => check.at && check.sampleIndex !== null,
                            );
                            return (
                                <li key={group} data-status={worst}>
                                    <Icon size={ICON_SIZE.table} strokeWidth={STROKE} aria-hidden />
                                    <div>
                                        <p>{t(`sim.group.${group}`)}</p>
                                        {items.map((check) => (
                                            <p key={check.id} className="studio-muted">
                                                {t(`sim.check.${check.id}`)} ·{' '}
                                                {measuredLabel(check)}
                                                {check.source
                                                    ? ` · ${t(`sim.source.${check.source}`)}`
                                                    : ''}
                                            </p>
                                        ))}
                                    </div>
                                    {locatable && report.samples[locatable.sampleIndex ?? -1] ? (
                                        <IconButton
                                            label={t('sim.locate')}
                                            onClick={() => {
                                                const target =
                                                    report.samples[locatable.sampleIndex ?? 0];
                                                if (target) {
                                                    setIndex(locatable.sampleIndex ?? 0);
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
                </>
            )}
        </section>
    );
}
