import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input, Select } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import {
    CONVERTIBLE_KINDS,
    collectionForPreview,
    type ConvertRequest,
    type LineTarget,
} from './convert';
import { ImportPreviewMap } from './ImportPreviewMap';
import { SMOOTH_RECOMMENDED_PERCENT, smoothToleranceM } from './smooth';
import type { FileImport } from './useFileImport';
import type { ImportAdapter, ImportCandidate, ImportFormat, ImportMetric } from './types';

type Translate = (key: string, params?: Record<string, string | number>) => string;

function formatValue(metric: ImportMetric): string {
    if (metric.value === null) {
        return '—';
    }
    const value = typeof metric.value === 'number' ? String(metric.value) : metric.value;
    return metric.unit ? `${value} ${metric.unit}` : value;
}

function fileStem(name: string): string {
    const base = name.split(/[/\\]/).pop() ?? name;
    const dot = base.lastIndexOf('.');
    return (dot > 0 ? base.slice(0, dot) : base) || base;
}

/** Candidates first, most confident on top; the rest stay reachable for an override. */
function orderedAdapters(
    adapters: ImportAdapter[],
    candidates: ImportCandidate[],
): ImportAdapter[] {
    const rank = new Map(candidates.map((candidate, index) => [candidate.adapter, index]));
    return [...adapters].sort((left, right) => {
        const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.label.localeCompare(right.label);
    });
}

/**
 * Choose the dialect, read what was recognised, then add the file as an overlay.
 *
 * The picker matters because the extension does not identify the formalism: a
 * `.geojson` may be a Naïo work map or a plain collection, a `.zip` may be a
 * Raven job or any shapefile set.
 */
function orderedFormats(
    formats: ImportFormat[],
    adapters: ImportAdapter[],
    candidates: ImportCandidate[],
): ImportFormat[] {
    const rank = new Map<string, number>();
    candidates.forEach((candidate, index) => {
        const formatId = adapters.find((item) => item.id === candidate.adapter)?.format_id;
        if (formatId && !rank.has(formatId)) {
            rank.set(formatId, index);
        }
    });
    return [...formats].sort((left, right) => {
        const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.id.localeCompare(right.id);
    });
}

