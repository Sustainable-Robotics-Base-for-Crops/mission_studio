import { ChevronDown, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { Button, IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import type { GeofenceId } from '../domain/geofence';
import type { GeofenceLeaf, MissionGroup, MissionLeaf, MissionTreeModel } from './tree';

interface MissionTreeProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    tree: MissionTreeModel;
    selectedIndices: number[];
    hiddenIndices: number[];
    lockedIndices: number[];
    onSelect: (index: number, additive: boolean) => void;
    onToggleHidden: (index: number) => void;
    onToggleLocked: (index: number) => void;
    onDelete?: (index: number) => void;
    selectedGeofenceId?: GeofenceId | null;
    hiddenGeofenceIds?: GeofenceId[];
    lockedGeofenceIds?: GeofenceId[];
    onSelectGeofence?: (id: GeofenceId) => void;
    onToggleGeofenceHidden?: (id: GeofenceId) => void;
    onToggleGeofenceLocked?: (id: GeofenceId) => void;
    onAddGeofenceExclusion?: () => void;
    onDeleteGeofenceExclusion?: (id: GeofenceId) => void;
}

function leafLabel(t: MissionTreeProps['t'], leaf: MissionLeaf): string {
    return t(`tree.leaf.${leaf.role}`, { n: leaf.ordinal });
}

function GroupBlock({
    t,
    group,
    selected,
    hidden,
    locked,
    onSelect,
    onToggleHidden,
    onToggleLocked,
    onDelete,
}: {
    t: MissionTreeProps['t'];
    group: MissionGroup;
    selected: Set<number>;
    hidden: Set<number>;
    locked: Set<number>;
    onSelect: (index: number, additive: boolean) => void;
    onToggleHidden: (index: number) => void;
    onToggleLocked: (index: number) => void;
    onDelete?: (index: number) => void;
}): ReactElement {
    const [open, setOpen] = useState(true);
    const title = t(`tree.group.${group.bucket}`, { count: group.children.length });
    return (
        <li className="studio-tree-group">
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
                    {group.children.map((leaf) => {
                        const active = selected.has(leaf.index);
                        const isHidden = hidden.has(leaf.index);
                        const isLocked = locked.has(leaf.index);
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
                                    onClick={(event) => onSelect(leaf.index, event.shiftKey)}
                                >
                                    <span>{leafLabel(t, leaf)}</span>
                                    <span className="studio-muted">
                                        {Math.round(leaf.length_m)} m
                                    </span>
                                </button>
                                <IconButton
                                    label={isHidden ? t('tree.show') : t('tree.hide')}
                                    aria-pressed={isHidden}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onToggleHidden(leaf.index);
                                    }}
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
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onToggleLocked(leaf.index);
                                    }}
                                >
                                    {isLocked ? (
                                        <Lock size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    ) : (
                                        <LockOpen size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    )}
                                </IconButton>
                                {onDelete ? (
                                    <IconButton
                                        label={t('tree.delete')}
                                        disabled={isLocked}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onDelete(leaf.index);
                                        }}
                                    >
                                        <Trash2 size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    </IconButton>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </li>
    );
}

function geofenceLeafLabel(t: MissionTreeProps['t'], leaf: GeofenceLeaf): string {
    return leaf.role === 'outer'
        ? t('tree.geofence.outer')
        : t('tree.geofence.exclusion', { n: leaf.ordinal });
}

