import { ChevronDown, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { Button, IconButton } from '../design-system/Button';
import { Accordion } from '../design-system/Disclosure';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import {
    fieldGeometryTree,
    isFieldTreeLeafFocused,
    type FieldTreeGroup,
    type FieldTreeLeaf,
} from './geometry-tree';
import type { useFieldCatalogue } from './useFieldCatalogue';

type Catalogue = ReturnType<typeof useFieldCatalogue>;
type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Beyond this, a row set is folded so the tree stays readable. */
const FOLD_ABOVE = 10;

function groupTitle(t: Translate, group: FieldTreeGroup): string {
    const count = group.leaves.length;
    if (group.kind === 'boundary') {
        return t('fields.tree.group.boundary');
    }
    if (group.kind === 'geofence') {
        return t('fields.tree.group.geofence');
    }
    if (group.kind === 'rows') {
        const name = group.name?.trim();
        return name
            ? `${name} (${count})`
            : t(group.beds ? 'fields.tree.group.beds' : 'fields.tree.group.rows', { count });
    }
    return t(`fields.tree.group.${group.kind}`, { count });
}

function leafLabel(t: Translate, group: FieldTreeGroup, leaf: FieldTreeLeaf): string {
    const name = leaf.name?.trim();
    if (name) {
        return name;
    }
    if (group.kind === 'geofence') {
        return t('fields.edit.geofence');
    }
    if (group.kind === 'zones') {
        return t(`fields.kind.${leaf.kind ?? 'workable'}`);
    }
    if (group.kind === 'rows') {
        return t(group.beds ? 'fields.typeBed' : 'fields.typeRow', { number: leaf.number ?? 1 });
    }
    if (group.kind === 'guidance') {
        return t('fields.typeGuidance');
    }
    if (group.kind === 'traffic') {
        return t(`fields.traffic.${leaf.kind ?? 'path'}`);
    }
    if (group.kind === 'obstacles') {
        return t('fields.typeObstacle');
    }
    if (group.kind === 'landmarks') {
        return t(`fields.landmark.kind.${leaf.kind ?? 'point'}`);
    }
    return t('fields.typeField');
}

/** Same right column as the mission tree: a length on a line, an area on a surface. */
function leafMeasure(t: Translate, group: FieldTreeGroup, leaf: FieldTreeLeaf): string {
    if (leaf.measure) {
        return leaf.measure.kind === 'area'
            ? `${Math.round(leaf.measure.value)} m²`
            : `${Math.round(leaf.measure.value)} m`;
    }
    return leafKindLabel(t, group, leaf);
}

function leafKindLabel(t: Translate, group: FieldTreeGroup, leaf: FieldTreeLeaf): string {
    if (group.kind === 'zones') {
        return t(`fields.kind.${leaf.kind ?? 'workable'}`);
    }
    if (group.kind === 'traffic') {
        return t(`fields.traffic.${leaf.kind ?? 'path'}`);
    }
    if (group.kind === 'rows') {
        return t(group.beds ? 'fields.typeBed' : 'fields.typeRow', { number: leaf.number ?? 1 });
    }
    if (group.kind === 'guidance') {
        return t('fields.typeGuidance');
    }
    if (group.kind === 'obstacles') {
        return t('fields.typeObstacle');
    }
    if (group.kind === 'geofence') {
        return t('fields.edit.geofence');
    }
    if (group.kind === 'landmarks') {
        return t(`fields.landmark.kind.${leaf.kind ?? 'point'}`);
    }
    return t('fields.typeField');
}

function TreeGroup({
    t,
    group,
    catalogue,
}: {
    t: Translate;
    group: FieldTreeGroup;
    catalogue: Catalogue;
}): ReactElement {
    const [open, setOpen] = useState(group.leaves.length <= FOLD_ABOVE);
    const title = groupTitle(t, group);
    /** A child comes back with Ctrl+Z; a whole field cascades, so it is confirmed. */
    const onDelete = (leaf: FieldTreeLeaf): void => {
        if (leaf.focus.kind === 'field' && !window.confirm(t('fields.confirmDelete'))) {
            return;
        }
        void catalogue.deleteEntity(leaf.focus);
    };
    const geofenceFocused =
        group.kind === 'geofence' &&
        group.leaves.some((leaf) => isFieldTreeLeafFocused(leaf, catalogue.focus));
    return (
        <li
            className={
                group.kind === 'geofence'
                    ? 'studio-tree-group studio-tree-geofence'
                    : 'studio-tree-group'
            }
        >
            <button
                type="button"
                className="studio-tree-group-title"
                aria-expanded={open}
                aria-label={
                    open ? t('tree.collapse', { name: title }) : t('tree.expand', { name: title })
                }
                onClick={() => setOpen((value) => !value)}
            >
                <span>{title}</span>
                <ChevronDown
                    className={open ? undefined : 'is-collapsed'}
                    size={ICON_SIZE.button}
                    strokeWidth={STROKE}
                    aria-hidden="true"
                />
            </button>
            {open ? (
                <ul>
                    {group.leaves.map((leaf) => {
                        const active = isFieldTreeLeafFocused(leaf, catalogue.focus);
                        const isHidden = catalogue.hiddenIds.includes(leaf.id);
                        const isLocked = catalogue.lockedIds.includes(leaf.id);
                        const classes = [
                            'studio-tree-row',
                            active ? 'is-active' : '',
                            isHidden ? 'is-hidden' : '',
                            isLocked ? 'is-locked' : '',
                        ]
                            .filter(Boolean)
                            .join(' ');
                        return (
                            <li key={leaf.id} className={classes}>
                                <button
                                    type="button"
                                    className="studio-tree-leaf"
                                    aria-selected={active}
                                    onClick={() =>
                                        catalogue.select(catalogue.selectedId, {
                                            fit: true,
                                            focus: leaf.focus,
                                        })
                                    }
                                    onDoubleClick={(event) => {
                                        event.preventDefault();
                                        catalogue.beginEditGeometry(leaf.focus);
                                    }}
                                >
                                    <span>{leafLabel(t, group, leaf)}</span>
                                    <span className="studio-muted">
                                        {leafMeasure(t, group, leaf)}
                                    </span>
                                </button>
                                <IconButton
                                    label={isHidden ? t('tree.show') : t('tree.hide')}
                                    aria-pressed={isHidden}
                                    onClick={() => catalogue.toggleHidden(leaf.id)}
                                >
                                    {isHidden ? (
                                        <EyeOff size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    ) : (
                                        <Eye size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    )}
                                </IconButton>
                                <IconButton
                                    label={isLocked ? t('tree.unlock') : t('tree.lock')}
                                    aria-pressed={isLocked}
                                    onClick={() => catalogue.toggleLocked(leaf.id)}
                                >
                                    {isLocked ? (
                                        <Lock size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    ) : (
                                        <LockOpen size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    )}
                                </IconButton>
                                <IconButton
                                    label={t('tree.delete')}
                                    disabled={isLocked}
                                    onClick={() => onDelete(leaf)}
                                >
                                    <Trash2 size={ICON_SIZE.button} strokeWidth={STROKE} />
                                </IconButton>
                            </li>
                        );
                    })}
                    {geofenceFocused ? (
                        <li className="studio-tree-geofence-add">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => catalogue.startExclusionZone()}
                            >
                                <Plus
                                    size={ICON_SIZE.button}
                                    strokeWidth={STROKE}
                                    aria-hidden="true"
                                />
                                {t('tree.geofence.addExclusion')}
                            </Button>
                        </li>
                    ) : null}
                </ul>
            ) : null}
        </li>
    );
}

