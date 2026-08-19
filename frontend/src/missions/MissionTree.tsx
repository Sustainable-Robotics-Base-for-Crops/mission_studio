import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';

import { Button, IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import type { MissionGroup, MissionLeaf, MissionTreeModel } from './tree';

interface MissionTreeProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    tree: MissionTreeModel;
    selectedIndices: number[];
    hiddenIndices: number[];
    lockedIndices: number[];
    onSelect: (index: number, additive: boolean) => void;
    onMove: (delta: -1 | 1) => void;
    onReorderTo: (fromIndex: number, toIndex: number) => void;
    onToggleHidden: (index: number) => void;
    onToggleLocked: (index: number) => void;
    onReverse: () => void;
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
    dropIndex,
    onSelect,
    onToggleHidden,
    onToggleLocked,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}: {
    t: MissionTreeProps['t'];
    group: MissionGroup;
    selected: Set<number>;
    hidden: Set<number>;
    locked: Set<number>;
    dropIndex: number | null;
    onSelect: (index: number, additive: boolean) => void;
    onToggleHidden: (index: number) => void;
    onToggleLocked: (index: number) => void;
    onDragStart: (event: DragEvent<HTMLLIElement>, index: number) => void;
    onDragOver: (event: DragEvent<HTMLLIElement>, index: number) => void;
    onDrop: (event: DragEvent<HTMLLIElement>, index: number) => void;
    onDragEnd: () => void;
}): ReactElement {
    return (
        <li className="studio-tree-group">
            <p className="studio-tree-group-title">
                {t(`tree.group.${group.bucket}`, { count: group.children.length })}
            </p>
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
                        dropIndex === leaf.index ? 'is-drop' : '',
                    ]
                        .filter(Boolean)
                        .join(' ');
                    return (
                        <li
                            key={leaf.id}
                            className={classes}
                            draggable={!isLocked}
                            onDragStart={(event) => onDragStart(event, leaf.index)}
                            onDragOver={(event) => onDragOver(event, leaf.index)}
                            onDrop={(event) => onDrop(event, leaf.index)}
                            onDragEnd={onDragEnd}
                        >
                            <button
                                type="button"
                                className="studio-tree-leaf"
                                aria-selected={active}
                                onClick={(event) => onSelect(leaf.index, event.shiftKey)}
                            >
                                <span>{leafLabel(t, leaf)}</span>
                                <span className="studio-muted">{Math.round(leaf.length_m)} m</span>
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
                        </li>
                    );
                })}
            </ul>
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
    onMove,
    onReorderTo,
    onToggleHidden,
    onToggleLocked,
    onReverse,
}: MissionTreeProps): ReactElement {
    const selected = new Set(selectedIndices);
    const hidden = new Set(hiddenIndices);
    const locked = new Set(lockedIndices);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const canReorder =
        selectedIndices.length === 1 &&
        selectedIndices[0] !== undefined &&
        !locked.has(selectedIndices[0]);
    const canReverse =
        selectedIndices.length > 0 && !selectedIndices.some((index) => locked.has(index));
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!canReorder) {
            return;
        }
        if (event.altKey && event.key === 'ArrowUp') {
            event.preventDefault();
            onMove(-1);
        }
        if (event.altKey && event.key === 'ArrowDown') {
            event.preventDefault();
            onMove(1);
        }
    };

    const onDragStart = (event: DragEvent<HTMLLIElement>, index: number) => {
        if (locked.has(index)) {
            event.preventDefault();
            return;
        }
        event.dataTransfer.setData('text/plain', String(index));
        event.dataTransfer.effectAllowed = 'move';
        onSelect(index, false);
    };

    const onDragOver = (event: DragEvent<HTMLLIElement>, index: number) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropIndex(index);
    };

    const onDrop = (event: DragEvent<HTMLLIElement>, toIndex: number) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer.getData('text/plain'));
        setDropIndex(null);
        if (!Number.isInteger(fromIndex) || fromIndex === toIndex) {
            return;
        }
        onReorderTo(fromIndex, toIndex);
    };

    if (tree.leaves.length === 0) {
        return <p className="studio-muted">{t('tree.empty')}</p>;
    }

    return (
        <div className="studio-tree" tabIndex={0} onKeyDown={onKeyDown}>
            <div className="studio-tree-toolbar">
                <Button
                    type="button"
                    variant="secondary"
                    disabled={!canReorder}
                    onClick={() => onMove(-1)}
                >
                    {t('tree.moveUp')}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    disabled={!canReorder}
                    onClick={() => onMove(1)}
                >
                    {t('tree.moveDown')}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    disabled={!canReverse}
                    onClick={onReverse}
                >
                    {t('tree.reverse')}
                </Button>
            </div>
            <p className="studio-muted studio-tree-hint">{t('tree.dragHint')}</p>
            <ul className="studio-tree-list" aria-label={t('tree.title')}>
                {tree.groups.map((group) => (
                    <GroupBlock
                        key={group.id}
                        t={t}
                        group={group}
                        selected={selected}
                        hidden={hidden}
                        locked={locked}
                        dropIndex={dropIndex}
                        onSelect={onSelect}
                        onToggleHidden={onToggleHidden}
                        onToggleLocked={onToggleLocked}
                        onDragStart={onDragStart}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        onDragEnd={() => setDropIndex(null)}
                    />
                ))}
            </ul>
        </div>
    );
}
