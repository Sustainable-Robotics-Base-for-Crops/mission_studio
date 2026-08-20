export type ModuleId = 'home' | 'missions' | 'fields' | 'equipment' | 'simulation' | 'admin';

export type LucideIconName =
    | 'House'
    | 'Map'
    | 'Machine'
    | 'Route'
    | 'CirclePlay'
    | 'Settings'
    | 'CircleHelp'
    | 'Cloud'
    | 'Search';

export interface StudioModule {
    id: ModuleId;
    path: string;
    icon: LucideIconName;
    /** Lot that will fill this empty screen. */
    lot: string;
    labelKey: string;
    descriptionKey: string;
    keywords: string;
}

/**
 * Global rail entries, ordered by how often a farmer needs them (L13 §3.1).
 *
 * Missions come before fields and equipment: the parc and the parcels are set up
 * once a season, missions are the daily work.
 */
export const MODULES: readonly StudioModule[] = [
    {
        id: 'home',
        path: '/',
        icon: 'House',
        lot: 'L13',
        labelKey: 'nav.home',
        descriptionKey: 'module.home.description',
        keywords: 'accueil home tableau de bord dashboard',
    },
    {
        id: 'missions',
        path: '/missions',
        icon: 'Route',
        lot: 'L8',
        labelKey: 'nav.missions',
        descriptionKey: 'module.missions.description',
        keywords: 'mission missions trajectoire assistant publier publication',
    },
    {
        id: 'fields',
        path: '/parcellaire',
        icon: 'Map',
        lot: 'L5',
        labelKey: 'nav.fields',
        descriptionKey: 'module.fields.description',
        keywords: 'parcelle parcellaire fields map ilot',
    },
    {
        id: 'equipment',
        path: '/materiel',
        icon: 'Machine',
        lot: 'L7',
        labelKey: 'nav.equipment',
        descriptionKey: 'module.equipment.description',
        keywords: 'materiel matériel equipment robot machine outil import',
    },
    {
        id: 'simulation',
        path: '/simulation',
        icon: 'CirclePlay',
        lot: 'L10',
        labelKey: 'nav.simulation',
        descriptionKey: 'module.simulation.description',
        keywords: 'simulation simuler play rapport rapports reports',
    },
    {
        id: 'admin',
        path: '/administration',
        icon: 'Settings',
        lot: 'L13',
        labelKey: 'nav.admin',
        descriptionKey: 'module.admin.description',
        keywords: 'administration settings reglages ferme dossier langue',
    },
];

export const MODULE_COUNT = MODULES.length;

/**
 * Routes of the modules folded into others by L13 §3.2. Kept alive so a bookmark
 * or an external link never lands on a blank screen.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
    '/publication': '/missions',
    '/rapports': '/simulation',
    '/integrations': '/materiel',
};

function normalisePath(pathname: string): string {
    return pathname.replace(/\/+$/, '') || '/';
}

export function moduleByPath(pathname: string): StudioModule {
    const normalised = normalisePath(pathname);
    const found = MODULES.find((module) => module.path === normalised);
    const home = MODULES.find((module) => module.id === 'home');
    if (!home) {
        throw new Error('MODULES must include home');
    }
    return found ?? home;
}

/** Where a retired route should send the user, or null when the route is current. */
export function redirectFor(pathname: string): string | null {
    return LEGACY_REDIRECTS[normalisePath(pathname)] ?? null;
}

export function filterModules(query: string): StudioModule[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...MODULES];
    }
    return MODULES.filter((module) => {
        const haystack =
            `${module.id} ${module.path} ${module.labelKey} ${module.lot} ${module.keywords}`.toLowerCase();
        return haystack.includes(needle);
    });
}
