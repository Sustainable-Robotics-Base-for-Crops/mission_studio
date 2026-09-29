import { useCallback, useEffect, useRef, useState } from 'react';

import { onSessionChange, restoreLastFarm } from '../farmstore/session';
import {
    EMPTY_SNAPSHOT,
    createFarmInBrowser,
    createFarmOnDevice,
    exportFarmArchive,
    farmFoldersOnDevice,
    fetchFarm,
    fetchFarmAvailable,
    fetchFarmTree,
    importFarmArchive,
    openFarmFromDevice,
    openRecent,
    reindexFarm,
    updateFarm,
    type FarmDocument,
    type FarmEntry,
    type FarmRecent,
    type FarmSnapshot,
} from './farm-api';

/**
 * Single source of farm state for the shell (L13, L15a).
 *
 * Mounted once in AppShell and passed down, so the dashboard, the administration
 * panel and the explorers never disagree about which farm is open. The farm lives on
 * the visitor's device; the previous one is reopened when the browser allows it.
 */
export function useFarm() {
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<FarmSnapshot>(EMPTY_SNAPSHOT);
    const [missions, setMissions] = useState<FarmEntry[]>([]);
    const [work, setWork] = useState<FarmEntry[]>([]);
    const restored = useRef(false);

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
        if (!restored.current) {
            restored.current = true;
            await restoreLastFarm();
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

    useEffect(
        () =>
            onSessionChange(() => {
                void reload().catch(() => undefined);
            }),
        [reload],
    );

    const save = useCallback(async (patch: Partial<FarmDocument>) => {
        setError(null);
        try {
            setSnapshot(await updateFarm(patch));
        } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : 'farm.error.save');
            throw reason;
        }
    }, []);

    /** Wrap a farm switch: report the reason, then reload every listing. */
    const run = useCallback(
        async <T>(action: () => Promise<T>, fallback: string): Promise<T> => {
            setError(null);
            try {
                const result = await action();
                await reload();
                return result;
            } catch (reason: unknown) {
                setError(reason instanceof Error ? reason.message : fallback);
                throw reason;
            }
        },
        [reload],
    );

    const openFromDevice = useCallback(
        () => run(() => openFarmFromDevice(), 'farm.error.open'),
        [run],
    );
    const createOnDevice = useCallback(
        (name: string) => run(() => createFarmOnDevice(name), 'farm.error.open'),
        [run],
    );
    const createInBrowser = useCallback(
        (name: string) => run(() => createFarmInBrowser(name), 'farm.error.open'),
        [run],
    );
    const openRecentFarm = useCallback(
        (recent: FarmRecent) => run(() => openRecent(recent), 'farm.error.open'),
        [run],
    );
    const importArchive = useCallback(
        (file: File) => run(() => importFarmArchive(file), 'farm.error.open'),
        [run],
    );
    const exportArchive = useCallback(async () => {
        setError(null);
        try {
            await exportFarmArchive();
        } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : 'farm.error.export');
            throw reason;
        }
    }, []);
    const reindex = useCallback(() => run(() => reindexFarm(), 'farm.error.reindex'), [run]);

    return {
        available,
        loading,
        error,
        setError,
        snapshot,
        farm: snapshot.farm,
        root: snapshot.root,
        location: snapshot.location,
        counts: snapshot.counts,
        recent: snapshot.recent,
        deviceFolders: farmFoldersOnDevice(),
        missions,
        work,
        reload,
        save,
        openFromDevice,
        createOnDevice,
        createInBrowser,
        openRecent: openRecentFarm,
        importArchive,
        exportArchive,
        reindex,
    };
}

export type FarmState = ReturnType<typeof useFarm>;
