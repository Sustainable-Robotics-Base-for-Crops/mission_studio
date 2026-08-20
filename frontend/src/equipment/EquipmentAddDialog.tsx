import { useEffect, useState, type ChangeEvent, type ReactElement } from 'react';

import { Button } from '../design-system/Button';
import { Input, NativeSelect } from '../design-system/Field';
import { Dialog } from '../design-system/Overlay';
import type { ImplementTwin, Kinematics, VehicleTwin } from '../domain/equipment';
import type { EquipmentNav } from './useEquipmentCatalogue';
import {
    parseEquipmentFile,
    pngMatchesEquipmentIcon,
    type EquipmentFile,
    type ManualCombinationDraft,
    type ManualImplementDraft,
    type ManualVehicleDraft,
} from './import-format';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function EquipmentAddDialog({
    open,
    onOpenChange,
    t,
    nav,
    vehicles,
    implements: implementsList,
    onCreateVehicle,
    onCreateImplement,
    onCreateCombination,
    onImportFile,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    t: Translate;
    nav: EquipmentNav;
    vehicles: VehicleTwin[];
    implements: ImplementTwin[];
    onCreateVehicle: (draft: ManualVehicleDraft) => void;
    onCreateImplement: (draft: ManualImplementDraft) => void;
    onCreateCombination: (draft: ManualCombinationDraft) => void;
    onImportFile: (file: EquipmentFile) => void;
}): ReactElement {
    const [mode, setMode] = useState<'manual' | 'import'>('manual');
    const [name, setName] = useState('');
    const [kinematics, setKinematics] = useState<Kinematics>('skid_steer');
    const [length, setLength] = useState('1.1');
    const [width, setWidth] = useState('0.6');
    const [mass, setMass] = useState('');
    const [hitchMode, setHitchMode] = useState<'mounted' | 'trailed'>('mounted');
    const [workingWidth, setWorkingWidth] = useState('1.2');
    const [drawbar, setDrawbar] = useState('');
    const [vehicleId, setVehicleId] = useState('');
    const [implementId, setImplementId] = useState('__none__');
    const [importProblems, setImportProblems] = useState<string[]>([]);
    const [importHint, setImportHint] = useState<string | null>(null);
    const [parsed, setParsed] = useState<EquipmentFile | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        setMode('manual');
        setName('');
        setKinematics('skid_steer');
        setLength(nav === 'implements' ? '0.4' : '1.1');
        setWidth(nav === 'implements' ? '1.2' : '0.6');
        setMass('');
        setHitchMode('mounted');
        setWorkingWidth('1.2');
        setDrawbar('');
        setVehicleId(vehicles[0]?.id ?? '');
        setImplementId(implementsList[0]?.id ?? '__none__');
        setImportProblems([]);
        setImportHint(null);
        setParsed(null);
    }, [implementsList, nav, open, vehicles]);

    const title =
        nav === 'vehicles'
            ? t('equipment.import.addVehicle')
            : nav === 'implements'
              ? t('equipment.import.addImplement')
              : t('equipment.import.addCombination');

    const onPickFiles = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        const jsonFile = files.find((file) => file.name.toLowerCase().endsWith('.json'));
        const pngFile = files.find((file) => file.name.toLowerCase().endsWith('.png'));
        if (!jsonFile) {
            setParsed(null);
            setImportProblems([t('equipment.import.needJson')]);
            setImportHint(null);
            return;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(await jsonFile.text()) as unknown;
        } catch {
            setParsed(null);
            setImportProblems([t('equipment.import.invalidJson')]);
            setImportHint(null);
            return;
        }
        const result = parseEquipmentFile(raw);
        if (!result.ok) {
            setParsed(null);
            setImportProblems(result.problems.map((item) => item.message));
            setImportHint(null);
            return;
        }
        setParsed(result.file);
        setImportProblems([]);
        if (pngFile) {
            const matches = pngMatchesEquipmentIcon(jsonFile.name, pngFile.name, result.file.icon);
            setImportHint(
                matches ? t('equipment.import.iconOk') : t('equipment.import.iconMismatch'),
            );
        } else {
            setImportHint(t('equipment.import.iconOptional'));
        }
    };

    const confirmManual = () => {
        const lengthM = Number(length);
        const widthM = Number(width);
        if (!name.trim() || !(lengthM > 0) || !(widthM > 0)) {
            return;
        }
        if (nav === 'vehicles') {
            const massKg = mass.trim() === '' ? null : Number(mass);
            onCreateVehicle({
                name: name.trim(),
                kinematics,
                length_m: lengthM,
                width_m: widthM,
                mass_kg: massKg !== null && Number.isFinite(massKg) ? massKg : null,
            });
        } else if (nav === 'implements') {
            const working = Number(workingWidth);
            const bar = drawbar.trim() === '' ? null : Number(drawbar);
            onCreateImplement({
                name: name.trim(),
                hitch_mode: hitchMode,
                length_m: lengthM,
                width_m: widthM,
                working_width_m: working > 0 ? working : widthM,
                drawbar_length_m: bar !== null && Number.isFinite(bar) ? bar : null,
            });
        } else {
            if (!vehicleId) {
                return;
            }
            onCreateCombination({
                name: name.trim(),
                vehicle_id: vehicleId,
                implement_id: implementId === '__none__' ? null : implementId,
            });
        }
        onOpenChange(false);
    };

    const confirmImport = () => {
        if (!parsed) {
            return;
        }
        onImportFile(parsed);
        onOpenChange(false);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            className="studio-equipment-add"
        >
            <h2>{title}</h2>
            {nav !== 'combinations' ? (
                <div className="studio-equipment-add-modes" role="tablist">
                    <Button
                        type="button"
                        variant={mode === 'manual' ? 'primary' : 'secondary'}
                        onClick={() => setMode('manual')}
                    >
                        {t('equipment.import.manual')}
                    </Button>
                    <Button
                        type="button"
                        variant={mode === 'import' ? 'primary' : 'secondary'}
                        onClick={() => setMode('import')}
                    >
                        {t('equipment.import.file')}
                    </Button>
                </div>
            ) : (
                <p className="studio-muted">{t('equipment.import.combinationHint')}</p>
            )}
            {mode === 'import' && nav !== 'combinations' ? (
                <div className="studio-panel-tab">
                    <p className="studio-muted">{t('equipment.import.fileHint')}</p>
                    <input
                        id="equipment-import-file"
                        type="file"
                        accept=".json,application/json,.png,image/png"
                        multiple
                        onChange={(event) => void onPickFiles(event)}
                    />
                    {importProblems.length > 0 ? (
                        <ul className="ds-field-error" role="alert">
                            {importProblems.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    ) : null}
                    {parsed ? (
                        <p>
                            {t('equipment.import.ready', {
                                name: parsed.name,
                                kind: t(`equipment.import.kind.${parsed.kind}`),
                            })}
                        </p>
                    ) : null}
                    {importHint ? <p className="studio-muted">{importHint}</p> : null}
                    <div className="studio-publish-actions">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('pub.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            disabled={!parsed}
                            onClick={confirmImport}
                        >
                            {t('equipment.import.confirm')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="studio-panel-tab">
                    <Input
                        id="equipment-add-name"
                        label={t('equipment.field.name')}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                    {nav === 'vehicles' ? (
                        <>
                            <NativeSelect
                                id="equipment-add-kinematics"
                                label={t('equipment.field.kinematics')}
                                value={kinematics}
                                onChange={(event) =>
                                    setKinematics(event.target.value as Kinematics)
                                }
                            >
                                <option value="skid_steer">{t('equipment.kinematics.skid')}</option>
                                <option value="ackermann">
                                    {t('equipment.kinematics.ackermann')}
                                </option>
                            </NativeSelect>
                            <Input
                                id="equipment-add-length"
                                label={t('equipment.field.length')}
                                unit="m"
                                value={length}
                                onChange={(event) => setLength(event.target.value)}
                            />
                            <Input
                                id="equipment-add-width"
                                label={t('equipment.field.width')}
                                unit="m"
                                value={width}
                                onChange={(event) => setWidth(event.target.value)}
                            />
                            <Input
                                id="equipment-add-mass"
                                label={t('equipment.field.mass')}
                                unit="kg"
                                value={mass}
                                onChange={(event) => setMass(event.target.value)}
                            />
                        </>
                    ) : null}
                    {nav === 'implements' ? (
                        <>
                            <NativeSelect
                                id="equipment-add-hitch"
                                label={t('equipment.field.hitchMode')}
                                value={hitchMode}
                                onChange={(event) =>
                                    setHitchMode(event.target.value as 'mounted' | 'trailed')
                                }
                            >
                                <option value="mounted">{t('equipment.kind.mounted')}</option>
                                <option value="trailed">{t('equipment.kind.trailed')}</option>
                            </NativeSelect>
                            <Input
                                id="equipment-add-length"
                                label={t('equipment.field.length')}
                                unit="m"
                                value={length}
                                onChange={(event) => setLength(event.target.value)}
                            />
                            <Input
                                id="equipment-add-width"
                                label={t('equipment.field.physicalWidth')}
                                unit="m"
                                value={width}
                                onChange={(event) => setWidth(event.target.value)}
                            />
                            <Input
                                id="equipment-add-working"
                                label={t('equipment.field.workingWidth')}
                                unit="m"
                                value={workingWidth}
                                onChange={(event) => setWorkingWidth(event.target.value)}
                            />
                            {hitchMode === 'trailed' ? (
                                <Input
                                    id="equipment-add-drawbar"
                                    label={t('equipment.field.drawbar')}
                                    unit="m"
                                    value={drawbar}
                                    onChange={(event) => setDrawbar(event.target.value)}
                                />
                            ) : null}
                        </>
                    ) : null}
                    {nav === 'combinations' ? (
                        <>
                            <NativeSelect
                                id="equipment-add-vehicle"
                                label={t('equipment.field.vehicle')}
                                value={vehicleId}
                                onChange={(event) => setVehicleId(event.target.value)}
                            >
                                {vehicles.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </NativeSelect>
                            <NativeSelect
                                id="equipment-add-implement"
                                label={t('equipment.field.implement')}
                                value={implementId}
                                onChange={(event) => setImplementId(event.target.value)}
                            >
                                <option value="__none__">{t('equipment.none')}</option>
                                {implementsList.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </NativeSelect>
                        </>
                    ) : null}
                    <div className="studio-publish-actions">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('pub.cancel')}
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            disabled={!name.trim() || (nav === 'combinations' && !vehicleId)}
                            onClick={confirmManual}
                        >
                            {t('equipment.import.confirm')}
                        </Button>
                    </div>
                </div>
            )}
        </Dialog>
    );
}
