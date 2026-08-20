import { useEffect, useState, type ReactElement } from 'react';

import { fetchFarmAvailable, fetchFarmMissionsForField, type FarmEntry } from '../app/farm-api';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function partitionFieldMissions(entries: FarmEntry[]): {
    generated: FarmEntry[];
    work: FarmEntry[];
} {
    const kindOf = (entry: FarmEntry) =>
        entry.kind ?? entry.path.split(/[\\/]/).filter(Boolean)[0] ?? '';
    return {
        generated: entries.filter((entry) => kindOf(entry) === 'mission_order'),
        work: entries.filter((entry) => kindOf(entry) === 'work_performed'),
    };
}

function displayName(entry: FarmEntry): string {
    return entry.name.replace(/\.json$/i, '');
}

function displayDate(entry: FarmEntry, language: string): string {
    const namedDate = /^(\d{4}-\d{2}-\d{2})/.exec(entry.name)?.[1];
    if (namedDate) {
        return namedDate;
    }
    return new Date(entry.modified).toLocaleDateString(language);
}

function MissionList({
    entries,
    empty,
    showSimulation,
    language,
    t,
    onOpenMission,
}: {
    entries: FarmEntry[];
    empty: string;
    showSimulation: boolean;
    language: string;
    t: Translate;
    onOpenMission?: (path?: string) => void;
}): ReactElement {
    if (entries.length === 0) {
        return <p className="studio-muted">{empty}</p>;
    }
    return (
        <ul className="studio-field-missions">
            {entries.map((entry) => (
                <li key={entry.path}>
                    <button
                        type="button"
                        disabled={entry.unreadable || !onOpenMission}
                        onClick={() => onOpenMission?.(entry.path)}
                    >
                        <span>{displayName(entry)}</span>
                        <span className="studio-muted">{displayDate(entry, language)}</span>
                        {showSimulation ? (
                            <span
                                className={
                                    entry.simulated
                                        ? 'studio-mission-state is-simulated'
                                        : 'studio-mission-state'
                                }
                            >
                                {entry.simulated
                                    ? t('mission.load.simulated')
                                    : t('mission.load.notSimulated')}
                            </span>
                        ) : null}
                    </button>
                </li>
            ))}
        </ul>
    );
}

export function FieldMissionsTab({
    t,
    language,
    fieldId,
    onOpenMission,
}: {
    t: Translate;
    language: string;
    fieldId: string | null;
    onOpenMission?: (path?: string) => void;
}): ReactElement {
    const [status, setStatus] = useState<'loading' | 'unavailable' | 'noFarm' | 'ready'>('loading');
    const [entries, setEntries] = useState<FarmEntry[]>([]);

    useEffect(() => {
        let cancelled = false;
        if (!fieldId) {
            setEntries([]);
            setStatus('ready');
            return;
        }
        setStatus('loading');
        void (async () => {
            const available = await fetchFarmAvailable();
            if (!available) {
                if (!cancelled) {
                    setEntries([]);
                    setStatus('unavailable');
                }
                return;
            }
            try {
                const next = await fetchFarmMissionsForField(fieldId);
                if (!cancelled) {
                    setEntries(next);
                    setStatus('ready');
                }
            } catch (cause: unknown) {
                if (cancelled) {
                    return;
                }
                const message = cause instanceof Error ? cause.message : '';
                setEntries([]);
                setStatus(message.includes('no farm') ? 'noFarm' : 'unavailable');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [fieldId]);

    if (!fieldId) {
        return <p className="studio-muted">{t('fields.missions.needField')}</p>;
    }
    if (status === 'loading') {
        return <p className="studio-muted">{t('fields.missions.loading')}</p>;
    }
    if (status === 'unavailable') {
        return <p className="studio-muted">{t('fields.missions.unavailable')}</p>;
    }
    if (status === 'noFarm') {
        return <p className="studio-muted">{t('fields.missions.noFarm')}</p>;
    }

    const { generated, work } = partitionFieldMissions(entries);
    return (
        <div className="studio-field-tab">
            <section aria-label={t('fields.missions.generated')}>
                <h3>{t('fields.missions.generated')}</h3>
                <MissionList
                    entries={generated}
                    empty={t('fields.missions.generatedEmpty')}
                    showSimulation
                    language={language}
                    t={t}
                    onOpenMission={onOpenMission}
                />
            </section>
            <section aria-label={t('fields.missions.work')}>
                <h3>{t('fields.missions.work')}</h3>
                <MissionList
                    entries={work}
                    empty={t('fields.missions.workEmpty')}
                    showSimulation={false}
                    language={language}
                    t={t}
                    onOpenMission={onOpenMission}
                />
            </section>
        </div>
    );
}
