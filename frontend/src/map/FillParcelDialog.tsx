import type { FormEvent, ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input, Select } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import type { CoverageStrategy, CoverageVariant } from '../coverage/api';

export interface FillGuidanceOption {
    id: string;
    label: string;
}

interface FillParcelDialogProps {
    open: boolean;
    spacing: string;
    strategy: CoverageStrategy;
    spacingSource: string;
    headlandWidth: string;
    connectTurns: boolean;
    variants: CoverageVariant[];
    variantsLoading: boolean;
    guidanceLines?: FillGuidanceOption[];
    guidanceLineId?: string | null;
    onSpacing: (value: string) => void;
    onStrategy: (value: CoverageStrategy) => void;
    onGuidanceLine?: (id: string) => void;
    onHeadlandWidth: (value: string) => void;
    onConnectTurns: (value: boolean) => void;
    onOpenChange: (open: boolean) => void;
    onConfirm: (spacing: number) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

const BASE_STRATEGIES: CoverageStrategy[] = ['boustrophedon', 'perpendicular', 'best_nswath'];

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
    guidanceLines = [],
    guidanceLineId = null,
    onSpacing,
    onStrategy,
    onGuidanceLine,
    onHeadlandWidth,
    onConnectTurns,
    onOpenChange,
    onConfirm,
    t,
}: FillParcelDialogProps): ReactElement {
    const parsed = Number(spacing);
    const strategies: CoverageStrategy[] =
        guidanceLines.length > 0 ? [...BASE_STRATEGIES, 'guidance'] : BASE_STRATEGIES;
    const guidanceReady = strategy !== 'guidance' || Boolean(guidanceLineId);
    const valid = Number.isFinite(parsed) && parsed > 0 && guidanceReady;
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
                    options={strategies.map((item) => {
                        const variant = variants.find((entry) => entry.strategy === item);
                        return {
                            value: item,
                            label: t(`tool.coverageStrategy.${item}`),
                            description:
                                variant && !variantsLoading
                                    ? t('tool.coverageVariantMeta', {
                                          rows: variant.swath_count,
                                          length: formatLength(variant.length_m),
                                      })
                                    : undefined,
                        };
                    })}
                    help={
                        guidanceLines.length > 0
                            ? t('tool.coverageStrategyHelpWithGuidance')
                            : t('tool.coverageStrategyHelp')
                    }
                />
                {guidanceLines.length > 0 && strategy === 'guidance' ? (
                    guidanceLines.length === 1 ? (
                        <p className="studio-fill-dialog-hint">
                            {t('tool.coverageGuidanceLineOne', {
                                name: guidanceLines[0]?.label ?? '',
                            })}
                        </p>
                    ) : (
                        <Select
                            id="studio-coverage-guidance-line"
                            label={t('tool.coverageGuidanceLine')}
                            value={guidanceLineId ?? guidanceLines[0]?.id ?? ''}
                            onValueChange={(value) => onGuidanceLine?.(value)}
                            options={guidanceLines.map((item) => ({
                                value: item.id,
                                label: item.label,
                            }))}
                            help={t('tool.coverageGuidanceLineHelp')}
                        />
                    )
                ) : null}
                {variantsLoading ? (
                    <p className="studio-fill-dialog-hint">{t('tool.coverageVariantsLoading')}</p>
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

export function FillGeofencePrompt({
    open,
    onOpenChange,
    onYes,
    onNo,
    t,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onYes: () => void;
    onNo: () => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}): ReactElement {
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('tool.fillUseGeofence')}>
            <div className="studio-fill-dialog">
                <h2 className="studio-fill-dialog-title">{t('tool.fillUseGeofence')}</h2>
                <p className="studio-fill-dialog-hint">{t('tool.fillUseGeofenceHint')}</p>
                <div className="studio-fill-dialog-actions">
                    <Button type="button" variant="secondary" onClick={onNo}>
                        {t('tool.fillUseGeofenceNo')}
                    </Button>
                    <Button type="button" variant="primary" onClick={onYes}>
                        {t('tool.fillUseGeofenceYes')}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}
