import type { ImportedCollection } from '../map/imported-layers';

/** Wire format of `/api/v1/imports`. Keys stay snake_case, like the rest of the API. */

export type ImportKind =
    'boundary' | 'row' | 'guidance_line' | 'obstacle' | 'track' | 'coverage_cell' | 'landmark';

export interface ImportAdapter {
    id: string;
    /** Internal name. The picker shows {@link ImportFormat}, not this label. */
    label: string;
    vendor: string;
    extensions: string[];
    format_id?: string;
    kinds: string[];
}

/** One entry of the format picker: a file type, never a manufacturer. */
export interface ImportFormat {
    id: string;
    label_key: string;
    extensions: string[];
}

export interface ImportCandidate {
    adapter: string;
    confidence: number;
    /** i18n key explaining what the adapter recognised. */
    reason: string;
    params: Record<string, string | number>;
}

export interface ImportMetric {
    key: string;
    value: string | number | null;
    unit: string | null;
}

export interface ImportNotice {
    key: string;
    params: Record<string, string | number>;
}

/**
 * What a later lot could build from this layer. Phase one only shows it, so the
 * operator knows the file is understood before any object is created.
 */
export interface ImportPromotion {
    kind: string;
    target: string;
    count: number;
    collective: boolean;
}

export interface ImportGroup {
    id: string;
    name: string;
    feature_count: number;
}

export interface ImportReport {
    adapter: string;
    label: string;
    vendor: string;
    feature_count: number;
    kinds: Record<string, number>;
    geometry_types: Record<string, number>;
    metrics: ImportMetric[];
    notices: ImportNotice[];
    members: string[];
    groups?: ImportGroup[];
    promotions: ImportPromotion[];
}

export interface ImportPreview {
    source: { filename: string; bytes: number };
    adapters: ImportAdapter[];
    formats?: ImportFormat[];
    format?: string | null;
    candidates: ImportCandidate[];
    adapter: string;
    report: ImportReport;
    collection: ImportedCollection;
}

/** A refusal the operator can act on, carried as an i18n key. */
export class ImportRefused extends Error {
    readonly key: string;
    readonly params: Record<string, string | number>;

    constructor(key: string, params: Record<string, string | number> = {}) {
        super(key);
        this.name = 'ImportRefused';
        this.key = key;
        this.params = params;
    }
}

/** The FastAPI backend is not serving this build; fall back to local parsing. */
export class ImportBackendAbsent extends Error {
    constructor() {
        super('imports.error.backendAbsent');
        this.name = 'ImportBackendAbsent';
    }
}
