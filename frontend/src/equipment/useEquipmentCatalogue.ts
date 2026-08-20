import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    combinationEnvelope,
    projectSrbcEquipment,
    type CombinationEnvelope,
    type CombinationTwin,
    type ImplementTwin,
    type VehicleTwin,
} from '../domain/equipment';
import { parseOddProfile } from '../domain/odd';
import {
    createCombination,
    createImplement,
    createVehicle,
    deleteCombination,
    deleteImplement,
    deleteVehicle,
    fetchCatalogue,
    fetchEquipmentHealth,
    patchCombination,
    patchImplement,
    patchVehicle,
} from './api';
import {
    equipmentFileToImplement,
    equipmentFileToVehicle,
    type EquipmentFile,
    type ManualCombinationDraft,
    type ManualImplementDraft,
    type ManualVehicleDraft,
} from './import-format';

export type EquipmentNav = 'vehicles' | 'implements' | 'combinations';

export function useEquipmentCatalogue() {
    const [available, setAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nav, setNav] = useState<EquipmentNav>('combinations');
    const [vehicles, setVehicles] = useState<VehicleTwin[]>([]);
    const [implementsList, setImplementsList] = useState<ImplementTwin[]>([]);
    const [combinations, setCombinations] = useState<CombinationTwin[]>([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
    const [selectedImplementId, setSelectedImplementId] = useState<string | null>(null);
    const [selectedCombinationId, setSelectedCombinationId] = useState<string | null>(null);

    const reload = useCallback(async () => {
        const ok = await fetchEquipmentHealth();
        if (!ok) {
            setAvailable(false);
            setVehicles([]);
            setImplementsList([]);
            setCombinations([]);
            setLoading(false);
            return;
        }
        setAvailable(true);
        const catalogue = await fetchCatalogue();
        setVehicles(catalogue.vehicles);
        setImplementsList(catalogue.implements);
        setCombinations(catalogue.combinations);
        setSelectedVehicleId((current) => current ?? catalogue.vehicles[0]?.id ?? null);
        setSelectedImplementId((current) => current ?? catalogue.implements[0]?.id ?? null);
        setSelectedCombinationId((current) => current ?? catalogue.combinations[0]?.id ?? null);
        setLoading(false);
    }, []);

    useEffect(() => {
        void reload().catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : 'equipment.error.load');
            setLoading(false);
        });
    }, [reload]);

    const selectedVehicle = vehicles.find((item) => item.id === selectedVehicleId) ?? null;
    const selectedImplement =
        implementsList.find((item) => item.id === selectedImplementId) ?? null;
    const selectedCombination =
        combinations.find((item) => item.id === selectedCombinationId) ?? null;

    const preview = useMemo(() => {
        if (nav === 'vehicles') {
            return { vehicle: selectedVehicle, implement: null as ImplementTwin | null };
        }
        if (nav === 'implements') {
            const host =
                vehicles.find((item) => item.id === selectedCombination?.vehicle_id) ??
                vehicles[0] ??
                null;
            return { vehicle: host, implement: selectedImplement };
        }
        const vehicle =
            vehicles.find((item) => item.id === selectedCombination?.vehicle_id) ?? null;
        const implement = selectedCombination?.implement_id
            ? (implementsList.find((item) => item.id === selectedCombination.implement_id) ?? null)
            : null;
        return { vehicle, implement };
    }, [implementsList, nav, selectedCombination, selectedImplement, selectedVehicle, vehicles]);

    const envelope: CombinationEnvelope | null = useMemo(() => {
        if (!preview.vehicle) {
            return null;
        }
        return combinationEnvelope(preview.vehicle, preview.implement);
    }, [preview]);

    const srbcEquipment = useMemo(() => {
        if (!preview.vehicle) {
            return null;
        }
        return projectSrbcEquipment(preview.vehicle, preview.implement);
    }, [preview]);

    const run = useCallback(async (task: () => Promise<void>) => {
        try {
            setError(null);
            await task();
        } catch (reason: unknown) {
            setError(reason instanceof Error ? reason.message : 'equipment.error.save');
        }
    }, []);

    const saveVehicle = useCallback(
        (patch: Record<string, unknown>) => {
            if (!selectedVehicleId) {
                return;
            }
            void run(async () => {
                setVehicles((current) =>
                    current.map((item) =>
                        item.id === selectedVehicleId
                            ? ({ ...item, ...patch } as VehicleTwin)
                            : item,
                    ),
                );
                const next = await patchVehicle(selectedVehicleId, patch);
                setVehicles((current) =>
                    current.map((item) => (item.id === next.id ? next : item)),
                );
            });
        },
        [run, selectedVehicleId],
    );

    const saveImplement = useCallback(
        (patch: Record<string, unknown>) => {
            if (!selectedImplementId) {
                return;
            }
            void run(async () => {
                setImplementsList((current) =>
                    current.map((item) =>
                        item.id === selectedImplementId
                            ? ({ ...item, ...patch } as ImplementTwin)
                            : item,
                    ),
                );
                const next = await patchImplement(selectedImplementId, patch);
                setImplementsList((current) =>
                    current.map((item) => (item.id === next.id ? next : item)),
                );
            });
        },
        [run, selectedImplementId],
    );

    const saveCombination = useCallback(
        (patch: Record<string, unknown>) => {
            if (!selectedCombinationId) {
                return;
            }
            void run(async () => {
                setCombinations((current) =>
                    current.map((item) =>
                        item.id === selectedCombinationId
                            ? ({
                                  ...item,
                                  ...patch,
                                  odd:
                                      patch.odd !== undefined
                                          ? parseOddProfile(patch.odd)
                                          : item.odd,
                              } as CombinationTwin)
                            : item,
                    ),
                );
                const next = await patchCombination(selectedCombinationId, patch);
                setCombinations((current) =>
                    current.map((item) => (item.id === next.id ? next : item)),
                );
            });
        },
        [run, selectedCombinationId],
    );

    const addVehicle = useCallback(
        (draft?: ManualVehicleDraft) => {
            void run(async () => {
                const created = await createVehicle({
                    name: draft?.name ?? 'Nouveau véhicule',
                    kinematics: draft?.kinematics ?? 'skid_steer',
                    length_m: draft?.length_m ?? 1.1,
                    width_m: draft?.width_m ?? 0.6,
                    mass_kg: draft?.mass_kg ?? null,
                });
                setVehicles((current) => [...current, created]);
                setSelectedVehicleId(created.id);
                setNav('vehicles');
            });
        },
        [run],
    );

    const addImplement = useCallback(
        (draft?: ManualImplementDraft) => {
            void run(async () => {
                const created = await createImplement({
                    name: draft?.name ?? 'Nouvel outil',
                    kind: draft?.hitch_mode === 'trailed' ? 'trailer' : 'tool',
                    physical_width_m: draft?.width_m ?? 1.2,
                    working_width_m: draft?.working_width_m ?? draft?.width_m ?? 1.2,
                    length_m: draft?.length_m ?? 0.4,
                    drawbar_length_m: draft?.drawbar_length_m ?? null,
                });
                setImplementsList((current) => [...current, created]);
                setSelectedImplementId(created.id);
                setNav('implements');
            });
        },
        [run],
    );

    const addCombination = useCallback(
        (draft?: ManualCombinationDraft) => {
            const vehicleId = draft?.vehicle_id ?? selectedVehicleId ?? vehicles[0]?.id;
            if (!vehicleId) {
                setError('equipment.error.needVehicle');
                return;
            }
            void run(async () => {
                const created = await createCombination({
                    name: draft?.name ?? 'Nouvelle combinaison',
                    vehicle_id: vehicleId,
                    implement_id: draft !== undefined ? draft.implement_id : selectedImplementId,
                });
                setCombinations((current) => [...current, created]);
                setSelectedCombinationId(created.id);
                setNav('combinations');
            });
        },
        [run, selectedImplementId, selectedVehicleId, vehicles],
    );

    const importEquipmentFile = useCallback(
        (file: EquipmentFile) => {
            void run(async () => {
                if (file.kind === 'vehicle') {
                    const twin = equipmentFileToVehicle(file);
                    const created = await createVehicle({
                        id: twin.id,
                        name: twin.name,
                        kinematics: twin.kinematics,
                        length_m: twin.length_m,
                        width_m: twin.width_m,
                        mass_kg: twin.mass_kg,
                    });
                    setVehicles((current) => [...current, created]);
                    setSelectedVehicleId(created.id);
                    setNav('vehicles');
                    return;
                }
                const twin = equipmentFileToImplement(file);
                const created = await createImplement({
                    id: twin.id,
                    name: twin.name,
                    kind: twin.kind,
                    physical_width_m: twin.physical_width_m,
                    working_width_m: twin.working_width_m,
                    length_m: twin.length_m,
                    drawbar_length_m: twin.drawbar_length_m,
                });
                setImplementsList((current) => [...current, created]);
                setSelectedImplementId(created.id);
                setNav('implements');
            });
        },
        [run],
    );

    const removeSelected = useCallback(() => {
        void run(async () => {
            if (nav === 'vehicles' && selectedVehicleId) {
                await deleteVehicle(selectedVehicleId);
                setVehicles((current) => current.filter((item) => item.id !== selectedVehicleId));
                setSelectedVehicleId(null);
                return;
            }
            if (nav === 'implements' && selectedImplementId) {
                await deleteImplement(selectedImplementId);
                setImplementsList((current) =>
                    current.filter((item) => item.id !== selectedImplementId),
                );
                setSelectedImplementId(null);
                return;
            }
            if (nav === 'combinations' && selectedCombinationId) {
                await deleteCombination(selectedCombinationId);
                setCombinations((current) =>
                    current.filter((item) => item.id !== selectedCombinationId),
                );
                setSelectedCombinationId(null);
            }
        });
    }, [nav, run, selectedCombinationId, selectedImplementId, selectedVehicleId]);

    return {
        available,
        loading,
        error,
        nav,
        setNav,
        vehicles,
        implements: implementsList,
        combinations,
        selectedVehicleId,
        selectedImplementId,
        selectedCombinationId,
        selectedVehicle,
        selectedImplement,
        selectedCombination,
        selectVehicle: setSelectedVehicleId,
        selectImplement: setSelectedImplementId,
        selectCombination: setSelectedCombinationId,
        preview,
        envelope,
        srbcEquipment,
        saveVehicle,
        saveImplement,
        saveCombination,
        addVehicle,
        addImplement,
        addCombination,
        importEquipmentFile,
        removeSelected,
        reload,
    };
}
