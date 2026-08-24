import type { ReactElement, ReactNode } from 'react';

import { Button } from '../design-system/Button';
import { Tabs } from '../design-system/Disclosure';
import { Input } from '../design-system/Field';

export type ZonePanelMode = 'choose' | 'entities' | 'portions';

interface ZoneActionPanelProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    mode: ZonePanelMode;
    locked?: boolean;
    workingZoneOn: boolean;
    speedDraft: string;
    entityTools?: ReactNode;
    onMode: (mode: Exclude<ZonePanelMode, 'choose'>) => void;
    onCut: () => void;
    onWorkingZone: (value: 0 | 1) => void;
    onSpeedDraft: (value: string) => void;
    onApplySpeed: () => void;
    onConnectTurns: () => void;
    onReverse: () => void;
    onDelete: () => void;
}

export function EntitySelectionActions({
    t,
    locked = false,
    showConnect = true,
    onConnectTurns,
    onReverse,
    onDelete,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    locked?: boolean;
    showConnect?: boolean;
    onConnectTurns?: () => void;
    onReverse: () => void;
    onDelete: () => void;
}): ReactElement {
    return (
        <>
            {showConnect && onConnectTurns ? (
                <Button
                    type="button"
                    variant="secondary"
                    disabled={locked}
                    onClick={onConnectTurns}
                >
                    {t('tool.connectTurns')}
                </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={locked} onClick={onReverse}>
                {t('tool.reverseSelected')}
            </Button>
            <Button
                type="button"
                variant="destructive"
                disabled={locked}
                confirmLabel={t('zone.deleteEntitiesConfirm')}
                onClick={onDelete}
            >
                {t('zone.deleteEntities')}
            </Button>
        </>
    );
}

export function ZoneActionPanel({
    t,
    mode,
    locked = false,
    workingZoneOn,
    speedDraft,
    entityTools,
    onMode,
    onCut,
    onWorkingZone,
    onSpeedDraft,
    onApplySpeed,
    onConnectTurns,
    onReverse,
    onDelete,
}: ZoneActionPanelProps): ReactElement {
    return (
        <section className="studio-zone-panel" aria-label={t('zone.panel')}>
            {mode === 'choose' ? <p className="studio-muted">{t('zone.chooseHint')}</p> : null}
            <Tabs
                defaultValue="entities"
                value={mode === 'choose' ? 'choose' : mode}
                onValueChange={(value) => {
                    if (value === 'entities' || value === 'portions') {
                        onMode(value);
                    }
                }}
                items={[
                    {
                        value: 'entities',
                        label: t('zone.mode.entities'),
                        content: (
                            <div className="studio-inspector-block">
                                <p className="studio-muted">{t('zone.entitiesHint')}</p>
                                <EntitySelectionActions
                                    t={t}
                                    locked={locked}
                                    onConnectTurns={onConnectTurns}
                                    onReverse={onReverse}
                                    onDelete={onDelete}
                                />
                                {entityTools}
                            </div>
                        ),
                    },
                    {
                        value: 'portions',
                        label: t('zone.mode.portions'),
                        content: (
                            <div className="studio-inspector-block studio-zone-portions">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={locked}
                                    onClick={onCut}
                                >
                                    {t('zone.cut')}
                                </Button>
                                <label className="studio-zone-toggle">
                                    <input
                                        type="checkbox"
                                        checked={workingZoneOn}
                                        disabled={locked}
                                        onChange={(event) =>
                                            onWorkingZone(event.target.checked ? 1 : 0)
                                        }
                                    />
                                    <span>{t('zone.working')}</span>
                                </label>
                                <Input
                                    id="zone-portion-speed"
                                    type="number"
                                    min={0}
                                    max={50}
                                    step={0.1}
                                    unit="m/s"
                                    label={t('zone.speed')}
                                    value={speedDraft}
                                    disabled={locked}
                                    onChange={(event) => onSpeedDraft(event.target.value)}
                                />
                                <Button
                                    type="button"
                                    variant="primary"
                                    disabled={locked || !speedDraft.trim()}
                                    onClick={onApplySpeed}
                                >
                                    {t('zone.speed.apply')}
                                </Button>
                            </div>
                        ),
                    },
                ]}
            />
        </section>
    );
}
