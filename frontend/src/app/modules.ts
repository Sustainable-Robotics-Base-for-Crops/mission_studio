export type ModuleId =
    | 'home'
    | 'fields'
    | 'equipment'
    | 'missions'
    | 'simulation'
    | 'publication'
    | 'reports'
    | 'integrations'
    | 'admin';

export type LucideIconName =
    | 'House'
    | 'Map'
    | 'Machine'
    | 'Route'
    | 'CirclePlay'
    | 'Send'
    | 'ChartColumn'
    | 'Plug'
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
 * Global rail entries, CdCF UX §7.1, in the specified order.
 * Screens are routed and empty on purpose until their lot lands.
 */
export const MODULES: readonly StudioModule[] = [
    {
        id: 'home',
        path: '/',
        icon: 'House',
        lot: 'L12',
        labelKey: 'nav.home',
        descriptionKey: 'module.home.description',
        keywords: 'accueil home',
    },
    {
        id: 'fields',
        path: '/parcellaire',
        icon: 'Map',
        lot: 'L5',
        labelKey: 'nav.fields',
        descriptionKey: 'module.fields.description',
        keywords: 'parcelle parcellaire fields map',
    },
    {
        id: 'equipment',
        path: '/materiel',
        icon: 'Machine',
        lot: 'L7',
        labelKey: 'nav.equipment',
        descriptionKey: 'module.equipment.description',
        keywords: 'materiel matériel equipment robot machine outil',
    },
    {
        id: 'missions',
        path: '/missions',
        icon: 'Route',
        lot: 'L8',
        labelKey: 'nav.missions',
        descriptionKey: 'module.missions.description',
        keywords: 'mission missions trajectoire assistant',
    },
    {
        id: 'simulation',
        path: '/simulation',
        icon: 'CirclePlay',
        lot: 'L10',
        labelKey: 'nav.simulation',
        descriptionKey: 'module.simulation.description',
        keywords: 'simulation simuler play',
    },
    {
        id: 'publication',
        path: '/publication',
        icon: 'Send',
        lot: 'L11',
        labelKey: 'nav.publication',
        descriptionKey: 'module.publication.description',
        keywords: 'publier publication send',
    },
    {
        id: 'reports',
        path: '/rapports',
        icon: 'ChartColumn',
        lot: 'L12',
        labelKey: 'nav.reports',
        descriptionKey: 'module.reports.description',
        keywords: 'rapports reports',
    },
    {
        id: 'integrations',
        path: '/integrations',
        icon: 'Plug',
        lot: 'L12',
        labelKey: 'nav.integrations',
        descriptionKey: 'module.integrations.description',
        keywords: 'integrations plug partenaire',
    },
    {
        id: 'admin',
        path: '/administration',
        icon: 'Settings',
        lot: 'L12',
        labelKey: 'nav.admin',
        descriptionKey: 'module.admin.description',
        keywords: 'administration settings reglages',
    },
];

export const MODULE_COUNT = MODULES.length;

export function moduleByPath(pathname: string): StudioModule {
    const normalised = pathname.replace(/\/+$/, '') || '/';
    const found = MODULES.find((module) => module.path === normalised);
    const home = MODULES.find((module) => module.id === 'home');
    if (!home) {
        throw new Error('MODULES must include home');
    }
    return found ?? home;
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
