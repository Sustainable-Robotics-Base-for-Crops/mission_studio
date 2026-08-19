import type { ReactElement } from 'react';

import { Button } from '../design-system/Button';
import type { useEquipmentCatalogue } from './useEquipmentCatalogue';

type Catalogue = ReturnType<typeof useEquipmentCatalogue>;

const NAV: Array<{ id: Catalogue['nav']; key: string }> = [
    { id: 'combinations', key: 'equipment.nav.combinations' },
    { id: 'vehicles', key: 'equipment.nav.vehicles' },
    { id: 'implements', key: 'equipment.nav.implements' },
];

export function EquipmentContextPanel({
    t,
    catalogue,
    overlay = false,
}: {
    t: (key: string, params?: Record<string, string | number>) => string;
    catalogue: Catalogue;
    overlay?: boolean;
}): ReactElement {
    const items =
        catalogue.nav === 'vehicles'
            ? catalogue.vehicles.map((item) => ({
                  id: item.id,
                  name: item.name,
                  meta: t(
                      item.kinematics === 'skid_steer'
                          ? 'equipment.kinematics.skid'
                          : 'equipment.kinematics.ackermann',
                  ),
                  selected: item.id === catalogue.selectedVehicleId,
                  onSelect: () => catalogue.selectVehicle(item.id),
              }))
            : catalogue.nav === 'implements'
              ? catalogue.implements.map((item) => ({
                    id: item.id,
                    name: item.name,
                    meta: `${t(
                        item.kind === 'trailer'
                            ? 'equipment.kind.trailed'
                            : 'equipment.kind.mounted',
                    )} · ${t('equipment.widthValue', { width: item.working_width_m })}`,
                    selected: item.id === catalogue.selectedImplementId,
                    onSelect: () => catalogue.selectImplement(item.id),
                }))
              : catalogue.combinations.map((item) => ({
                    id: item.id,
                    name: item.name,
                    meta: t(
                        item.origin === 'oem'
                            ? 'equipment.badgeOem'
                            : item.origin === 'modified'
                              ? 'equipment.badgeModified'
                              : 'equipment.badgeLocal',
                    ),
                    selected: item.id === catalogue.selectedCombinationId,
                    onSelect: () => catalogue.selectCombination(item.id),
                }));
    const onAdd =
        catalogue.nav === 'vehicles'
            ? catalogue.addVehicle
            : catalogue.nav === 'implements'
              ? catalogue.addImplement
              : catalogue.addCombination;

    return (
        <aside
            className={overlay ? 'studio-context is-overlay' : 'studio-context'}
            aria-label={t('context.title')}
        >
            <header className="studio-panel-header">
                <h2>{t('nav.equipment')}</h2>
            </header>
            {!catalogue.available ? (
                <p className="studio-muted">{t('equipment.unavailable')}</p>
            ) : (
                <>
                    <nav className="studio-context-nav" aria-label={t('nav.equipment')}>
                        <ul>
                            {NAV.map((entry) => (
                                <li key={entry.id}>
                                    <button
                                        type="button"
                                        className={
                                            catalogue.nav === entry.id ? 'is-active' : undefined
                                        }
                                        onClick={() => catalogue.setNav(entry.id)}
                                    >
                                        {t(entry.key)}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </nav>
                    <div className="studio-field-create">
                        <Button type="button" variant="secondary" onClick={onAdd}>
                            {t('equipment.add')}
                        </Button>
                    </div>
                    {items.length === 0 ? (
                        <p className="studio-muted">{t('equipment.empty')}</p>
                    ) : (
                        <div className="studio-mission-list">
                            <ul>
                                {items.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            className={item.selected ? 'is-active' : undefined}
                                            onClick={item.onSelect}
                                        >
                                            <span>{item.name}</span>
                                            <span className="studio-muted">{item.meta}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {catalogue.error ? (
                        <p className="studio-muted" role="alert">
                            {catalogue.error.startsWith('equipment.')
                                ? t(catalogue.error)
                                : catalogue.error}
                        </p>
                    ) : null}
                </>
            )}
        </aside>
    );
}
