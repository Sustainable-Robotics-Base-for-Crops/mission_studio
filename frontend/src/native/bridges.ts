/**
 * Native WebView contract (iOS TrajWebView / TrajSSOService).
 * window.setLanguage is installed by the Jinja page; this module only
 * guarantees a fallback so Vite-dev still has a callable function.
 */
export function ensureNativeBridges(): void {
    if (typeof window.setLanguage === 'function') {
        return;
    }
    window.setLanguage = (lang: string): boolean => {
        if (!window.i18n) {
            return false;
        }
        if (!window.i18n.translations[lang]) {
            return false;
        }
        window.i18n.setLanguage(lang);
        return true;
    };
}
