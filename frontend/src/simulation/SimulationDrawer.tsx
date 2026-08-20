import { CirclePlay, Pause, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Button, IconButton } from '../design-system/Button';
import { Banner } from '../design-system/Feedback';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { formatDurationCompact } from '../missions/tree';
import { playbackIndexAtTime, type PoseSample, type SimulationReport } from '../domain/simulation';

const RATES = [1, 2, 5, 10, 20] as const;

interface SimulationDrawerProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    report: SimulationReport | null;
    stale: boolean;
    seekIndex?: number | null;
    onRun?: () => void;
    onCursor: (sample: PoseSample | null) => void;
    onLocate: (sample: PoseSample) => void;
    onOpenResults?: () => void;
}

export function SimulationDrawer({
    t,
    report,
    stale,
    seekIndex = null,
    onRun,
    onCursor,
    onOpenResults,
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
                    {onOpenResults ? (
                        <button
                            type="button"
                            className="studio-sim-all-checks"
                            onClick={onOpenResults}
                        >
                            {t('sim.allChecks')}
                        </button>
                    ) : null}
                </>
            )}
        </section>
    );
}
