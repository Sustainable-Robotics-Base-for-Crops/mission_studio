import type { ReactElement } from 'react';

/** Straight polyline with vertices — draw-trajectory tool. */
export function TrajectoryIcon({ size = 20 }: { size?: number }): ReactElement {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M4 19 L9 8 L15 8 L20 5" />
            <circle cx="4" cy="19" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="9" cy="8" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="15" cy="8" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="20" cy="5" r="1.7" fill="currentColor" stroke="none" />
        </svg>
    );
}

/** Dotted U between two endpoints — connect tool. */
export function ConnectUIcon({ size = 20 }: { size?: number }): ReactElement {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M6 6 V15 A6 6 0 0 0 18 15 V6" strokeDasharray="2.4 2.2" />
            <circle cx="6" cy="6" r="1.8" fill="currentColor" stroke="none" />
            <circle cx="18" cy="6" r="1.8" fill="currentColor" stroke="none" />
        </svg>
    );
}
