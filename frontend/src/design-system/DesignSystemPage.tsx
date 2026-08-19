import { useState, type ReactElement } from 'react';
import { Layers, OctagonAlert, Redo2, TriangleAlert, Undo2 } from 'lucide-react';

import { Accordion, Tabs } from './Disclosure';
import { Banner, Chip } from './Feedback';
import { Button, IconButton } from './Button';
import { Input, Select } from './Field';
import { ICON_BY_FUNCTION, ICON_SIZE, STROKE } from './icons';
import { Popover, Toast } from './Overlay';
import { COLOR, CONTROL, LUCIDE_PINNED_VERSION, TYPE } from './tokens';
import { useI18n } from '../i18n/useI18n';

const SWATCHES: { token: string; hex: string }[] = [
    { token: '--bg-app', hex: COLOR.bgApp },
    { token: '--surface', hex: COLOR.surface },
    { token: '--primary-700', hex: COLOR.primary700 },
    { token: '--focus', hex: COLOR.focus },
    { token: '--color-planned', hex: COLOR.planned },
    { token: '--color-selected', hex: COLOR.selected },
    { token: '--color-valid', hex: COLOR.valid },
    { token: '--color-warning', hex: COLOR.warning },
    { token: '--color-danger', hex: COLOR.danger },
    { token: '--color-autonomy', hex: COLOR.autonomy },
];

export const DESIGN_SYSTEM_PATH = '/design-system';

export function DesignSystemPage(): ReactElement {
    const { t } = useI18n();
    const [selectValue, setSelectValue] = useState('srbc');
    const [toastOpen, setToastOpen] = useState(false);
    const [inputValue, setInputValue] = useState('2.4');

    return (
        <article className="ds-page" data-ds-lot="L2" data-page="design-system">
            <h1>{t('ds.title')}</h1>
            <p>{t('ds.subtitle')}</p>
            <p className="studio-muted">{t('ds.legacyNote')}</p>

            <h2>{t('ds.tokens')}</h2>
            <div className="ds-row">
                {SWATCHES.map((swatch) => (
                    <div key={swatch.token} className="ds-swatch">
                        <i style={{ background: swatch.hex }} aria-hidden="true" />
                        <span>{swatch.token}</span>
                        <span>{swatch.hex}</span>
                    </div>
                ))}
            </div>
            <p className="ds-nums">
                Inter Variable · Lucide {LUCIDE_PINNED_VERSION} · tooltip {CONTROL.tooltipDelayMs}{' '}
                ms · toast {CONTROL.toastMs} ms
            </p>

            <h2>{t('ds.typography')}</h2>
            <p
                style={{
                    fontSize: TYPE.h1.size,
                    lineHeight: `${TYPE.h1.line}px`,
                    fontWeight: TYPE.h1.weight,
                }}
            >
                H1 24/32
            </p>
            <p
                className="ds-nums"
                style={{ fontSize: TYPE.body.size, lineHeight: `${TYPE.body.line}px` }}
            >
                Body 14/20 — {t('ds.numericSample')}
            </p>

            <h2>{t('ds.buttons')}</h2>
            <div className="ds-row">
                <Button variant="primary">{t('ds.primary')}</Button>
                <Button variant="secondary">{t('ds.secondary')}</Button>
                <Button variant="ghost" icon={Undo2}>
                    {t('ds.ghost')}
                </Button>
                <Button variant="destructive" confirmLabel={t('ds.destructiveConfirm')}>
                    {t('ds.destructive')}
                </Button>
                <IconButton label={t('ds.undo')}>
                    <Undo2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
                <IconButton label={t('ds.redo')}>
                    <Redo2 size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden="true" />
                </IconButton>
            </div>

            <h2>{t('ds.forms')}</h2>
            <div className="ds-row">
                <Input
                    id="ds-width"
                    label={t('ds.inputLabel')}
                    unit="m"
                    source={t('ds.inputSource')}
                    help={t('equipment.help.physicalWidth')}
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    inputMode="decimal"
                />
                <Input
                    id="ds-width-error"
                    label={t('ds.inputLabel')}
                    unit="m"
                    error={t('ds.inputError')}
                    defaultValue="0"
                />
                <Select
                    id="ds-vehicle"
                    label={t('ds.selectLabel')}
                    value={selectValue}
                    onValueChange={setSelectValue}
                    options={[
                        { value: 'srbc', label: 'SRBC' },
                        { value: 'demo', label: 'Démo' },
                    ]}
                />
            </div>

            <h2>{t('ds.overlays')}</h2>
            <div className="ds-row">
                <Popover
                    label={t('ds.popover')}
                    trigger={
                        <Button variant="secondary" icon={Layers}>
                            {t('ds.popover')}
                        </Button>
                    }
                >
                    <p>{t('ds.popoverBody')}</p>
                </Popover>
                <Button variant="secondary" onClick={() => setToastOpen(true)}>
                    {t('ds.toast')}
                </Button>
            </div>
            <Toast
                open={toastOpen}
                onOpenChange={setToastOpen}
                title={t('ds.toast')}
                description={t('ds.toastBody')}
            />
            <Accordion
                items={[
                    {
                        value: 'one',
                        title: t('ds.accordionOne'),
                        content: <p>{t('ds.accordionBody')}</p>,
                    },
                    {
                        value: 'two',
                        title: t('ds.accordionTwo'),
                        content: <p>{t('ds.accordionBody')}</p>,
                    },
                ]}
            />
            <Tabs
                defaultValue="planned"
                items={[
                    {
                        value: 'planned',
                        label: t('ds.tabOne'),
                        content: <p>{t('ds.tabOneBody')}</p>,
                    },
                    {
                        value: 'executed',
                        label: t('ds.tabTwo'),
                        content: <p>{t('ds.tabTwoBody')}</p>,
                    },
                ]}
            />

            <h2>{t('ds.feedback')}</h2>
            <Banner tone="warning" icon={TriangleAlert}>
                {t('ds.bannerWarning')}
            </Banner>
            <div className="ds-row" style={{ marginTop: 12 }}>
                <Chip tone="warning" icon={TriangleAlert}>
                    {t('ds.chipDraft')}
                </Chip>
                <Chip tone="valid" icon={ICON_BY_FUNCTION.Conforme}>
                    {t('ds.chipValid')}
                </Chip>
                <Chip tone="danger" icon={OctagonAlert}>
                    {t('ds.chipBlocker')}
                </Chip>
            </div>

            <h2>{t('ds.icons')}</h2>
            <div className="ds-icon-grid">
                {Object.entries(ICON_BY_FUNCTION).map(([name, Icon]) => (
                    <div key={name} className="ds-icon-cell">
                        <Icon size={ICON_SIZE.menu} strokeWidth={STROKE} aria-hidden="true" />
                        <span>{name}</span>
                    </div>
                ))}
            </div>
        </article>
    );
}
