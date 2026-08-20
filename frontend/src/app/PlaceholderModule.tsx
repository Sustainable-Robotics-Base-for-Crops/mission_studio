import type { ReactElement, ReactNode } from 'react';

import { type StudioModule } from './modules';
import { translate } from '../i18n/adapter';
import type { MissionRef } from '../map/missions-api';

interface ContextPanelProps {
    module: StudioModule;
    t: (key: string, params?: Record<string, string | number>) => string;
    missions?: MissionRef[];
    activePath?: string | null;
    hasWorkingDocument?: boolean;
    onSelectMission?: (path: string) => void;
    overlay?: boolean;
}

export function ContextPanel({
    module,
    t,
    missions = [],
    activePath,
    hasWorkingDocument = false,
    onSelectMission,
    overlay = false,
}: ContextPanelProps): ReactElement {
    // No module list here: the rail already carries it, and repeating it was the
    // redundancy reported by the product owner (L13 §7.1).
    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('context.title')}
        >
            <header className="studio-panel-header">
                <h2>{t(module.labelKey)}</h2>
            </header>
            <p className="studio-muted">{t(module.descriptionKey)}</p>
            {onSelectMission ? (
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
            ) : null}
        </aside>
    );
}

export function InspectorPanel({
    t,
    message,
    detail,
    children,
    overlay = false,
}: {
    t: (key: string) => string;
    message?: string;
    detail?: string | null;
    children?: ReactNode;
    overlay?: boolean;
}): ReactElement {
    return (
        <aside
            className={overlay ? 'studio-inspector is-overlay' : 'studio-inspector'}
            aria-label={t('inspector.title')}
        >
            <header className="studio-panel-header">
                <h2>{t('inspector.title')}</h2>
            </header>
            <p className="studio-muted">{message ?? t('app.inspectorEmpty')}</p>
            {detail ? <p className="studio-muted">{detail}</p> : null}
            {children}
        </aside>
    );
}

export { SimulationDrawer } from '../simulation/SimulationDrawer';

export function PlaceholderModule({
    module,
    t,
}: {
    module: StudioModule;
    t: typeof translate;
}): ReactElement {
    return (
        <article className="studio-placeholder" data-module={module.id}>
            <h1>{t(module.labelKey)}</h1>
            <p>{t(module.descriptionKey)}</p>
            <p className="studio-muted">{t('module.coming', { lot: module.lot })}</p>
        </article>
    );
}
