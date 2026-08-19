import { useCallback, useEffect, useState } from 'react';

import {
    createPublication,
    fetchPublicationHealth,
    listPublications,
    type PublicationRecord,
} from './api';

export function usePublications(sourcePath: string | null) {
    const [available, setAvailable] = useState(false);
    const [items, setItems] = useState<PublicationRecord[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        const ok = await fetchPublicationHealth();
        setAvailable(ok);
        if (!ok) {
            setItems([]);
            setLoading(false);
            return;
        }
        const next = await listPublications(sourcePath);
        setItems(next);
        setLoading(false);
    }, [sourcePath]);

    useEffect(() => {
        void reload().catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : 'pub.error.load');
            setLoading(false);
        });
    }, [reload]);

    const publish = useCallback(async (payload: Parameters<typeof createPublication>[0]) => {
        setError(null);
        const created = await createPublication(payload);
        setItems((current) => [
            created,
            ...current.map((item) =>
                item.source_path === created.source_path && item.id !== created.id
                    ? { ...item, status: 'obsolete' }
                    : item,
            ),
        ]);
        return created;
    }, []);

    return { available, items, error, loading, reload, publish, setError };
}
