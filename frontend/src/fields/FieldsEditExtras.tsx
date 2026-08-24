import { useEffect, useState, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input } from '../design-system/Field';
import { Tooltip } from '../design-system/Overlay';
import { DEFAULT_ROW_SPACING_M } from '../domain/coverage';
import { DEFAULT_BED_COUNT, DEFAULT_BED_PATH_M, DEFAULT_BED_WIDTH_M } from './rows';
import type { useFieldCatalogue } from './useFieldCatalogue';

type Catalogue = ReturnType<typeof useFieldCatalogue>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Fill a whole field with rows or beds from an existing A/B line — the bulk
 * counterpart of drawing one line and duplicating it from the right panel.
 */
export function FieldRowsGenerator({
    t,
    catalogue,
}: {
    t: Translate;
    catalogue: Catalogue;
}): ReactElement {
    const lines = catalogue.selected?.guidance_lines ?? [];
    const [axisLineId, setAxisLineId] = useState('');
    const [layoutKind, setLayoutKind] = useState<'rows' | 'beds'>('rows');
    const [spacingM, setSpacingM] = useState(String(DEFAULT_ROW_SPACING_M));
    const [bedWidthM, setBedWidthM] = useState(String(DEFAULT_BED_WIDTH_M));
    const [bedPathM, setBedPathM] = useState(String(DEFAULT_BED_PATH_M));
    const [bedCount, setBedCount] = useState(String(DEFAULT_BED_COUNT));
    useEffect(() => {
        const first = catalogue.selected?.guidance_lines[0]?.id ?? '';
        setAxisLineId((current) =>
            catalogue.selected?.guidance_lines.some((line) => line.id === current)
                ? current
                : first,
        );
    }, [catalogue.selected?.guidance_lines, catalogue.selectedId]);

    return (
        <section className="studio-field-create" aria-labelledby="fields-rows-heading">
            <h3 id="fields-rows-heading">{t('fields.nav.rows')}</h3>
            {!catalogue.selectedId ? (
                <p className="studio-muted">{t('fields.error.needField')}</p>
            ) : lines.length === 0 ? (
                <p className="studio-muted">{t('fields.emptyRowsNeedAxis')}</p>
            ) : (
                <>
                    <label className="studio-file-label">
                        <span>{t('fields.layoutKind')}</span>
                        <select
                            className="ds-select-trigger"
                            value={layoutKind}
                            onChange={(event) =>
                                setLayoutKind(event.target.value === 'beds' ? 'beds' : 'rows')
                            }
                        >
                            <option value="rows">{t('fields.layoutRows')}</option>
                            <option value="beds">{t('fields.layoutBeds')}</option>
                        </select>
                    </label>
                    <label className="studio-file-label">
                        <span>{t('fields.axisLine')}</span>
                        <select
                            className="ds-select-trigger"
                            value={axisLineId}
                            onChange={(event) => setAxisLineId(event.target.value)}
                        >
                            {lines.map((line) => (
                                <option key={line.id} value={line.id}>
                                    {line.name?.trim() || t('fields.typeGuidance')}
                                </option>
                            ))}
                        </select>
                    </label>
                    {layoutKind === 'rows' ? (
                        <Input
                            id="studio-row-spacing"
                            label={t('fields.spacing')}
                            unit="m"
                            value={spacingM}
                            onChange={(event) => setSpacingM(event.target.value)}
                        />
                    ) : (
                        <>
                            <Input
                                id="studio-bed-width"
                                label={t('fields.bedWidth')}
                                unit="m"
                                value={bedWidthM}
                                onChange={(event) => setBedWidthM(event.target.value)}
                            />
                            <Input
                                id="studio-bed-path"
                                label={t('fields.bedPath')}
                                unit="m"
                                value={bedPathM}
                                onChange={(event) => setBedPathM(event.target.value)}
                            />
                            <Input
                                id="studio-bed-count"
                                label={t('fields.bedCount')}
                                value={bedCount}
                                onChange={(event) => setBedCount(event.target.value)}
                            />
                        </>
                    )}
                    <Button
                        variant="secondary"
                        disabled={!axisLineId}
                        onClick={() => {
                            if (layoutKind === 'beds') {
                                const width = Number(bedWidthM);
                                const path = Number(bedPathM);
                                const count = Number(bedCount);
                                void catalogue.generateRowSet({
                                    axisLineId,
                                    kind: 'beds',
                                    widthM: Number.isFinite(width) ? width : DEFAULT_BED_WIDTH_M,
                                    pathM: Number.isFinite(path) ? path : DEFAULT_BED_PATH_M,
                                    count:
                                        Number.isFinite(count) && count > 0
                                            ? Math.floor(count)
                                            : undefined,
                                });
                                return;
                            }
                            const spacing = Number(spacingM);
                            void catalogue.generateRowSet({
                                axisLineId,
                                kind: 'rows',
                                spacingM: Number.isFinite(spacing)
                                    ? spacing
                                    : DEFAULT_ROW_SPACING_M,
                            });
                        }}
                    >
                        {layoutKind === 'beds'
                            ? t('fields.generateBeds')
                            : t('fields.generateRows')}
                    </Button>
                </>
            )}
        </section>
    );
}

export function FieldsImportExport({
    t,
    catalogue,
}: {
    t: Translate;
    catalogue: Catalogue;
}): ReactElement {
    return (
        <section className="studio-field-create" aria-labelledby="fields-io-heading">
            <h3 id="fields-io-heading">{t('fields.nav.io')}</h3>
            <Tooltip content={t('fields.importFile.comingSoon')}>
                <span className="studio-mission-create-coming">
                    <Button type="button" variant="secondary" disabled>
                        {t('fields.importFile')}
                    </Button>
                </span>
            </Tooltip>
            <Button
                variant="secondary"
                disabled={!catalogue.selectedId}
                onClick={() => void catalogue.exportSelected()}
            >
                {t('fields.exportGeojson')}
            </Button>
        </section>
    );
}
