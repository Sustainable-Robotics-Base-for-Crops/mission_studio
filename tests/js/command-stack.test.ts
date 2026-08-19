import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandStack, MAX_HISTORY, createAutosave } from '../../frontend/src/store/commands';

describe('CommandStack', () => {
    it('undoes then redoes a snapshot without mutating the stored copy', () => {
        const stack = new CommandStack<{ n: number }>();
        const first = { n: 1 };
        stack.push(first);
        first.n = 2;
        const undone = stack.undo({ n: 2 });
        expect(undone).toEqual({ n: 1 });
        expect(undone).not.toBe(first);
        expect(stack.canRedo).toBe(true);
        const redone = stack.redo({ n: 1 });
        expect(redone).toEqual({ n: 2 });
        expect(stack.canUndo).toBe(true);
        expect(stack.canRedo).toBe(false);
    });

    it('caps history at 100 snapshots', () => {
        const stack = new CommandStack<number>();
        for (let index = 0; index < MAX_HISTORY + 25; index += 1) {
            stack.push(index);
        }
        expect(stack.undoCount).toBe(MAX_HISTORY);
        expect(stack.undo(999)).toBe(MAX_HISTORY + 24);
        for (let remaining = 0; remaining < MAX_HISTORY - 2; remaining += 1) {
            stack.undo(0);
        }
        expect(stack.undo(0)).toBe(25);
        expect(stack.undo(0)).toBeNull();
    });

    it('clears redo after a new push', () => {
        const stack = new CommandStack<string>();
        stack.push('a');
        stack.undo('b');
        expect(stack.canRedo).toBe(true);
        stack.push('c');
        expect(stack.canRedo).toBe(false);
        expect(stack.redo('c')).toBeNull();
    });
});

describe('createAutosave', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces at 800 ms', () => {
        vi.useFakeTimers();
        const save = vi.fn();
        const autosave = createAutosave(save, 800);
        autosave.schedule();
        autosave.schedule();
        vi.advanceTimersByTime(799);
        expect(save).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('cancel prevents a pending write', () => {
        vi.useFakeTimers();
        const save = vi.fn();
        const autosave = createAutosave(save, 800);
        autosave.schedule();
        autosave.cancel();
        vi.advanceTimersByTime(800);
        expect(save).not.toHaveBeenCalled();
    });
});
