import { useState } from 'react';

import { DEFAULT_ROW_SPACING_M } from '../domain/coverage';
import { DEFAULT_BED_COUNT, DEFAULT_BED_WIDTH_M } from './rows';

export const DEFAULT_PATH_WIDTH_M = 3;

export interface FieldsFollowUpValues {
    count: number;
    spacingM: number;
    side: 'left' | 'right';
    bedWidthM: number;
    pathWidthM: number;
}

export interface FieldsFollowUpForm {
    count: string;
    spacing: string;
    side: 'left' | 'right';
    bedWidth: string;
    pathWidth: string;
    setCount: (value: string) => void;
    setSpacing: (value: string) => void;
    setSide: (side: 'left' | 'right') => void;
    setBedWidth: (value: string) => void;
    setPathWidth: (value: string) => void;
    values: FieldsFollowUpValues;
}

/** Form state for the options asked once a polyline is confirmed (CdC §5.2). */
export function useFieldsFollowUpForm(): FieldsFollowUpForm {
    const [count, setCount] = useState(String(DEFAULT_BED_COUNT));
    const [spacing, setSpacing] = useState(String(DEFAULT_ROW_SPACING_M));
    const [side, setSide] = useState<'left' | 'right'>('right');
    const [bedWidth, setBedWidth] = useState(String(DEFAULT_BED_WIDTH_M));
    const [pathWidth, setPathWidth] = useState(String(DEFAULT_PATH_WIDTH_M));

    return {
        count,
        spacing,
        side,
        bedWidth,
        pathWidth,
        setCount,
        setSpacing,
        setSide,
        setBedWidth,
        setPathWidth,
        values: {
            count: Number(count),
            spacingM: Number(spacing),
            side,
            bedWidthM: Number(bedWidth),
            pathWidthM: Number(pathWidth),
        },
    };
}
