import { useEffect, useState, type ReactElement } from 'react';
import { BadgeCheck, Pencil } from 'lucide-react';

import { Button, Chip, Input, Select } from '../design-system';
import { AdvancedModeLink } from '../app/AdvancedModeLink';
import { isAdvancedUi, type UiMode } from '../app/farm-api';
import { fieldSource, type FieldSource } from '../domain/equipment';
import {
    defaultOddProfile,
    ODD_CROP,
    ODD_LOCALIZATION,
    ODD_VISIBILITY,
    ODD_WEATHER,
    type OddProfile,
} from '../domain/odd';
import type { useEquipmentCatalogue } from './useEquipmentCatalogue';

type Catalogue = ReturnType<typeof useEquipmentCatalogue>;

function sourceLabel(
    t: (key: string) => string,
    sources: Record<string, FieldSource> | undefined,
    origin: FieldSource,
    key: string,
): string {
    const value = fieldSource(sources, origin, key);
    if (value === 'oem') {
        return t('equipment.sourceOem');
    }
    if (value === 'modified') {
        return t('equipment.sourceModified');
    }
    return t('equipment.sourceLocal');
}

function NumberInput({
    id,
    label,
    unit,
    source,
    value,
    help,
    onCommit,
}: {
    id: string;
    label: string;
    unit: string;
    source: string;
    value: number | null;
    help?: string;
    onCommit: (next: number | null) => void;
}): ReactElement {
    const [text, setText] = useState(value === null ? '' : String(value));
    useEffect(() => {
        setText(value === null ? '' : String(value));
    }, [value]);
    return (
        <Input
            id={id}
            label={label}
            unit={unit}
            source={source}
            help={help}
            value={text}
            inputMode="decimal"
            onChange={(event) => {
                const next = event.target.value;
                setText(next);
                if (next.trim() === '') {
                    onCommit(null);
                    return;
                }
                const parsed = Number(next.replace(',', '.'));
                if (Number.isFinite(parsed)) {
                    onCommit(parsed);
                }
            }}
        />
    );
}

