import { useCallback, useRef, useState } from 'react';

import { layerFromCollection, type ImportedLayer } from './imported-layers';

/**
 * Session-only survey overlays. Reloading Mission Studio starts from an empty list;
 * nothing is written to the farm folder or to web storage.
 */
export function useImportedLayers(): {
    layers: ImportedLayer[];
    error: string | null;
    fitKey: string | null;
    addCollection: (collection: unknown, fileName: string) => void;
    setVisible: (id: string, visible: boolean) => void;
    remove: (id: string) => void;
} {
    const [layers, setLayers] = useState<ImportedLayer[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [fitKey, setFitKey] = useState<string | null>(null);
    const sequence = useRef(0);
    const layersRef = useRef(layers);
    layersRef.current = layers;

    /** Accepts a local GeoJSON document as well as an adapter-normalised collection. */
    const addCollection = useCallback((collection: unknown, fileName: string) => {
        setError(null);
        sequence.current += 1;
        const parsed = layerFromCollection(collection, fileName, {
            id: `i${sequence.current}`,
            existingNames: layersRef.current.map((layer) => layer.name),
        });
        if ('error' in parsed) {
            setError(parsed.error);
            return;
        }
        setLayers((current) => [...current, parsed.layer]);
        setFitKey(`${parsed.layer.id}#${sequence.current}`);
    }, []);

    const setVisible = useCallback((id: string, visible: boolean) => {
        setLayers((current) =>
            current.map((layer) => (layer.id === id ? { ...layer, visible } : layer)),
        );
    }, []);

    const remove = useCallback((id: string) => {
        setLayers((current) => current.filter((layer) => layer.id !== id));
        setError(null);
    }, []);

    return { layers, error, fitKey, addCollection, setVisible, remove };
}
