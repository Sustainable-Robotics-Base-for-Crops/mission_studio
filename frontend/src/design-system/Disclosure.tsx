import { Fragment, type ReactElement, type ReactNode } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { ChevronDown } from 'lucide-react';

import { ICON_SIZE, STROKE } from './icons';
import { Tooltip } from './Overlay';

interface AccordionItem {
    value: string;
    title: string;
    content: ReactNode;
}

export function Accordion({
    items,
    defaultValue,
}: {
    items: readonly AccordionItem[];
    defaultValue?: string;
}): ReactElement {
    return (
        <AccordionPrimitive.Root type="single" collapsible defaultValue={defaultValue}>
            {items.map((item) => (
                <AccordionPrimitive.Item
                    key={item.value}
                    value={item.value}
                    className="ds-accordion-item"
                >
                    <AccordionPrimitive.Header>
                        <AccordionPrimitive.Trigger className="ds-accordion-trigger">
                            {item.title}
                            <ChevronDown
                                size={ICON_SIZE.button}
                                strokeWidth={STROKE}
                                aria-hidden="true"
                            />
                        </AccordionPrimitive.Trigger>
                    </AccordionPrimitive.Header>
                    <AccordionPrimitive.Content>{item.content}</AccordionPrimitive.Content>
                </AccordionPrimitive.Item>
            ))}
        </AccordionPrimitive.Root>
    );
}

interface TabItem {
    value: string;
    label: string;
    content: ReactNode;
    /** Visible but inert: announces a planned feature without promising it. */
    disabled?: boolean;
    tooltip?: string;
}

/** A tab that cannot be opened must never be the one opened by default. */
function firstOpenable(items: readonly TabItem[], preferred: string): string {
    const wanted = items.find((item) => item.value === preferred);
    if (wanted && !wanted.disabled) {
        return preferred;
    }
    return items.find((item) => !item.disabled)?.value ?? preferred;
}

export function Tabs({
    items,
    defaultValue,
}: {
    items: readonly TabItem[];
    defaultValue: string;
}): ReactElement {
    return (
        <TabsPrimitive.Root defaultValue={firstOpenable(items, defaultValue)}>
            <TabsPrimitive.List className="ds-tabs">
                {items.map((item) => {
                    const trigger = (
                        <TabsPrimitive.Trigger
                            value={item.value}
                            className="ds-tab"
                            disabled={item.disabled}
                        >
                            {item.label}
                        </TabsPrimitive.Trigger>
                    );
                    if (!item.tooltip) {
                        return <Fragment key={item.value}>{trigger}</Fragment>;
                    }
                    // The wrapper carries the hover: a disabled button swallows
                    // pointer events, so a tooltip attached to it never shows.
                    return (
                        <Tooltip key={item.value} content={item.tooltip}>
                            <span className="ds-tab-wrap">{trigger}</span>
                        </Tooltip>
                    );
                })}
            </TabsPrimitive.List>
            {items.map((item) =>
                item.disabled ? null : (
                    <TabsPrimitive.Content key={item.value} value={item.value}>
                        {item.content}
                    </TabsPrimitive.Content>
                ),
            )}
        </TabsPrimitive.Root>
    );
}
