import { ArrowRight, Crosshair, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { IconButton } from '../design-system/Button';
import { ICON_SIZE, STROKE } from '../design-system/icons';
import { searchPlaces, type PlaceHit } from './geocoding-api';

interface PlaceSearchProps {
    t: (key: string, params?: Record<string, string | number>) => string;
    onSelect: (hit: PlaceHit) => void;
    metricsCaption?: string | null;
}

const DEBOUNCE_MS = 350;

export function PlaceSearch({
    t,
    onSelect,
    metricsCaption = null,
}: PlaceSearchProps): ReactElement {
    const inputId = useId();
    const listId = useId();
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<PlaceHit[]>([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const skipSearchRef = useRef(false);

    useEffect(() => {
        abortRef.current?.abort();
        if (skipSearchRef.current) {
            skipSearchRef.current = false;
            return;
        }
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setHits([]);
            setOpen(false);
            setError(null);
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        const timer = window.setTimeout(() => {
            searchPlaces(trimmed, controller.signal)
                .then((results) => {
                    setHits(results);
                    setOpen(true);
                    setActive(-1);
                    setError(
                        results.length === 0 ? t('map.search.noResults', { query: trimmed }) : null,
                    );
                })
                .catch((cause: unknown) => {
                    if (controller.signal.aborted) {
                        return;
                    }
                    setHits([]);
                    setOpen(false);
                    setError(cause instanceof Error ? cause.message : t('map.search.error'));
                });
        }, DEBOUNCE_MS);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [query, t]);

    const pick = (hit: PlaceHit) => {
        skipSearchRef.current = true;
        setQuery(hit.label);
        setHits([]);
        setOpen(false);
        setActive(-1);
        setError(null);
        onSelect(hit);
    };

    const locate = () => {
        if (!navigator.geolocation) {
            setError(t('map.search.geoUnsupported'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                    setError(t('map.search.geoError'));
                    return;
                }
                pick({
                    label: t('map.search.myPosition'),
                    lat: latitude,
                    lon: longitude,
                    type: 'geolocation',
                    provider: 'browser',
                });
            },
            () => setError(t('map.search.geoError')),
            { enableHighAccuracy: true, timeout: 8000 },
        );
    };

    return (
        <div className="studio-place-search">
            {metricsCaption ? (
                <p className="studio-metrics-strip" role="status">
                    {metricsCaption}
                </p>
            ) : null}
            <div className="studio-place-search-toolbar">
                <div className="studio-place-search-box">
                    <Search size={ICON_SIZE.button} strokeWidth={STROKE} aria-hidden />
                    <input
                        id={inputId}
                        type="search"
                        value={query}
                        placeholder={t('map.search.placeholder')}
                        aria-label={t('map.search.placeholder')}
                        aria-autocomplete="list"
                        aria-controls={listId}
                        aria-expanded={open}
                        autoComplete="off"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActive((index) => Math.min(index + 1, hits.length - 1));
                                setOpen(true);
                                return;
                            }
                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActive((index) => Math.max(index - 1, 0));
                                return;
                            }
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                const hit = active >= 0 ? hits[active] : hits[0];
                                if (hit) {
                                    pick(hit);
                                }
                                return;
                            }
                            if (event.key === 'Escape') {
                                setOpen(false);
                            }
                        }}
                    />
                    <IconButton
                        label={t('map.search.button')}
                        onClick={() => {
                            const hit = active >= 0 ? hits[active] : hits[0];
                            if (hit) {
                                pick(hit);
                            }
                        }}
                    >
                        <ArrowRight size={ICON_SIZE.button} strokeWidth={STROKE} />
                    </IconButton>
                </div>
                <IconButton label={t('map.search.geolocation')} onClick={locate}>
                    <Crosshair size={ICON_SIZE.button} strokeWidth={STROKE} />
                </IconButton>
                {open && hits.length > 0 ? (
                    <ul id={listId} role="listbox" className="studio-place-search-hits">
                        {hits.map((hit, index) => (
                            <li key={`${hit.lat},${hit.lon},${hit.label}`}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={index === active}
                                    className={index === active ? 'is-active' : undefined}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => pick(hit)}
                                >
                                    <span>{hit.label}</span>
                                    <span className="studio-place-search-meta">
                                        {hit.lat.toFixed(5)}, {hit.lon.toFixed(5)}
                                        {hit.provider ? ` · ${hit.provider}` : ''}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>
            {error ? (
                <p className="studio-place-search-error" role="status">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
