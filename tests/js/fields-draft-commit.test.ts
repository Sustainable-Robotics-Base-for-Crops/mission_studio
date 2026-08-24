import { describe, expect, it } from 'vitest';

import { fieldLineDraftName, resolveFieldDraftCommit } from '../../frontend/src/fields/edit-tools';

describe('resolveFieldDraftCommit', () => {
    it('creates a field only during an explicit create intent', () => {
        expect(
            resolveFieldDraftCommit({
                editingGeometry: false,
                focusKind: 'draft',
                editIntent: 'create_field',
                selectedId: null,
            }),
        ).toEqual({ kind: 'create-field' });
    });

    it('patches the focused entity when editing an existing geometry', () => {
        expect(
            resolveFieldDraftCommit({
                editingGeometry: true,
                focusKind: 'field',
                editIntent: 'none',
                selectedId: 'field-1',
            }),
        ).toEqual({ kind: 'patch-focus' });
    });

    it('patches the selected field if focus was lost mid-edit', () => {
        expect(
            resolveFieldDraftCommit({
                editingGeometry: true,
                focusKind: undefined,
                editIntent: 'none',
                selectedId: 'field-1',
            }),
        ).toEqual({ kind: 'patch-selected' });
    });

    it('does not create a second field when validating after a create', () => {
        expect(
            resolveFieldDraftCommit({
                editingGeometry: false,
                focusKind: 'field',
                editIntent: 'none',
                selectedId: 'field-1',
            }),
        ).toEqual({ kind: 'continue' });
    });

    it('does not treat a surface/zone draft as a field create', () => {
        expect(
            resolveFieldDraftCommit({
                editingGeometry: false,
                focusKind: 'draft',
                editIntent: 'surface',
                selectedId: 'field-1',
            }),
        ).toEqual({ kind: 'continue' });
    });
});

describe('fieldLineDraftName', () => {
    it('names a line after its type, never "parcelle"', () => {
        expect(fieldLineDraftName('guidance')).toBe('Nouvelle ligne de guidage');
        expect(fieldLineDraftName('path')).toBe('Nouveau chemin');
        expect(fieldLineDraftName('bed')).toBe('Nouvelle planche');
        expect(fieldLineDraftName('perennial')).toBe('Nouveau rang');
    });
});
