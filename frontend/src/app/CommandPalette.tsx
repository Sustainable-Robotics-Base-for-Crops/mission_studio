import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Dialog } from '../design-system/Overlay';
import { filterModules, MODULES, type StudioModule } from './modules';

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    t: (key: string, params?: Record<string, string | number>) => string;
}

export function CommandPalette({ open, onClose, t }: CommandPaletteProps): ReactElement {
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    const results = useMemo(() => filterModules(query), [query]);

    useEffect(() => {
        if (!open) {
            setQuery('');
            setActiveIndex(0);
            return;
        }
        const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const choose = (module: StudioModule) => {
        navigate(module.path);
        onClose();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            const selected = results[activeIndex];
            if (selected) {
                event.preventDefault();
                choose(selected);
            }
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            title={t('palette.title')}
            className="studio-palette"
        >
            <div className="ds-input-wrap">
                <input
                    ref={inputRef}
                    className="ds-input"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={t('app.searchPlaceholder')}
                    aria-label={t('palette.title')}
                    aria-controls="studio-palette-results"
                />
            </div>
            <ul id="studio-palette-results" role="listbox">
                {results.length === 0 ? (
                    <li className="studio-muted">{t('palette.empty')}</li>
                ) : (
                    results.map((module, index) => (
                        <li key={module.id} role="option" aria-selected={index === activeIndex}>
                            <button
                                type="button"
                                className={index === activeIndex ? 'is-active' : undefined}
                                onClick={() => choose(module)}
                            >
                                <span>{t(module.labelKey)}</span>
                                <span className="studio-muted">{module.lot}</span>
                            </button>
                        </li>
                    ))
                )}
            </ul>
            <p className="studio-palette-hint">{t('palette.hint')}</p>
            <p className="visually-hidden">{MODULES.length} modules</p>
        </Dialog>
    );
}
