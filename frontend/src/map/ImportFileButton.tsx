import { useRef, type ReactElement } from 'react';

import { Button } from '../design-system/Button';

/**
 * Extensions an import adapter can read today. A zipped shapefile set is the
 * usual shape of a vendor export, so `.zip` belongs here next to `.geojson`.
 */
/**
 * Both cases: several consoles name the task file ``TASKDATA.XML``. A picker
 * that only lists ``.xml`` leaves that file greyed out, while the same bytes
 * inside a ``.zip`` were already selectable.
 */
export const IMPORT_ACCEPT = [
    '.geojson',
    '.GEOJSON',
    '.json',
    '.JSON',
    '.zip',
    '.ZIP',
    '.shp',
    '.SHP',
    '.xml',
    '.XML',
    '.kml',
    '.KML',
    '.txt',
    '.TXT',
    'application/geo+json',
    'application/json',
    'application/zip',
    'application/xml',
    'text/xml',
].join(',');

export function ImportFileButton({
    label,
    onFile,
    error,
}: {
    label: string;
    onFile: (file: File) => void;
    error?: string | null;
}): ReactElement {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept={IMPORT_ACCEPT}
                className="visually-hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) {
                        onFile(file);
                    }
                }}
            />
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
                {label}
            </Button>
            {error ? (
                <p className="studio-muted" role="alert">
                    {error}
                </p>
            ) : null}
        </>
    );
}