function GeofenceBlock({
    t,
    leaves,
    selectedId,
    hidden,
    locked,
    onSelect,
    onToggleHidden,
    onToggleLocked,
    onAddExclusion,
    onDeleteExclusion,
}: {
    t: MissionTreeProps['t'];
    leaves: GeofenceLeaf[];
    selectedId: GeofenceId | null;
    hidden: Set<GeofenceId>;
    locked: Set<GeofenceId>;
    onSelect?: (id: GeofenceId) => void;
    onToggleHidden?: (id: GeofenceId) => void;
    onToggleLocked?: (id: GeofenceId) => void;
    onAddExclusion?: () => void;
    onDeleteExclusion?: (id: GeofenceId) => void;
}): ReactElement {
    const [open, setOpen] = useState(true);
    const title = t('tree.geofence.group');
    return (
        <li className="studio-tree-group studio-tree-geofence">
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
                    {leaves.map((leaf) => {
                        const isHidden = hidden.has(leaf.id);
                        const isLocked = locked.has(leaf.id);
                        return (
                            <li
                                key={leaf.id}
                                className={[
                                    'studio-tree-row',
                                    'studio-tree-geofence-row',
                                    selectedId === leaf.id ? 'is-active' : '',
                                    isHidden ? 'is-hidden' : '',
                                    isLocked ? 'is-locked' : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                <button
                                    type="button"
                                    className="studio-tree-leaf"
                                    aria-selected={selectedId === leaf.id}
                                    onClick={() => onSelect?.(leaf.id)}
                                >
                                    <span>{geofenceLeafLabel(t, leaf)}</span>
                                    <span className="studio-muted">
                                        {Math.round(leaf.area_m2)} m²
                                    </span>
                                </button>
                                <IconButton
                                    label={isHidden ? t('tree.show') : t('tree.hide')}
                                    aria-pressed={isHidden}
                                    onClick={() => onToggleHidden?.(leaf.id)}
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
                                    onClick={() => onToggleLocked?.(leaf.id)}
                                >
                                    {isLocked ? (
                                        <Lock size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    ) : (
                                        <LockOpen size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    )}
                                </IconButton>
                                {onDeleteExclusion && leaf.role !== 'outer' ? (
                                    <IconButton
                                        label={t('tree.delete')}
                                        disabled={isLocked}
                                        onClick={() => onDeleteExclusion(leaf.id)}
                                    >
                                        <Trash2 size={ICON_SIZE.button} strokeWidth={STROKE} />
                                    </IconButton>
                                ) : null}
                            </li>
                        );
                    })}
                    {selectedId === 'outer' && onAddExclusion ? (
                        <li className="studio-tree-geofence-add">
                            <Button type="button" variant="secondary" onClick={onAddExclusion}>
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

export function MissionTree({
    t,
    tree,
    selectedIndices,
    hiddenIndices,
    lockedIndices,
    onSelect,
    onToggleHidden,
    onToggleLocked,
    onDelete,
    selectedGeofenceId = null,
    hiddenGeofenceIds = [],
    lockedGeofenceIds = [],
    onSelectGeofence,
    onToggleGeofenceHidden,
    onToggleGeofenceLocked,
    onAddGeofenceExclusion,
    onDeleteGeofenceExclusion,
}: MissionTreeProps): ReactElement {
    const selected = new Set(selectedIndices);
    const hidden = new Set(hiddenIndices);
    const locked = new Set(lockedIndices);
    const geofenceHidden = new Set(hiddenGeofenceIds);
    const geofenceLocked = new Set(lockedGeofenceIds);

    if (tree.leaves.length === 0 && tree.geofence.length === 0) {
        return <p className="studio-muted">{t('tree.empty')}</p>;
    }

    return (
        <div className="studio-tree">
            <ul className="studio-tree-list" aria-label={t('tree.title')}>
                {tree.geofence.length > 0 ? (
                    <GeofenceBlock
                        t={t}
                        leaves={tree.geofence}
                        selectedId={selectedGeofenceId}
                        hidden={geofenceHidden}
                        locked={geofenceLocked}
                        onSelect={onSelectGeofence}
                        onToggleHidden={onToggleGeofenceHidden}
                        onToggleLocked={onToggleGeofenceLocked}
                        onAddExclusion={onAddGeofenceExclusion}
                        onDeleteExclusion={onDeleteGeofenceExclusion}
                    />
                ) : null}
                {tree.groups.map((group) => (
                    <GroupBlock
                        key={group.id}
                        t={t}
                        group={group}
                        selected={selected}
                        hidden={hidden}
                        locked={locked}
                        onSelect={onSelect}
                        onToggleHidden={onToggleHidden}
                        onToggleLocked={onToggleLocked}
                        onDelete={onDelete}
                    />
                ))}
            </ul>
        </div>
    );
}
