import type { FormEvent, ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input, Select } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import type { CoverageStrategy, CoverageVariant } from '../coverage/api';

interface FillParcelDialogProps {
    open: boolean;
    spacing: string;
    strategy: CoverageStrategy;
    spacingSource: string;
    headlandWidth: string;
    connectTurns: boolean;
    variants: CoverageVariant[];
    variantsLoading: boolean;
    onSpacing: (value: string) => void;
    onStrategy: (value: CoverageStrategy) => void;
    onHeadlandWidth: (value: string) => void;
    onConnectTurns: (value: boolean) => void;
    onOpenChange: (open: boolean) => void;
    onConfirm: (spacing: number) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

const STRATEGIES: CoverageStrategy[] = ['boustrophedon', 'perpendicular', 'best_nswath'];

function formatLength(meters: number): string {
    if (!(meters > 0) || !Number.isFinite(meters)) {
        return '—';
    }
    return `${Math.round(meters)} m`;
}

export function FillParcelDialog({
    open,
    spacing,
    strategy,
    spacingSource,
    headlandWidth,
    connectTurns,
    variants,
    variantsLoading,
    onSpacing,
    onStrategy,
    onHeadlandWidth,
    onConnectTurns,
    onOpenChange,
    onConfirm,
    t,
}: FillParcelDialogProps): ReactElement {
    const parsed = Number(spacing);
    const valid = Number.isFinite(parsed) && parsed > 0;
    const headland = Number(headlandWidth);
    const headlandValid =
        headlandWidth.trim() === '' || (Number.isFinite(headland) && headland >= 0);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (valid && headlandValid) {
            onConfirm(parsed);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('tool.fillParcel')}>
            <form className="studio-fill-dialog" onSubmit={submit}>
                <h2 className="studio-fill-dialog-title">{t('tool.fillParcel')}</h2>
                <p className="studio-fill-dialog-hint">{t('tool.fillParcelDialogHint')}</p>
                <Input
                    id="studio-row-spacing"
                    label={t('tool.rowSpacing')}
                    unit="m"
                    source={spacingSource}
                    help={t('tool.rowSpacingHelp')}
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={spacing}
                    onChange={(event) => onSpacing(event.target.value)}
                    error={valid ? undefined : t('tool.invalidSpacing')}
                />
                <Input
                    id="studio-headland-width"
                    label={t('tool.headlandWidth')}
                    unit="m"
                    help={t('tool.headlandWidthHelp')}
                    type="number"
                    step="0.1"
                    min="0"
                    value={headlandWidth}
                    onChange={(event) => onHeadlandWidth(event.target.value)}
                    error={headlandValid ? undefined : t('tool.invalidHeadland')}
                />
                <Select
                    id="studio-coverage-strategy"
                    label={t('tool.coverageStrategy')}
                    value={strategy}
                    onValueChange={(value) => onStrategy(value as CoverageStrategy)}
                    options={STRATEGIES.map((item) => ({
                        value: item,
                        label: t(`tool.coverageStrategy.${item}`),
                    }))}
                    help={t('tool.coverageStrategyHelp')}
                />
                {variantsLoading ? (
                    <p className="studio-fill-dialog-hint">{t('tool.coverageVariantsLoading')}</p>
                ) : variants.length > 0 ? (
                    <div className="studio-variant-list" role="list">
                        {variants.map((item) => {
                            const selected = item.strategy === strategy;
                            return (
                                <button
                                    key={item.strategy}
                                    type="button"
                                    role="listitem"
                                    className={
                                        selected
                                            ? 'studio-variant-card is-selected'
                                            : 'studio-variant-card'
                                    }
                                    onClick={() => onStrategy(item.strategy)}
                                >
                                    <span className="studio-variant-card-title">
                                        {t(`tool.coverageStrategy.${item.strategy}`)}
                                    </span>
                                    <span className="studio-variant-card-meta">
                                        {t('tool.coverageVariantMeta', {
                                            rows: item.swath_count,
                                            length: formatLength(item.length_m),
                                        })}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : null}
                <label className="studio-turns-loop" htmlFor="studio-fill-connect-turns">
                    <input
                        id="studio-fill-connect-turns"
                        type="checkbox"
                        checked={connectTurns}
                        onChange={(event) => onConnectTurns(event.target.checked)}
                    />
                    {t('tool.fillConnectTurns')}
                </label>
                <div className="studio-fill-dialog-actions">
                    <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                        {t('ds.ghost')}
                    </Button>
                    <Button type="submit" variant="primary" disabled={!valid || !headlandValid}>
                        {t('tool.fillParcelConfirm')}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