export function ImportDialog({ t, state }: { t: Translate; state: FileImport }): ReactElement {
    const { preview, error, busy, file, adapters, formats, candidates, adapter, format, intent } =
        state;
    const report = preview?.report ?? null;
    const usingFormats = formats.length > 0;
    const formatOptions = orderedFormats(formats, adapters, candidates).map((entry) => {
        const candidate = candidates.find((item) => {
            const owner = adapters.find((adapterEntry) => adapterEntry.id === item.adapter);
            return owner?.format_id === entry.id;
        });
        return {
            value: entry.id,
            label: t(entry.label_key),
            description: candidate
                ? t(candidate.reason, candidate.params)
                : t('imports.format.manual'),
        };
    });
    const adapterOptions = orderedAdapters(adapters, candidates).map((entry) => {
        const candidate = candidates.find((item) => item.adapter === entry.id);
        return {
            value: entry.id,
            label: entry.label,
            description: candidate
                ? t(candidate.reason, candidate.params)
                : t('imports.format.manual'),
        };
    });
    const options = usingFormats ? formatOptions : adapterOptions;
    const [mode, setMode] = useState<'overlay' | 'convert'>('overlay');
    const [smooth, setSmooth] = useState(SMOOTH_RECOMMENDED_PERCENT);
    const [name, setName] = useState('');
    const [groupId, setGroupId] = useState('');
    const [checked, setChecked] = useState<string[]>([]);
    const [lineTarget, setLineTarget] = useState<LineTarget>('rows');
    const [useEnvelope, setUseEnvelope] = useState(false);
    const groups = report?.groups ?? [];
    const activeGroup = groups.length > 1 ? groupId : (groups[0]?.id ?? null);

    useEffect(() => {
        setMode(intent === 'overlay' ? 'overlay' : 'convert');
        setSmooth(SMOOTH_RECOMMENDED_PERCENT);
        setName(file ? fileStem(file.name) : '');
        setGroupId('');
        setUseEnvelope(false);
        const present = CONVERTIBLE_KINDS.filter((kind) => (report?.kinds[kind] ?? 0) > 0);
        setChecked([...present]);
        const hasRows = (report?.kinds.row ?? 0) > 0;
        const hasGuidance =
            (report?.kinds.guidance_line ?? 0) > 0 || (report?.kinds.track ?? 0) > 0;
        setLineTarget(!hasRows && hasGuidance ? 'guidance' : 'rows');
    }, [preview, intent, file, report]);

    const scopeKinds = useMemo(() => {
        if (!preview) {
            return [];
        }
        const counts = new Map<string, number>();
        for (const feature of preview.collection.features) {
            const marker = feature.properties?.srbc_import;
            const record =
                marker !== null && typeof marker === 'object'
                    ? (marker as Record<string, unknown>)
                    : {};
            if (activeGroup && record.group_id !== activeGroup) {
                continue;
            }
            const kind = typeof record.kind === 'string' ? record.kind : 'landmark';
            if (!CONVERTIBLE_KINDS.includes(kind as (typeof CONVERTIBLE_KINDS)[number])) {
                continue;
            }
            counts.set(kind, (counts.get(kind) ?? 0) + 1);
        }
        return [...counts.entries()];
    }, [activeGroup, preview]);

    const previewCollection = useMemo(() => {
        if (!preview) {
            return null;
        }
        return collectionForPreview(preview.collection, {
            groupId: activeGroup,
            smooth: mode === 'convert' ? smooth : 0,
            kinds: mode === 'convert' ? checked : null,
        });
    }, [activeGroup, checked, mode, preview, smooth]);
    const referenceCollection = useMemo(() => {
        if (!preview || mode !== 'convert' || smooth <= 0) {
            return null;
        }
        return collectionForPreview(preview.collection, {
            groupId: activeGroup,
            smooth: 0,
            kinds: checked,
        });
    }, [activeGroup, checked, mode, preview, smooth]);
    const toleranceCm = Math.round(smoothToleranceM(smooth) * 100);

    const needsName = intent === 'mission' || intent === 'field-create';
    const lineKindsChecked = checked.some((kind) =>
        ['row', 'guidance_line', 'track'].includes(kind),
    );
    const boundaryChecked = checked.includes('boundary');
    const convertBlocker =
        mode !== 'convert'
            ? null
            : checked.length === 0
              ? 'imports.convert.needFamily'
              : groups.length > 1 && !groupId
                ? 'imports.convert.needGroup'
                : intent === 'field-create' && !boundaryChecked && !useEnvelope
                  ? 'imports.convert.needContour'
                  : needsName && !name.trim()
                    ? null
                    : null;
    const nameMissing = mode === 'convert' && needsName && !name.trim();

    const submitConvert = () => {
        if (!preview || convertBlocker || nameMissing) {
            return;
        }
        const request: ConvertRequest = {
            intent: intent === 'overlay' ? 'mission' : intent,
            name: name.trim() || fileStem(file?.name ?? 'import'),
            smooth,
            kinds: checked,
            groupId: activeGroup,
            lineTarget,
            useEnvelope,
            adapter: preview.adapter,
            formatId: preview.format ?? null,
            filename: file?.name ?? preview.source.filename,
        };
        state.confirmConvert(request);
    };

    return (
        <Dialog
            open={state.open}
            onOpenChange={(next) => {
                if (!next) {
                    state.close();
                }
            }}
            title={t('imports.title')}
            className="studio-import-dialog"
        >
            <h2>{t('imports.title')}</h2>
            {file ? (
                <p className="studio-muted">
                    {t('imports.source', {
                        name: file.name,
                        size: Math.max(1, Math.round(file.size / 1024)),
                    })}
                </p>
            ) : null}

            {options.length > 0 ? (
                <Select
                    id="import-adapter"
                    label={t('imports.format')}
                    value={usingFormats ? format : adapter}
                    options={options}
                    onValueChange={usingFormats ? state.chooseFormat : state.chooseAdapter}
                    help={t('imports.format.help')}
                    placeholder={t('imports.format.placeholder')}
                />
            ) : null}

            {busy ? <p className="studio-muted">{t('imports.analysing')}</p> : null}

            {error ? (
                <p className="ds-field-error" role="alert">
                    {t(error.key, error.params)}
                </p>
            ) : null}

            {report ? (
                <div className="studio-import-report">
                    <section aria-labelledby="import-preview-heading">
                        <h3 id="import-preview-heading">{t('imports.preview')}</h3>
                        <ImportPreviewMap
                            t={t}
                            collection={
                                mode === 'overlay'
                                    ? (preview?.collection ?? previewCollection)
                                    : previewCollection
                            }
                            reference={mode === 'overlay' ? null : referenceCollection}
                            fitKey={`${file?.name ?? ''}|${activeGroup ?? ''}|${preview?.adapter ?? ''}|${mode}`}
                        />
                        {mode === 'convert' && (lineKindsChecked || boundaryChecked) ? (
                            <div className="studio-import-smooth">
                                <label htmlFor="import-smooth">
                                    {t('imports.convert.smooth')} — {smooth} %
                                </label>
                                <input
                                    id="import-smooth"
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    value={smooth}
                                    onChange={(event) => setSmooth(Number(event.target.value))}
                                />
                                <p className="studio-muted">
                                    {t('imports.convert.smoothTolerance', { cm: toleranceCm })}
                                </p>
                                <p className="studio-muted">{t('imports.convert.smoothHelp')}</p>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    disabled={smooth === SMOOTH_RECOMMENDED_PERCENT}
                                    onClick={() => setSmooth(SMOOTH_RECOMMENDED_PERCENT)}
                                >
                                    {t('imports.convert.smoothRecommended', {
                                        percent: SMOOTH_RECOMMENDED_PERCENT,
                                        cm: Math.round(
                                            smoothToleranceM(SMOOTH_RECOMMENDED_PERCENT) * 100,
                                        ),
                                    })}
                                </Button>
                            </div>
                        ) : null}
                    </section>

                    <section aria-labelledby="import-summary-heading">
                        <h3 id="import-summary-heading">{t('imports.summary')}</h3>
                        <dl className="studio-import-metrics">
                            {report.metrics.map((metric) => (
                                <div key={metric.key}>
                                    <dt>{t(metric.key)}</dt>
                                    <dd>{formatValue(metric)}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>

                    <section aria-labelledby="import-kinds-heading">
                        <h3 id="import-kinds-heading">{t('imports.kinds')}</h3>
                        <ul className="studio-import-list">
                            {Object.entries(report.kinds).map(([kind, count]) => (
                                <li key={kind}>
                                    {t('imports.kindCount', {
                                        count,
                                        kind: t(`imports.kind.${kind}`),
                                    })}
                                </li>
                            ))}
                        </ul>
                    </section>

                    {report.notices.length > 0 ? (
                        <section aria-labelledby="import-notices-heading">
                            <h3 id="import-notices-heading">{t('imports.notices')}</h3>
                            <ul className="studio-import-list">
                                {report.notices.map((notice) => (
                                    <li key={notice.key}>{t(notice.key, notice.params)}</li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    <section aria-labelledby="import-convert-heading">
                        <h3 id="import-convert-heading">{t('imports.convert.heading')}</h3>
                        <div className="studio-import-modes">
                            <label>
                                <input
                                    type="radio"
                                    name="import-mode"
                                    checked={mode === 'overlay'}
                                    onChange={() => setMode('overlay')}
                                />
                                {t('imports.convert.overlay')}
                            </label>
                            <label>
                                <input
                                    type="radio"
                                    name="import-mode"
                                    checked={mode === 'convert'}
                                    onChange={() => setMode('convert')}
                                />
                                {t('imports.convert.objects')}
                            </label>
                        </div>
                        {mode === 'convert' ? (
                            <div className="studio-import-convert">
                                {(report.kinds.coverage_cell ?? 0) > 0 ? (
                                    <p className="studio-muted">
                                        {t('imports.convert.coverageStays')}
                                    </p>
                                ) : null}
                                <p className="studio-muted">
                                    {t(
                                        intent === 'field-edit'
                                            ? 'imports.convert.editHint'
                                            : intent === 'field-create'
                                              ? 'imports.convert.fieldHint'
                                              : 'imports.convert.missionHint',
                                    )}
                                </p>
                                {groups.length > 1 ? (
                                    <Select
                                        id="import-group"
                                        label={t('imports.convert.group')}
                                        value={groupId}
                                        options={groups.map((group) => ({
                                            value: group.id,
                                            label: group.name,
                                            description: t('imports.kindCount', {
                                                count: group.feature_count,
                                                kind: t('imports.convert.group'),
                                            }),
                                        }))}
                                        onValueChange={setGroupId}
                                        help={t('imports.convert.groupHelp')}
                                        placeholder={t('imports.convert.group')}
                                    />
                                ) : null}
                                <fieldset className="studio-import-families">
                                    <legend>{t('imports.convert.family')}</legend>
                                    {scopeKinds.map(([kind, count]) => (
                                        <label key={kind}>
                                            <input
                                                type="checkbox"
                                                checked={checked.includes(kind)}
                                                onChange={(event) => {
                                                    setChecked((current) =>
                                                        event.target.checked
                                                            ? [...current, kind]
                                                            : current.filter(
                                                                  (item) => item !== kind,
                                                              ),
                                                    );
                                                }}
                                            />
                                            {t('imports.kindCount', {
                                                count,
                                                kind: t(`imports.kind.${kind}`),
                                            })}
                                        </label>
                                    ))}
                                </fieldset>
                                {(intent === 'field-create' || intent === 'field-edit') &&
                                lineKindsChecked ? (
                                    <Select
                                        id="import-line-target"
                                        label={t('imports.convert.lineTarget')}
                                        value={lineTarget}
                                        options={[
                                            {
                                                value: 'rows',
                                                label: t('imports.convert.target.rows'),
                                            },
                                            {
                                                value: 'beds',
                                                label: t('imports.convert.target.beds'),
                                            },
                                            {
                                                value: 'guidance',
                                                label: t('imports.convert.target.guidance'),
                                            },
                                        ]}
                                        onValueChange={(value) =>
                                            setLineTarget(
                                                value === 'beds' || value === 'guidance'
                                                    ? value
                                                    : 'rows',
                                            )
                                        }
                                    />
                                ) : null}
                                {intent === 'field-create' && !boundaryChecked ? (
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={useEnvelope}
                                            onChange={(event) =>
                                                setUseEnvelope(event.target.checked)
                                            }
                                        />
                                        {t('imports.convert.envelope')}
                                    </label>
                                ) : null}
                                {needsName ? (
                                    <Input
                                        id="import-object-name"
                                        label={t('imports.convert.name')}
                                        value={name}
                                        onChange={(event) => setName(event.target.value)}
                                    />
                                ) : null}
                                {convertBlocker ? (
                                    <p className="studio-muted">{t(convertBlocker)}</p>
                                ) : null}
                            </div>
                        ) : null}
                    </section>
                </div>
            ) : null}

            <div className="studio-publish-actions">
                <Button type="button" variant="secondary" onClick={state.close}>
                    {t('pub.cancel')}
                </Button>
                <Button
                    type="button"
                    variant="primary"
                    disabled={
                        !report ||
                        busy ||
                        (mode === 'convert' && (Boolean(convertBlocker) || nameMissing))
                    }
                    onClick={mode === 'convert' ? submitConvert : state.confirm}
                >
                    {mode === 'overlay'
                        ? t('imports.confirm')
                        : t(
                              intent === 'field-edit'
                                  ? 'imports.convert.confirm.edit'
                                  : intent === 'field-create'
                                    ? 'imports.convert.confirm.field'
                                    : 'imports.convert.confirm.mission',
                          )}
                </Button>
            </div>
        </Dialog>
    );
}
