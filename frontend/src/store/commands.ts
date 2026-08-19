/** Snapshot history used by the editor (JSON clone, like TrajectoryEditor.saveForUndo). */

export const MAX_HISTORY = 100;

function cloneSnapshot<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export class CommandStack<T> {
    private past: T[] = [];
    private future: T[] = [];

    get undoCount(): number {
        return this.past.length;
    }

    get redoCount(): number {
        return this.future.length;
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    /** Record the state *before* a mutation. Clears redo. */
    push(before: T): void {
        this.past.push(cloneSnapshot(before));
        if (this.past.length > MAX_HISTORY) {
            this.past.shift();
        }
        this.future = [];
    }

    /** Restore the last pushed snapshot. `current` becomes the redo target. */
    undo(current: T): T | null {
        const previous = this.past.pop();
        if (previous === undefined) {
            return null;
        }
        this.future.push(cloneSnapshot(current));
        return previous;
    }

    redo(current: T): T | null {
        const next = this.future.pop();
        if (next === undefined) {
            return null;
        }
        this.past.push(cloneSnapshot(current));
        return next;
    }

    clear(): void {
        this.past = [];
        this.future = [];
    }
}

export type AutosaveHandle = {
    schedule: () => void;
    cancel: () => void;
};

export function createAutosave(save: () => void, delayMs = 800): AutosaveHandle {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return {
        schedule() {
            cancel();
            timer = setTimeout(() => {
                timer = null;
                save();
            }, delayMs);
        },
        cancel,
    };
}
