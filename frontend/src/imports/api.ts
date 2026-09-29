import {
    ImportBackendAbsent,
    ImportRefused,
    type ImportAdapter,
    type ImportFormat,
    type ImportPreview,
} from './types';

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function refusalFrom(body: unknown, status: number): ImportRefused {
    const record = asRecord(body);
    const key = typeof record?.error === 'string' && record.error ? record.error : null;
    const params = asRecord(record?.params) ?? {};
    return new ImportRefused(key ?? 'imports.error.failed', {
        ...(params as Record<string, string | number>),
        ...(key ? {} : { status }),
    });
}

export async function listImportAdapters(): Promise<{
    adapters: ImportAdapter[];
    formats: ImportFormat[];
}> {
    let response: Response;
    try {
        response = await fetch('/api/v1/imports/adapters');
    } catch {
        throw new ImportBackendAbsent();
    }
    if (response.status === 404 || response.status === 501) {
        throw new ImportBackendAbsent();
    }
    if (!response.ok) {
        throw new ImportRefused('imports.error.failed');
    }
    const body: unknown = await response.json();
    const record = asRecord(body);
    const adapters = record?.adapters;
    const formats = record?.formats;
    return {
        adapters: Array.isArray(adapters) ? (adapters as ImportAdapter[]) : [],
        formats: Array.isArray(formats) ? (formats as ImportFormat[]) : [],
    };
}

/**
 * The upload travels as the raw request body: posting the `File` as-is keeps the
 * public core free of a multipart dependency.
 */
export async function previewImport(
    file: File,
    adapterId?: string,
    formatId?: string,
): Promise<ImportPreview> {
    const query = new URLSearchParams({ filename: file.name });
    if (adapterId) {
        query.set('adapter', adapterId);
    }
    if (formatId) {
        query.set('format', formatId);
    }
    let response: Response;
    try {
        response = await fetch(`/api/v1/imports/preview?${query.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
        });
    } catch {
        throw new ImportBackendAbsent();
    }
    if (response.status === 404 || response.status === 501) {
        throw new ImportBackendAbsent();
    }
    if (!response.ok) {
        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        throw refusalFrom(body, response.status);
    }
    return (await response.json()) as ImportPreview;
}
