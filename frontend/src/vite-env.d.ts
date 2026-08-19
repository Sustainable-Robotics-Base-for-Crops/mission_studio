/// <reference types="vite/client" />

interface SrbcFlags {
    UI_SHELL_V2?: boolean;
    UI_THEME_V2?: boolean;
    MAP_ENGINE?: string;
    BACKEND_FASTAPI?: boolean;
    FEAT_COVERAGE_ENGINE?: boolean;
    FEAT_SIMULATION?: boolean;
    FEAT_PUBLICATION?: boolean;
    FEAT_ISOBUS?: boolean;
    FEAT_SECTION_CONTROL?: boolean;
    FEAT_MULTI_ORG_RBAC?: boolean;
    FEAT_FLEET?: boolean;
    FEAT_PLANT_LAYER?: boolean;
}

interface CustomPluginsRegistry {
    authManager: unknown;
    cloudStorages: Record<string, unknown>;
    extraButtons: unknown[];
    registerAuthManager: (impl: unknown) => void;
    registerCloudStorage: (name: string, impl: unknown) => void;
    registerExtraButton: (buttonDef: unknown) => void;
    getExtraButtons: () => unknown[];
    on: (eventName: string, callback: (payload: unknown) => void) => void;
    emit: (eventName: string, payload?: unknown) => void;
}

interface I18nRuntime {
    currentLanguage: string;
    translations: Record<string, Record<string, string>>;
    setLanguage: (lang: string) => void;
    t: (key: string, params?: Record<string, string | number>) => string;
    getCurrentLanguage: () => string;
    getAvailableLanguages: () => string[];
}

interface Window {
    __SRBC_FLAGS__?: SrbcFlags;
    custom_plugins?: CustomPluginsRegistry;
    i18n?: I18nRuntime;
    setLanguage?: (lang: string) => boolean;
    TRAJECTORY_EDITOR_MAP_CONFIG?: unknown;
    TRAJECTORY_EDITOR_UI_CONFIG?: unknown;
}
