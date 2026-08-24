/**
 * Undo stack for parcellaire actions that already reached the server.
 *
 * A point of the current draft is undone by popping it, but a validated line, a
 * duplication or a width sent to the backend needs a compensating call: each
 * entry therefore carries its own `undo` and `redo`, and the stack itself stays
 * a plain reducer so it can be tested without React.
 */

export interface FieldsAction {
    /** i18n key naming the action, shown by the undo affordance. */
    labelKey: string;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
}

export interface FieldsHistory {
    past: FieldsAction[];
    future: FieldsAction[];
}

export const EMPTY_FIELDS_HISTORY: FieldsHistory = { past: [], future: [] };

/** Deep enough for a drawing session, shallow enough to stay predictable. */
export const FIELDS_HISTORY_DEPTH = 25;

export function recordFieldsAction(history: FieldsHistory, action: FieldsAction): FieldsHistory {
    return {
        past: [...history.past, action].slice(-FIELDS_HISTORY_DEPTH),
        future: [],
    };
}

export function takeFieldsUndo(history: FieldsHistory): {
    history: FieldsHistory;
    action: FieldsAction | null;
} {
    const action = history.past[history.past.length - 1];
    if (!action) {
        return { history, action: null };
    }
    return {
        history: { past: history.past.slice(0, -1), future: [...history.future, action] },
        action,
    };
}

export function takeFieldsRedo(history: FieldsHistory): {
    history: FieldsHistory;
    action: FieldsAction | null;
} {
    const action = history.future[history.future.length - 1];
    if (!action) {
        return { history, action: null };
    }
    return {
        history: { past: [...history.past, action], future: history.future.slice(0, -1) },
        action,
    };
}
