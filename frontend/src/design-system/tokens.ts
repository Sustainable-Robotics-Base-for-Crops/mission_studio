/** Canonical design tokens — CdCF UX §4. Tests pin these hex values. */

export const COLOR = {
    bgApp: '#F4F7F3',
    surface: '#FFFFFF',
    surfaceSubtle: '#F8FAF8',
    surfaceSelected: '#EAF7EE',
    border: '#D8E1D9',
    borderStrong: '#AEBBAF',
    textPrimary: '#17211B',
    textSecondary: '#526059',
    textMuted: '#758078',
    primary700: '#166534',
    primary800: '#14532D',
    primary900: '#0F3D24',
    primary100: '#DCFCE7',
    focus: '#2563EB',
    planned: '#2563EB',
    selected: '#7C3AED',
    valid: '#15803D',
    transit: '#64748B',
    warning: '#B45309',
    danger: '#B91C1C',
    autonomy: '#0E7490',
} as const;

export const TYPE = {
    h1: { size: 24, line: 32, weight: 600 },
    h2: { size: 20, line: 28, weight: 600 },
    h3: { size: 16, line: 24, weight: 600 },
    body: { size: 14, line: 20, weight: 400 },
    bodyStrong: { size: 14, line: 20, weight: 600 },
    label: { size: 12, line: 16, weight: 500 },
    caption: { size: 12, line: 16, weight: 500 },
} as const;

export const SPACE = [4, 8, 12, 16, 24, 32, 48] as const;

export const RADIUS = {
    control: 8,
    panel: 10,
    modal: 12,
    chip: 999,
} as const;

export const SHADOW = {
    panel: '0 8px 24px rgba(15, 23, 42, 0.12)',
    subtle: '0 1px 2px rgba(15, 23, 42, 0.08)',
} as const;

export const ICON_SIZE = {
    menu: 20,
    button: 18,
    table: 16,
} as const;

export const CONTROL = {
    heightDesktop: 40,
    heightTouch: 48,
    iconButton: 40,
    minTouch: 44,
    tooltipDelayMs: 400,
    toastMs: 5000,
    focusWidth: 2,
    focusOffset: 2,
} as const;

export const FONT_STACK =
    '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** Lucide package version required by CdCF §4.7 (pinned, not a range). */
export const LUCIDE_PINNED_VERSION = '0.544.0';
