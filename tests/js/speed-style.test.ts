import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SPEED_STOPS,
    SPEED_COLOR_HIGH,
    SPEED_COLOR_LOW,
    SPEED_COLOR_MID,
    distinctSpeedsMps,
    speedColor,
} from '../../frontend/src/domain/speed-style';

describe('speed-style', () => {
    it('maps the three farm thresholds to the palette', () => {
        expect(speedColor(0.5 / 3.6, DEFAULT_SPEED_STOPS)).toBe(SPEED_COLOR_LOW);
        expect(speedColor(1.75 / 3.6, DEFAULT_SPEED_STOPS)).toBe(SPEED_COLOR_MID);
        expect(speedColor(3 / 3.6, DEFAULT_SPEED_STOPS)).toBe(SPEED_COLOR_HIGH);
        expect(speedColor(0, DEFAULT_SPEED_STOPS)).toBe(SPEED_COLOR_LOW);
        expect(speedColor(2, DEFAULT_SPEED_STOPS)).toBe(SPEED_COLOR_HIGH);
    });

    it('ignores centimetre-per-second noise when listing distinct speeds', () => {
        expect(distinctSpeedsMps([0.501, 0.504, 1])).toEqual([0.5, 1]);
    });
});
