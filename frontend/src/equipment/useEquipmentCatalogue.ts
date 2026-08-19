import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    combinationEnvelope,
    projectSrbcEquipment,
    type CombinationEnvelope,
    type CombinationTwin,
    type ImplementTwin,
    type VehicleTwin,
} from '../domain/equipment';
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
                const next = await patchCombination(selectedCombinationId, patch);
                setCombinations((current) =>
                    current.map((item) => (item.id === next.id ? next : item)),
                );
            });
        },
        [run, selectedCombinationId],
    );

    const addVehicle = useCallback(() => {
        void run(async () => {
            const created = await createVehicle({
                name: 'Nouveau véhicule',
                kinematics: 'skid_steer',
                length_m: 1.1,
                width_m: 0.6,
            });
            setVehicles((current) => [...current, created]);
            setSelectedVehicleId(created.id);
            setNav('vehicles');
        });
    }, [run]);

    const addImplement = useCallback(() => {
        void run(async () => {
            const created = await createImplement({
                name: 'Nouvel outil',
                kind: 'tool',
                physical_width_m: 1.2,
                working_width_m: 1.2,
                length_m: 0.4,
            });
            setImplementsList((current) => [...current, created]);
            setSelectedImplementId(created.id);
            setNav('implements');
        });
    }, [run]);

    const addCombination = useCallback(() => {
        const vehicleId = selectedVehicleId ?? vehicles[0]?.id;
        if (!vehicleId) {
            setError('equipment.error.needVehicle');
            return;
        }
        void run(async () => {
            const created = await createCombination({
                name: 'Nouvelle combinaison',
                vehicle_id: vehicleId,
                implement_id: selectedImplementId,
            });
            setCombinations((current) => [...current, created]);
            setSelectedCombinationId(created.id);
            setNav('combinations');
        });
    }, [run, selectedImplementId, selectedVehicleId, vehicles]);

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
        removeSelected,
        reload,
    };
}
