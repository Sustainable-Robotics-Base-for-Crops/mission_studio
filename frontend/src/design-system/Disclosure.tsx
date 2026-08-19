import type { ReactElement, ReactNode } from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as TabsPrimitive from '@radix-ui/react-tabs';

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
}

export function Tabs({
    items,
    defaultValue,
}: {
    items: readonly TabItem[];
    defaultValue: string;
}): ReactElement {
    return (
        <TabsPrimitive.Root defaultValue={defaultValue}>
            <TabsPrimitive.List className="ds-tabs">
                {items.map((item) => (
                    <TabsPrimitive.Trigger key={item.value} value={item.value} className="ds-tab">
                        {item.label}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            {items.map((item) => (
                <TabsPrimitive.Content key={item.value} value={item.value}>
                    {item.content}
                </TabsPrimitive.Content>
            ))}
        </TabsPrimitive.Root>
    );
}
