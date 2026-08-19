import type { FormEvent, ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input, Select } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import {
    DEFAULT_CONNECT_TURNS,
    type ConnectTurnsParams,
    type TurnKind,
    type TurnOrderType,
} from '../domain/turns';

interface ConnectTurnsDialogProps {
    open: boolean;
    params: ConnectTurnsParams;
    onParams: (value: ConnectTurnsParams) => void;
    onOpenChange: (open: boolean) => void;
    onConfirm: (params: ConnectTurnsParams) => void;
    t: (key: string, vars?: Record<string, string | number>) => string;
}

function positive(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

export function ConnectTurnsDialog({
    open,
    params,
    onParams,
    onOpenChange,
    onConfirm,
    t,
}: ConnectTurnsDialogProps): ReactElement {
    const valid =
        positive(params.rowSpeed) &&
        positive(params.spaceIn) &&
        positive(params.spaceOut) &&
        positive(params.headlandSpace) &&
        params.skipRows >= 0 &&
        params.corkscrewJump >= 1;
    const patch = (partial: Partial<ConnectTurnsParams>) => onParams({ ...params, ...partial });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (valid) {
            onConfirm({ ...params, densifyRows: false });
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('tool.connectTurns')}>
            <form className="studio-fill-dialog studio-turns-dialog" onSubmit={submit}>
                <h2 className="studio-fill-dialog-title">{t('tool.connectTurns')}</h2>
                <p className="studio-fill-dialog-hint">{t('tool.connectTurnsHint')}</p>
                <Select
                    id="studio-turn-type"
                    label={t('tool.turnType')}
                    value={params.turnType}
                    onValueChange={(value) => patch({ turnType: value as TurnKind })}
                    options={[
                        { value: 'square', label: t('tool.turnTypeSquare') },
                        { value: 'u_turn', label: t('tool.turnTypeUTurn') },
                    ]}
                />
                <Input
                    id="studio-turn-speed"
                    label={t('tool.rowSpeed')}
                    unit="m/s"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={String(params.rowSpeed)}
                    onChange={(event) => patch({ rowSpeed: Number(event.target.value) })}
                />
                <Input
                    id="studio-space-in"
                    label={t('tool.spaceIn')}
                    unit="m"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={String(params.spaceIn)}
                    onChange={(event) => patch({ spaceIn: Number(event.target.value) })}
                />
                <Input
                    id="studio-space-out"
                    label={t('tool.spaceOut')}
                    unit="m"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={String(params.spaceOut)}
                    onChange={(event) => patch({ spaceOut: Number(event.target.value) })}
                />
                <Input
                    id="studio-headland"
                    label={t('tool.headlandSpace')}
                    unit="m"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={String(params.headlandSpace)}
                    onChange={(event) => patch({ headlandSpace: Number(event.target.value) })}
                />
                <div className="studio-turns-toggles">
                    <Button
                        type="button"
                        variant="secondary"
                        aria-pressed={params.reverseRows}
                        className={params.reverseRows ? 'is-active' : undefined}
                        onClick={() => patch({ reverseRows: !params.reverseRows })}
                    >
                        {t('tool.reverseRows')}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        aria-pressed={params.reverseSide}
                        className={params.reverseSide ? 'is-active' : undefined}
                        onClick={() => patch({ reverseSide: !params.reverseSide })}
                    >
                        {t('tool.reverseSide')}
                    </Button>
                </div>
                <Input
                    id="studio-skip-rows"
                    label={t('tool.skipRows')}
                    type="number"
                    step="1"
                    min="0"
                    value={String(params.skipRows)}
                    onChange={(event) =>
                        patch({
                            skipRows: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                        })
                    }
                />
                <Select
                    id="studio-order-type"
                    label={t('tool.orderType')}
                    value={params.orderType}
                    onValueChange={(value) => patch({ orderType: value as TurnOrderType })}
                    options={[
                        { value: 'normal', label: t('tool.orderNormal') },
                        { value: 'snake', label: t('tool.orderSnake') },
                        { value: 'corkscrew', label: t('tool.orderCorkscrew') },
                    ]}
                />
                {params.orderType === 'corkscrew' ? (
                    <Input
                        id="studio-corkscrew-jump"
                        label={t('tool.corkscrewJump')}
                        type="number"
                        step="1"
                        min="1"
                        value={String(params.corkscrewJump)}
                        onChange={(event) =>
                            patch({
                                corkscrewJump: Math.max(
                                    1,
                                    Math.floor(
                                        Number(event.target.value) ||
                                            DEFAULT_CONNECT_TURNS.corkscrewJump,
                                    ),
                                ),
                            })
                        }
                    />
                ) : null}
                <label className="studio-turns-loop" htmlFor="studio-turns-loop">
                    <input
                        id="studio-turns-loop"
                        type="checkbox"
                        checked={params.loop}
                        onChange={(event) => patch({ loop: event.target.checked })}
                    />
                    {t('tool.connectTurnsLoop')}
                </label>
                <div className="studio-fill-dialog-actions">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        {t('ds.ghost')}
                    </Button>
                    <Button type="submit" variant="primary" disabled={!valid}>
                        {t('tool.connectTurnsConfirm')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
