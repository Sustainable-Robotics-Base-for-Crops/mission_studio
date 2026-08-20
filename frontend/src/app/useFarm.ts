import { useCallback, useEffect, useState } from 'react';

import {
    EMPTY_SNAPSHOT,
    fetchFarm,
    fetchFarmAvailable,
    fetchFarmTree,
    openFarm,
    reindexFarm,
    updateFarm,
    type FarmDocument,
    type FarmEntry,
    type FarmSnapshot,
} from './farm-api';

/**
 * Single source of farm state for the shell (L13).
 *
 * Mounted once in AppShell and passed down, so the dashboard, the administration
 * panel and the explorers never disagree about which farm is open.
 */
export function useFarm() {
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<FarmSnapshot>(EMPTY_SNAPSHOT);
    const [missions, setMissions] = useState<FarmEntry[]>([]);
    const [work, setWork] = useState<FarmEntry[]>([]);

    const reload = useCallback(async () => {
        const ok = await fetchFarmAvailable();
        setAvailable(ok);
        if (!ok) {
            setSnapshot(EMPTY_SNAPSHOT);
            setMissions([]);
            setWork([]);
            setLoading(false);
            return;
        }
        const next = await fetchFarm();
        setSnapshot(next);
        if (next.farm) {
            const tree = await fetchFarmTree();
            setMissions(tree.mission_order ?? []);
            setWork(tree.work_performed ?? []);
        } else {
            setMissions([]);
            setWork([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void reload().catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : 'farm.error.load');
            setLoading(false);
        });
    }, [reload]);

    const save = useCallback(
        async (patch: Partial<FarmDocument>) => {
            setError(null);
            try {
                setSnapshot(await updateFarm(patch));
            } catch (reason: unknown) {
                setError(reason instanceof Error ? reason.message : 'farm.error.save');
                throw reason;
            }
        },
        [setSnapshot],
    );

    const open = useCallback(
        async (root: string, name?: string) => {
            setError(null);
            try {
                await openFarm(root, name);
            } catch (reason: unknown) {
                setError(reason instanceof Error ? reason.message : 'farm.error.open');
                throw reason;
            }
            // Switching farm changes every listing, so reload rather than patch.
            await reload();
        },
        [reload],
    );

    const reindex = useCallback(async () => {
        setError(null);
        try {
            await reindexFarm();
        } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : 'farm.error.reindex');
            throw reason;
        }
        await reload();
    }, [reload]);

    return {
        available,
        loading,
        error,
        setError,
        snapshot,
        farm: snapshot.farm,
        root: snapshot.root,
        counts: snapshot.counts,
        recent: snapshot.recent,
        missions,
        work,
        reload,
        save,
        open,
        reindex,
    };
}

export type FarmState = ReturnType<typeof useFarm>;
