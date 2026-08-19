import { useCallback, useEffect, useState } from 'react';

import { fetchMissionDocument, fetchMissionList, type MissionRef } from './missions-api';

export function useStudioMissions(): {
    list: MissionRef[];
    activePath: string | null;
    document: unknown;
    error: string | null;
    select: (path: string) => void;
} {
    const [list, setList] = useState<MissionRef[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [document, setDocument] = useState<unknown>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchMissionList()
            .then((missions) => {
                if (cancelled) {
                    return;
                }
                setList(missions);
                const first = missions[0];
                if (first) {
                    setActivePath(first.path);
                }
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

    return { list, activePath, document, error, select };
}
