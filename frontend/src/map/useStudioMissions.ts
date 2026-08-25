import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchMissionDocument, fetchMissionList, type MissionRef } from './missions-api';

export function useStudioMissions(): {
    list: MissionRef[];
    activePath: string | null;
    document: unknown;
    error: string | null;
    select: (path: string) => void;
    adopt: (path: string, payload?: unknown) => void;
    refresh: () => Promise<void>;
} {
    const [list, setList] = useState<MissionRef[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [document, setDocument] = useState<unknown>(null);
    const [error, setError] = useState<string | null>(null);
    const skipLoadRef = useRef(false);
    const activePathLiveRef = useRef<string | null>(null);
    activePathLiveRef.current = activePath;

    useEffect(() => {
        let cancelled = false;
        fetchMissionList()
            .then((missions) => {
                if (cancelled) {
                    return;
                }
                setList(missions);
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : 'list failed');
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!activePath) {
            setDocument(null);
            return;
        }
        if (skipLoadRef.current) {
            skipLoadRef.current = false;
            return;
        }
        let cancelled = false;
        fetchMissionDocument(activePath)
            .then((payload) => {
                if (!cancelled) {
                    setDocument(payload);
                    setError(null);
                }
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : 'load failed');
                    setDocument(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [activePath]);

    const select = useCallback((path: string) => {
        setActivePath(path);
    }, []);

    const adopt = useCallback((path: string, payload?: unknown) => {
        if (payload !== undefined) {
            setDocument(payload);
            if (activePathLiveRef.current !== path) {
                skipLoadRef.current = true;
            }
        }
        setActivePath(path);
    }, []);

    const refresh = useCallback(async () => {
        try {
            const missions = await fetchMissionList();
            setList(missions);
            if (
                activePathLiveRef.current &&
                !missions.some((mission) => mission.path === activePathLiveRef.current)
            ) {
                setActivePath(null);
                setDocument(null);
            }
        } catch (cause: unknown) {
            setError(cause instanceof Error ? cause.message : 'list failed');
        }
    }, []);

    return { list, activePath, document, error, select, adopt, refresh };
}
