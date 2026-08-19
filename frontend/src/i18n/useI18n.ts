import { useCallback, useEffect, useState } from 'react';

import { resolveLanguage, setShellLanguage, translate, type SupportedLanguage } from './adapter';

export function useI18n(): {
    language: SupportedLanguage;
    t: (key: string, params?: Record<string, string | number>) => string;
    setLanguage: (lang: string) => boolean;
} {
    const [language, setLanguageState] = useState<SupportedLanguage>(() =>
        resolveLanguage(window.i18n?.getCurrentLanguage()),
    );

    useEffect(() => {
        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<{ lang?: string }>).detail;
            setLanguageState(resolveLanguage(detail?.lang ?? window.i18n?.getCurrentLanguage()));
        };
        window.addEventListener('languageChanged', onChange);
        return () => window.removeEventListener('languageChanged', onChange);
    }, []);

    const t = useCallback(
        (key: string, params?: Record<string, string | number>) => translate(key, params, language),
        [language],
    );

    return { language, t, setLanguage: setShellLanguage };
}
