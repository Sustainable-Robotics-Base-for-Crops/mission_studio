import { useCallback, useRef, useState } from 'react';

import type { ImportedCollection } from '../map/imported-layers';
import { listImportAdapters, previewImport } from './api';
import type { ConvertRequest, ImportIntent } from './convert';
import { localPreview } from './local';
import {
    ImportBackendAbsent,
    ImportRefused,
    type ImportAdapter,
    type ImportCandidate,
    type ImportFormat,
    type ImportPreview,
} from './types';

export interface ImportError {
    key: string;
    params: Record<string, string | number>;
}

export interface FileImport {
    open: boolean;
    file: File | null;
    busy: boolean;
    preview: ImportPreview | null;
    error: ImportError | null;
    /** Catalogue of dialects; kept even when the current one refuses the file. */
    adapters: ImportAdapter[];
    /** File types for the picker. Empty on the local GeoJSON fallback. */
    formats: ImportFormat[];
    candidates: ImportCandidate[];
    /** Dialect that actually read the file. */
    adapter: string;
    /** File type shown in the picker. */
    format: string;
    /** Where the button that opened the dialog lives. */
    intent: ImportIntent;
    /** Called with the file the operator picked; opens the dialog and analyses it. */
    start: (file: File, intent?: ImportIntent) => void;
    /** Re-read the same file as another file type. */
    chooseFormat: (formatId: string) => void;
    /** Re-read the same file with one dialect. Kept for tests and overrides. */
    chooseAdapter: (adapterId: string) => void;
    confirm: () => void;
    confirmConvert: (request: ConvertRequest) => void;
    close: () => void;
}

function asError(reason: unknown): ImportError {
    if (reason instanceof ImportRefused) {
        return { key: reason.key, params: reason.params };
    }
    return { key: 'imports.error.failed', params: {} };
}

/**
 * Drives the import dialog: analyse, let the operator confirm or change the
 * dialect, then hand the normalised collection over as an overlay. Nothing is
 * written to the farm folder, exactly like a survey pole overlay.
 *
 * A refused dialect must not take the picker away: the error stays, the list
 * stays, and the operator tries another formalism on the same file.
 */
export function useFileImport({
    onAdd,
    onConvert,
}: {
    onAdd: (collection: ImportedCollection, fileName: string) => void;
    onConvert?: (request: ConvertRequest, preview: ImportPreview) => Promise<void>;
}): FileImport {
    const [open, setOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [error, setError] = useState<ImportError | null>(null);
    const [adapters, setAdapters] = useState<ImportAdapter[]>([]);
    const [formats, setFormats] = useState<ImportFormat[]>([]);
    const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
    const [adapter, setAdapter] = useState('');
    const [format, setFormat] = useState('');
    const [intent, setIntent] = useState<ImportIntent>('overlay');
    //: Bumped on every request and on close, so a slow answer never lands late.
    const ticket = useRef(0);
    //: Dialog generation: closing or picking another file must drop a late catalogue.
    const session = useRef(0);

    const analyse = useCallback(async (target: File, adapterId?: string, formatId?: string) => {
        ticket.current += 1;
        const current = ticket.current;
        setBusy(true);
        setError(null);
        try {
            const result = await previewImport(target, adapterId, formatId);
            if (current === ticket.current) {
                setPreview(result);
                setAdapters(result.adapters);
                setFormats(result.formats ?? []);
                setCandidates(result.candidates);
                setAdapter(result.adapter);
                setFormat(result.format ?? '');
            }
        } catch (reason) {
            if (current !== ticket.current) {
                return;
            }
            if (reason instanceof ImportBackendAbsent) {
                try {
                    const fallback = await localPreview(target);
                    if (current === ticket.current) {
                        setPreview(fallback);
                        setAdapters(fallback.adapters);
                        setFormats(fallback.formats ?? []);
                        setCandidates(fallback.candidates);
                        setAdapter(fallback.adapter);
                        setFormat(fallback.format ?? 'geojson');
                    }
                    return;
                } catch (localReason) {
                    if (current === ticket.current) {
                        setPreview(null);
                        setError(asError(localReason));
                    }
                    return;
                }
            }
            setPreview(null);
            setError(asError(reason));
            if (adapterId) {
                setAdapter(adapterId);
            }
        } finally {
            if (current === ticket.current) {
                setBusy(false);
            }
        }
    }, []);

    const start = useCallback(
        (target: File, nextIntent: ImportIntent = 'overlay') => {
            session.current += 1;
            const opened = session.current;
            setIntent(nextIntent);
            setFile(target);
            setPreview(null);
            setError(null);
            setAdapter('');
            setFormat('');
            setCandidates([]);
            setAdapters([]);
            setFormats([]);
            setOpen(true);
            void listImportAdapters()
                .then((list) => {
                    if (opened !== session.current) {
                        return;
                    }
                    setAdapters((current) => (current.length > 0 ? current : list.adapters));
                    setFormats((current) => (current.length > 0 ? current : list.formats));
                })
                .catch(() => {
                    /* The preview call fills the list when the backend is up. */
                });
            void analyse(target);
        },
        [analyse],
    );

    const chooseAdapter = useCallback(
        (adapterId: string) => {
            if (!file) {
                return;
            }
            setAdapter(adapterId);
            setPreview(null);
            void analyse(file, adapterId);
        },
        [analyse, file],
    );

    const chooseFormat = useCallback(
        (formatId: string) => {
            if (!file) {
                return;
            }
            setFormat(formatId);
            setPreview(null);
            void analyse(file, undefined, formatId);
        },
        [analyse, file],
    );

    const close = useCallback(() => {
        session.current += 1;
        ticket.current += 1;
        setOpen(false);
        setBusy(false);
        setFile(null);
        setPreview(null);
        setError(null);
        setAdapters([]);
        setFormats([]);
        setCandidates([]);
        setAdapter('');
        setFormat('');
        setIntent('overlay');
    }, []);

    const confirm = useCallback(() => {
        if (!preview || !file || error) {
            return;
        }
        onAdd(preview.collection, file.name);
        close();
    }, [close, error, file, onAdd, preview]);

    const confirmConvert = useCallback(
        (request: ConvertRequest) => {
            if (!preview || !onConvert || error) {
                return;
            }
            ticket.current += 1;
            const current = ticket.current;
            setBusy(true);
            setError(null);
            void onConvert(request, preview)
                .then(() => {
                    if (current === ticket.current) {
                        close();
                    }
                })
                .catch((reason: unknown) => {
                    if (current === ticket.current) {
                        setError(asError(reason));
                    }
                })
                .finally(() => {
                    if (current === ticket.current) {
                        setBusy(false);
                    }
                });
        },
        [close, error, onConvert, preview],
    );

    return {
        open,
        file,
        busy,
        preview,
        error,
        adapters,
        formats,
        candidates,
        adapter,
        format,
        intent,
        start,
        chooseFormat,
        chooseAdapter,
        confirm,
        confirmConvert,
        close,
    };
}
