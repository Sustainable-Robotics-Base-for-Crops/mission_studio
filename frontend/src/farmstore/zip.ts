/**
 * Farm folder ⇄ `.zip`, for browsers without a real folder (Safari, Firefox, mobile)
 * and for sharing a farm. The archive holds the same tree as the folder, `.studio/`
 * excluded since it is derived.
 */

import { unzipSync, zipSync, type Zippable } from 'fflate';

import { farmPathSegments, walkFiles, type FarmDirectory } from './fs';
import { FARM_DIRS, FARM_FILE, STUDIO_DIR } from './layout';

/** The visitor's own device pays for it, but a runaway archive must still stop early. */
export const MAX_ZIP_FILES = 20_000;
export const MAX_ZIP_BYTES = 512 * 1024 * 1024;

export async function exportFarmZip(dir: FarmDirectory): Promise<Uint8Array> {
    const entries: Zippable = {};
    for (const folder of FARM_DIRS) {
        entries[`${folder}/`] = new Uint8Array(0);
    }
    for (const path of await walkFiles(dir)) {
        if (path === STUDIO_DIR || path.startsWith(`${STUDIO_DIR}/`)) {
            continue;
        }
        const data = await dir.readBytes(path);
        if (data) {
            entries[path] = data;
        }
    }
    return zipSync(entries, { level: 6 });
}

/** Common leading folder, when the archive wraps the farm in one (`ferme-xy/farm.json`). */
function wrapperPrefix(names: string[]): string {
    if (names.includes(FARM_FILE)) {
        return '';
    }
    const candidates = names.filter((name) => name.endsWith(`/${FARM_FILE}`));
    const shortest = candidates.sort((a, b) => a.length - b.length)[0];
    return shortest ? shortest.slice(0, -FARM_FILE.length) : '';
}

export interface ZipImportReport {
    files: number;
    skipped: string[];
}

/** Unpack a farm archive into an empty directory. Throws when it is not a farm. */
export async function importFarmZip(
    dir: FarmDirectory,
    archive: Uint8Array,
): Promise<ZipImportReport> {
    let total = 0;
    let count = 0;
    const content = unzipSync(archive, {
        filter(file) {
            count += 1;
            total += file.originalSize;
            if (count > MAX_ZIP_FILES) {
                throw new Error(`archive has more than ${MAX_ZIP_FILES} files`);
            }
            if (total > MAX_ZIP_BYTES) {
                throw new Error('archive is too large once uncompressed');
            }
            return !file.name.endsWith('/') && !file.name.startsWith('__MACOSX/');
        },
    });
    const names = Object.keys(content);
    const prefix = wrapperPrefix(names);
    if (!names.includes(`${prefix}${FARM_FILE}`)) {
        throw new Error('this archive does not contain a farm (farm.json is missing)');
    }
    const skipped: string[] = [];
    let files = 0;
    for (const name of names) {
        if (!name.startsWith(prefix)) {
            skipped.push(name);
            continue;
        }
        const relative = name.slice(prefix.length);
        const base = relative.split('/').pop() ?? '';
        if (base.startsWith('._') || relative.startsWith(`${STUDIO_DIR}/`)) {
            skipped.push(name);
            continue;
        }
        try {
            farmPathSegments(relative);
        } catch {
            skipped.push(name);
            continue;
        }
        const data = content[name];
        if (data) {
            await dir.writeBytes(relative, data);
            files += 1;
        }
    }
    for (const folder of FARM_DIRS) {
        await dir.makeDirectory(folder);
    }
    return { files, skipped };
}