export function EquipmentInspector({
    t,
    catalogue,
    overlay = false,
    uiMode,
}: {
    t: (key: string) => string;
    catalogue: Catalogue;
    overlay?: boolean;
    uiMode?: UiMode;
}): ReactElement {
    const inspectorClass = overlay ? 'studio-inspector is-overlay' : 'studio-inspector';
    if (!catalogue.available) {
        return (
            <aside className={inspectorClass} aria-label={t('inspector.title')}>
                <header className="studio-panel-header">
                    <h2>{t('inspector.title')}</h2>
                </header>
                <p className="studio-muted">{t('equipment.unavailable')}</p>
            </aside>
        );
    }

    const vehicle = catalogue.selectedVehicle;
    const implement = catalogue.selectedImplement;
    const combination = catalogue.selectedCombination;
    const originChip =
        catalogue.nav === 'vehicles'
            ? vehicle?.origin
            : catalogue.nav === 'implements'
              ? implement?.origin
              : combination?.origin;
    const canDelete = originChip !== 'oem';

    return (
        <aside className={inspectorClass} aria-label={t('inspector.title')}>
            <header className="studio-panel-header">
                <h2>{t('inspector.title')}</h2>
                {originChip ? (
                    <Chip
                        tone={originChip === 'modified' ? 'warning' : 'info'}
                        icon={originChip === 'oem' ? BadgeCheck : Pencil}
                    >
                        {originChip === 'oem'
                            ? t('equipment.badgeOem')
                            : originChip === 'modified'
                              ? t('equipment.badgeModified')
                              : t('equipment.badgeLocal')}
                    </Chip>
                ) : null}
            </header>

            {catalogue.nav === 'vehicles' && vehicle ? (
                <div className="studio-section-edit">
                    <Input
                        id="eq-vehicle-name"
                        label={t('equipment.field.name')}
                        help={t('equipment.help.name')}
                        value={vehicle.name}
                        onChange={(event) => catalogue.saveVehicle({ name: event.target.value })}
                    />
                    <Select
                        id="eq-kinematics"
                        label={t('equipment.field.kinematics')}
                        help={t('equipment.help.kinematics')}
                        value={vehicle.kinematics}
                        onValueChange={(value) => catalogue.saveVehicle({ kinematics: value })}
                        options={[
                            { value: 'skid_steer', label: t('equipment.kinematics.skid') },
                            { value: 'ackermann', label: t('equipment.kinematics.ackermann') },
                        ]}
                    />
                    <NumberInput
                        id="eq-length"
                        label={t('equipment.field.length')}
                        unit="m"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'length_m')}
                        help={t('equipment.help.vehicleLength')}
                        value={vehicle.length_m}
                        onCommit={(next) => {
                            if (next !== null && next > 0) {
                                catalogue.saveVehicle({ length_m: next });
                            }
                        }}
                    />
                    <NumberInput
                        id="eq-width"
                        label={t('equipment.field.width')}
                        unit="m"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'width_m')}
                        help={t('equipment.help.vehicleWidth')}
                        value={vehicle.width_m}
                        onCommit={(next) => {
                            if (next !== null && next > 0) {
                                catalogue.saveVehicle({ width_m: next });
                            }
                        }}
                    />
                    <NumberInput
                        id="eq-wheelbase"
                        label={t('equipment.field.wheelbase')}
                        unit="m"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'wheelbase_m')}
                        help={t('equipment.help.wheelbase')}
                        value={vehicle.wheelbase_m}
                        onCommit={(next) => catalogue.saveVehicle({ wheelbase_m: next })}
                    />
                    <NumberInput
                        id="eq-track"
                        label={t('equipment.field.track')}
                        unit="m"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'track_width_m')}
                        help={t('equipment.help.track')}
                        value={vehicle.track_width_m}
                        onCommit={(next) => catalogue.saveVehicle({ track_width_m: next })}
                    />
                    <NumberInput
                        id="eq-mass"
                        label={t('equipment.field.mass')}
                        unit="kg"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'mass_kg')}
                        help={t('equipment.help.mass')}
                        value={vehicle.mass_kg}
                        onCommit={(next) => catalogue.saveVehicle({ mass_kg: next })}
                    />
                    <NumberInput
                        id="eq-speed"
                        label={t('equipment.field.speed')}
                        unit="m/s"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'max_speed_mps')}
                        help={t('equipment.help.speed')}
                        value={vehicle.max_speed_mps}
                        onCommit={(next) => catalogue.saveVehicle({ max_speed_mps: next })}
                    />
                    <NumberInput
                        id="eq-hitch"
                        label={t('equipment.field.hitchX')}
                        unit="m"
                        source={sourceLabel(t, vehicle.sources, vehicle.origin, 'hitch_x_m')}
                        help={t('equipment.help.hitchX')}
                        value={vehicle.hitch_x_m}
                        onCommit={(next) => catalogue.saveVehicle({ hitch_x_m: next })}
                    />
                    <p className="studio-section-edit-hint">{t('equipment.hint.vehicle')}</p>
                </div>
            ) : null}

            {catalogue.nav === 'implements' && implement ? (
                <div className="studio-section-edit">
                    <Input
                        id="eq-implement-name"
                        label={t('equipment.field.name')}
                        help={t('equipment.help.implementName')}
                        value={implement.name}
                        onChange={(event) => catalogue.saveImplement({ name: event.target.value })}
                    />
                    <Select
                        id="eq-hitch-mode"
                        label={t('equipment.field.hitchMode')}
                        help={t('equipment.help.hitchMode')}
                        value={implement.kind}
                        onValueChange={(value) =>
                            catalogue.saveImplement({
                                kind: value,
                                ...(value === 'trailer' && !implement.drawbar_length_m
                                    ? { drawbar_length_m: 1.5 }
                                    : {}),
                            })
                        }
                        options={[
                            { value: 'tool', label: t('equipment.kind.mounted') },
                            { value: 'trailer', label: t('equipment.kind.trailed') },
                        ]}
                    />
                    {implement.kind === 'trailer' ? (
                        <NumberInput
                            id="eq-drawbar"
                            label={t('equipment.field.drawbar')}
                            unit="m"
                            source={sourceLabel(
                                t,
                                implement.sources,
                                implement.origin,
                                'drawbar_length_m',
                            )}
                            help={t('equipment.help.drawbar')}
                            value={implement.drawbar_length_m}
                            onCommit={(next) => {
                                if (next !== null && next > 0) {
                                    catalogue.saveImplement({ drawbar_length_m: next });
                                }
                            }}
                        />
                    ) : null}
                    <NumberInput
                        id="eq-physical"
                        label={t('equipment.field.physicalWidth')}
                        unit="m"
                        source={sourceLabel(
                            t,
                            implement.sources,
                            implement.origin,
                            'physical_width_m',
                        )}
                        help={t('equipment.help.physicalWidth')}
                        value={implement.physical_width_m}
                        onCommit={(next) => {
                            if (next !== null && next > 0) {
                                catalogue.saveImplement({ physical_width_m: next });
                            }
                        }}
                    />
                    <NumberInput
                        id="eq-working"
                        label={t('equipment.field.workingWidth')}
                        unit="m"
                        source={sourceLabel(
                            t,
                            implement.sources,
                            implement.origin,
                            'working_width_m',
                        )}
                        help={t('equipment.help.workingWidth')}
                        value={implement.working_width_m}
                        onCommit={(next) => {
                            if (next !== null && next > 0) {
                                catalogue.saveImplement({ working_width_m: next });
                            }
                        }}
                    />
                    <NumberInput
                        id="eq-impl-length"
                        label={t('equipment.field.length')}
                        unit="m"
                        source={sourceLabel(t, implement.sources, implement.origin, 'length_m')}
                        help={t('equipment.help.implementLength')}
                        value={implement.length_m}
                        onCommit={(next) => {
                            if (next !== null) {
                                catalogue.saveImplement({ length_m: next });
                            }
                        }}
                    />
                    <NumberInput
                        id="eq-offset-x"
                        label={
                            implement.kind === 'trailer'
                                ? t('equipment.field.offsetXTrailer')
                                : t('equipment.field.offsetX')
                        }
                        unit="m"
                        source={sourceLabel(t, implement.sources, implement.origin, 'offset_x_m')}
                        help={
                            implement.kind === 'trailer'
                                ? t('equipment.help.offsetXTrailer')
                                : t('equipment.help.offsetX')
                        }
                        value={implement.offset_x_m}
                        onCommit={(next) => {
                            if (next !== null) {
                                catalogue.saveImplement({ offset_x_m: next });
                            }
                        }}
                    />
                    <NumberInput
                        id="eq-work-x"
                        label={
                            implement.kind === 'trailer'
                                ? t('equipment.field.workPointXTrailer')
                                : t('equipment.field.workPointX')
                        }
                        unit="m"
                        source={sourceLabel(
                            t,
                            implement.sources,
                            implement.origin,
                            'work_point_x_m',
                        )}
                        help={
                            implement.kind === 'trailer'
                                ? t('equipment.help.workPointXTrailer')
                                : t('equipment.help.workPointX')
                        }
                        value={implement.work_point_x_m}
                        onCommit={(next) => {
                            if (next !== null) {
                                catalogue.saveImplement({ work_point_x_m: next });
                            }
                        }}
                    />
                    <p className="studio-section-edit-hint">
                        {implement.kind === 'trailer'
                            ? t('equipment.hint.implementTrailed')
                            : t('equipment.hint.implement')}
                    </p>
                </div>
            ) : null}

            {catalogue.nav === 'combinations' && combination ? (
                <div className="studio-section-edit">
                    <Input
                        id="eq-combo-name"
                        label={t('equipment.field.name')}
                        help={t('equipment.help.combinationName')}
                        value={combination.name}
                        onChange={(event) =>
                            catalogue.saveCombination({ name: event.target.value })
                        }
                    />
                    <Select
                        id="eq-combo-vehicle"
                        label={t('equipment.field.vehicle')}
                        help={t('equipment.help.combinationVehicle')}
                        value={combination.vehicle_id}
                        onValueChange={(value) => catalogue.saveCombination({ vehicle_id: value })}
                        options={catalogue.vehicles.map((item) => ({
                            value: item.id,
                            label: item.name,
                        }))}
                    />
                    <Select
                        id="eq-combo-implement"
                        label={t('equipment.field.implement')}
                        help={t('equipment.help.combinationImplement')}
                        value={combination.implement_id ?? '__none__'}
                        onValueChange={(value) =>
                            catalogue.saveCombination({
                                implement_id: value === '__none__' ? null : value,
                            })
                        }
                        options={[
                            { value: '__none__', label: t('equipment.none') },
                            ...catalogue.implements.map((item) => ({
                                value: item.id,
                                label: item.name,
                            })),
                        ]}
                    />
                    <p className="studio-section-edit-hint">{t('equipment.hint.combination')}</p>
                    {(() => {
                        const odd = combination.odd ?? defaultOddProfile();
                        const patchOdd = (partial: Partial<OddProfile>) => {
                            catalogue.saveCombination({ odd: { ...odd, ...partial } });
                        };
                        return (
                            <>
                                {isAdvancedUi(uiMode) ? (
                                    <>
                                        <p className="studio-muted">{t('equipment.odd.title')}</p>
                                        <Select
                                            id="eq-odd-approved"
                                            label={t('equipment.odd.approved')}
                                            help={t('equipment.help.oddApproved')}
                                            value={odd.approved ? 'yes' : 'no'}
                                            onValueChange={(value) =>
                                                patchOdd({ approved: value === 'yes' })
                                            }
                                            options={[
                                                { value: 'no', label: t('equipment.odd.draft') },
                                                { value: 'yes', label: t('equipment.odd.ready') },
                                            ]}
                                        />
                                        <NumberInput
                                            id="eq-odd-slope"
                                            label={t('equipment.odd.slope')}
                                            unit="%"
                                            source={t('equipment.sourceLocal')}
                                            help={t('equipment.help.oddSlope')}
                                            value={odd.max_slope_pct}
                                            onCommit={(next) => patchOdd({ max_slope_pct: next })}
                                        />
                                        <Select
                                            id="eq-odd-weather"
                                            label={t('equipment.odd.weather')}
                                            help={t('equipment.help.oddWeather')}
                                            value={odd.weather}
                                            onValueChange={(value) =>
                                                patchOdd({
                                                    weather: value as OddProfile['weather'],
                                                })
                                            }
                                            options={ODD_WEATHER.map((item) => ({
                                                value: item,
                                                label: t(`equipment.odd.weather.${item}`),
                                            }))}
                                        />
                                        <Select
                                            id="eq-odd-visibility"
                                            label={t('equipment.odd.visibility')}
                                            help={t('equipment.help.oddVisibility')}
                                            value={odd.visibility}
                                            onValueChange={(value) =>
                                                patchOdd({
                                                    visibility: value as OddProfile['visibility'],
                                                })
                                            }
                                            options={ODD_VISIBILITY.map((item) => ({
                                                value: item,
                                                label: t(`equipment.odd.visibility.${item}`),
                                            }))}
                                        />
                                        <Select
                                            id="eq-odd-crop"
                                            label={t('equipment.odd.crop')}
                                            help={t('equipment.help.oddCrop')}
                                            value={odd.crop}
                                            onValueChange={(value) =>
                                                patchOdd({ crop: value as OddProfile['crop'] })
                                            }
                                            options={ODD_CROP.map((item) => ({
                                                value: item,
                                                label: t(`equipment.odd.crop.${item}`),
                                            }))}
                                        />
                                        <Select
                                            id="eq-odd-loc"
                                            label={t('equipment.odd.localization')}
                                            help={t('equipment.help.oddLocalization')}
                                            value={odd.localization}
                                            onValueChange={(value) =>
                                                patchOdd({
                                                    localization:
                                                        value as OddProfile['localization'],
                                                })
                                            }
                                            options={ODD_LOCALIZATION.map((item) => ({
                                                value: item,
                                                label: t(`equipment.odd.localization.${item}`),
                                            }))}
                                        />
                                        <Input
                                            id="eq-odd-soil"
                                            label={t('equipment.odd.soil')}
                                            help={t('equipment.help.oddSoil')}
                                            value={odd.soil_note}
                                            onChange={(event) =>
                                                patchOdd({ soil_note: event.target.value })
                                            }
                                        />
                                    </>
                                ) : (
                                    <AdvancedModeLink t={t} />
                                )}
                            </>
                        );
                    })()}
                </div>
            ) : null}

            {canDelete ? (
                <div className="studio-section-edit">
                    <Button
                        type="button"
                        variant="destructive"
                        confirmLabel={t('equipment.deleteConfirm')}
                        onClick={catalogue.removeSelected}
                    >
                        {t('equipment.delete')}
                    </Button>
                </div>
            ) : (
                <p className="studio-muted">{t('equipment.oemLocked')}</p>
            )}
        </aside>
    );
}
