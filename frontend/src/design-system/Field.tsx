import {
    useState,
    type InputHTMLAttributes,
    type ReactElement,
    type SelectHTMLAttributes,
} from 'react';
import { CircleAlert, Info } from 'lucide-react';
import * as SelectPrimitive from '@radix-ui/react-select';

import { useI18n } from '../i18n/useI18n';
import { Button } from './Button';
import { ICON_SIZE, STROKE } from './icons';
import { Dialog } from './Overlay';

interface FieldInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
    id: string;
    label: string;
    unit?: string;
    source?: string;
    error?: string;
    /** Click the i-button next to the label to open this explanation. */
    help?: string;
}

function FieldLabel({
    id,
    label,
    help,
}: {
    id: string;
    label: string;
    help?: string;
}): ReactElement {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    return (
        <div className="ds-label-row">
            <label className="ds-label" htmlFor={id}>
                {label}
            </label>
            {help ? (
                <>
                    <button
                        type="button"
                        className="ds-field-help"
                        aria-label={t('ds.fieldHelp', { label })}
                        onClick={() => setOpen(true)}
                    >
                        <Info size={14} strokeWidth={STROKE} aria-hidden="true" />
                    </button>
                    <Dialog
                        open={open}
                        onOpenChange={setOpen}
                        title={label}
                        className="ds-dialog-help"
                    >
                        <h2 className="ds-dialog-help-title">{label}</h2>
                        <p className="ds-dialog-help-body">{help}</p>
                        <div className="ds-dialog-help-actions">
                            <Button type="button" variant="primary" onClick={() => setOpen(false)}>
                                {t('ds.close')}
                            </Button>
                        </div>
                    </Dialog>
                </>
            ) : null}
        </div>
    );
}

export function Input({
    id,
    label,
    unit,
    source,
    error,
    help,
    className,
    ...rest
}: FieldInputProps): ReactElement {
    const errorId = error ? `${id}-error` : undefined;
    const sourceId = source ? `${id}-source` : undefined;
    const describedBy = [sourceId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className="ds-field">
            <FieldLabel id={id} label={label} help={help} />
            <div className="ds-input-wrap">
                <input
                    id={id}
                    className={['ds-input', className].filter(Boolean).join(' ')}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    {...rest}
                />
                {unit ? <span className="ds-input-unit">{unit}</span> : null}
            </div>
            {source ? (
                <p id={sourceId} className="ds-field-source">
                    {source}
                </p>
            ) : null}
            {error ? (
                <p id={errorId} className="ds-field-error" role="alert">
                    <CircleAlert size={ICON_SIZE.table} strokeWidth={STROKE} aria-hidden="true" />
                    {error}
                </p>
            ) : null}
        </div>
    );
}

interface SelectOption {
    value: string;
    label: string;
    /** Extra line (e.g. "24 rang(s) · 742 m"), shown in the closed field and the list. */
    description?: string;
}

interface SelectProps {
    id: string;
    label: string;
    value: string;
    onValueChange: (value: string) => void;
    options: readonly SelectOption[];
    placeholder?: string;
    help?: string;
}

export function Select({
    id,
    label,
    value,
    onValueChange,
    options,
    placeholder,
    help,
}: SelectProps): ReactElement {
    const hasDescriptions = options.some((option) => Boolean(option.description));
    return (
        <div className="ds-field">
            <FieldLabel id={id} label={label} help={help} />
            <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange}>
                <SelectPrimitive.Trigger
                    id={id}
                    className={
                        hasDescriptions ? 'ds-select-trigger is-multiline' : 'ds-select-trigger'
                    }
                >
                    <SelectPrimitive.Value placeholder={placeholder} />
                </SelectPrimitive.Trigger>
                <SelectPrimitive.Portal>
                    <SelectPrimitive.Content className="ds-select-content" position="popper">
                        <SelectPrimitive.Viewport>
                            {options.map((option) => (
                                <SelectPrimitive.Item
                                    key={option.value}
                                    value={option.value}
                                    textValue={option.label}
                                    className="ds-select-item"
                                >
                                    <SelectPrimitive.ItemText>
                                        <span className="ds-select-item-stack">
                                            <span className="ds-select-item-label">
                                                {option.label}
                                            </span>
                                            {option.description ? (
                                                <span className="ds-select-item-description">
                                                    {option.description}
                                                </span>
                                            ) : null}
                                        </span>
                                    </SelectPrimitive.ItemText>
                                </SelectPrimitive.Item>
                            ))}
                        </SelectPrimitive.Viewport>
                    </SelectPrimitive.Content>
                </SelectPrimitive.Portal>
            </SelectPrimitive.Root>
        </div>
    );
}

interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
}

/** Native `<select>` kept for `#languageSelect` / `window.setLanguage`. */
export function NativeSelect({
    id,
    label,
    className,
    children,
    ...rest
}: NativeSelectProps): ReactElement {
    return (
        <label className="studio-language">
            <span className="visually-hidden">{label}</span>
            <select
                id={id}
                className={['ds-select-trigger', className].filter(Boolean).join(' ')}
                {...rest}
            >
                {children}
            </select>
        </label>
    );
}