/**
 * Objects of the selected field, grouped the way the operator names them:
 * boundary, geofence, rows and beds, guidance lines, traffic, obstacles.
 * Clicking focuses and frames the object, double-clicking edits its geometry.
 *
 * Frame, groups, rows, eye and padlock are those of `MissionTree`: the operator
 * reads one tree in the mission module and the same tree in the parcellaire one.
 */
export function FieldGeometryTree({
    t,
    catalogue,
}: {
    t: Translate;
    catalogue: Catalogue;
}): ReactElement {
    const groups = useMemo(() => {
        const field = catalogue.selected;
        if (!field) {
            return fieldGeometryTree(null);
        }
        const children = catalogue.childrenByField?.[field.id];
        const fromField = field.landmarks ?? [];
        const fromChildren = children?.landmarks ?? [];
        const byId = new Map(fromField.map((item) => [item.id, item]));
        for (const item of fromChildren) {
            byId.set(item.id, item);
        }
        return fieldGeometryTree({ ...field, landmarks: [...byId.values()] });
    }, [catalogue.childrenByField, catalogue.selected]);
    let content: ReactNode;
    if (!catalogue.selectedId) {
        content = <p className="studio-muted studio-tree-hint">{t('fields.edit.needField')}</p>;
    } else if (groups.length === 0) {
        content = <p className="studio-muted studio-tree-hint">{t('fields.tree.empty')}</p>;
    } else {
        content = (
            <div className="studio-tree">
                <ul className="studio-tree-list" aria-label={t('fields.tree.title')}>
                    {groups.map((group) => (
                        <TreeGroup key={group.id} t={t} group={group} catalogue={catalogue} />
                    ))}
                </ul>
            </div>
        );
    }
    return (
        <div className="studio-tree-panel">
            <Accordion
                defaultValue="fields-tree"
                items={[{ value: 'fields-tree', title: t('fields.tree.title'), content }]}
            />
        </div>
    );
}
