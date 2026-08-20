import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

interface AdvancedModeLinkProps {
    t: (key: string) => string;
}

/** Discrete way out of basic mode — never a disabled control (L13 §8). */
export function AdvancedModeLink({ t }: AdvancedModeLinkProps): ReactElement {
    return (
        <p className="studio-advanced-link">
            <NavLink to="/administration" data-ui="switch-advanced">
                {t('admin.switchToAdvanced')}
            </NavLink>
        </p>
    );
}
