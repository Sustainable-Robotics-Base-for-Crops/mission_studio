import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { breakpointFromWidth, LAYOUT, shellTracks } from '../../frontend/src/app/layout';
import {
    filterModules,
    LEGACY_REDIRECTS,
    MODULE_COUNT,
    MODULES,
    moduleByPath,
    redirectFor,
} from '../../frontend/src/app/modules';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('modules (L13 §3.1)', () => {
    it('exposes exactly six global entries, missions before fields', () => {
        expect(MODULE_COUNT).toBe(6);
        expect(MODULES.map((module) => module.id)).toEqual([
            'home',
            'missions',
            'fields',
            'equipment',
            'simulation',
            'admin',
        ]);
    });

    it('assigns the Lucide metaphors from the UX specification', () => {
        expect(MODULES.map((module) => module.icon)).toEqual([
            'House',
            'Route',
            'Map',
            'Machine',
            'CirclePlay',
            'Settings',
        ]);
    });

    it('resolves known paths and falls back to home', () => {
        expect(moduleByPath('/missions').id).toBe('missions');
        expect(moduleByPath('/missions/').id).toBe('missions');
        expect(moduleByPath('/unknown').id).toBe('home');
    });

    it('filters the palette by id, path and lot', () => {
        expect(filterModules('parcelle').map((module) => module.id)).toEqual(['fields']);
        expect(filterModules('L10').map((module) => module.id)).toEqual(['simulation']);
        expect(filterModules('   ')).toHaveLength(6);
    });

    it('still finds the folded modules by their old vocabulary', () => {
        expect(filterModules('publication').map((module) => module.id)).toEqual(['missions']);
        expect(filterModules('rapport').map((module) => module.id)).toEqual(['simulation']);
    });
});

describe('retired routes (L13 §3.2)', () => {
    it('redirects publication, reports and integrations to the modules that absorbed them', () => {
        expect(redirectFor('/publication')).toBe('/missions');
        expect(redirectFor('/rapports')).toBe('/simulation');
        expect(redirectFor('/integrations')).toBe('/materiel');
    });

    it('ignores trailing slashes', () => {
        expect(redirectFor('/publication/')).toBe('/missions');
    });

    it('leaves current routes alone', () => {
        expect(redirectFor('/missions')).toBeNull();
        expect(redirectFor('/')).toBeNull();
        expect(redirectFor('/unknown')).toBeNull();
    });

    it('never redirects towards a route that no longer exists', () => {
        const paths = new Set(MODULES.map((module) => module.path));
        for (const target of Object.values(LEGACY_REDIRECTS)) {
            expect(paths.has(target)).toBe(true);
        }
    });

    it('wires the redirect into the shell', () => {
        const source = readFileSync(resolve(ROOT, 'frontend/src/app/AppShell.tsx'), 'utf8');
        expect(source).toContain('redirectFor(location.pathname)');
        expect(source).toContain('{ replace: true }');
    });
});

describe('breakpoints (CdCF §6.2)', () => {
    it('maps widths onto the four layout modes', () => {
        expect(breakpointFromWidth(1440)).toBe('full');
        expect(breakpointFromWidth(1439)).toBe('compact');
        expect(breakpointFromWidth(1200)).toBe('compact');
        expect(breakpointFromWidth(1199)).toBe('drawer');
        expect(breakpointFromWidth(1024)).toBe('drawer');
        expect(breakpointFromWidth(1023)).toBe('review');
    });

    it('keeps the normative panel sizes', () => {
        expect(LAYOUT.rail).toBe(64);
        expect(LAYOUT.appBar).toBe(56);
        expect(LAYOUT.contextDefault).toBe(304);
        expect(LAYOUT.inspectorDefault).toBe(360);
        expect(LAYOUT.simulationDefault).toBe(240);
        expect(LAYOUT.canvasMin).toBe(640);
    });
});

describe('collapsible panels (CdCF §6.1)', () => {
    it('drops folded tracks so the canvas can expand', () => {
        expect(shellTracks(true, true)).toBe('full');
        expect(shellTracks(true, false)).toBe('left-only');
        expect(shellTracks(false, true)).toBe('right-only');
        expect(shellTracks(false, false)).toBe('canvas');
    });
});

describe('studio routes', () => {
    it('assigns a splat so /missions does not warn that no route matched', () => {
        const source = readFileSync(resolve(ROOT, 'frontend/src/app/AppShell.tsx'), 'utf8');
        expect(source).toContain('path="*"');
    });

    it('hosts the field inspector on /parcellaire and keeps the mission inspector elsewhere', () => {
        const source = readFileSync(resolve(ROOT, 'frontend/src/app/AppShell.tsx'), 'utf8');
        expect(source).toContain('FieldInspector');
        expect(source).toContain('FieldsPanel');
        const fieldsPanel = readFileSync(
            resolve(ROOT, 'frontend/src/fields/FieldsPanel.tsx'),
            'utf8',
        );
        expect(fieldsPanel).toContain('FieldsContextPanel');
        expect(source).toContain('FieldsToolbar');
        expect(source).toContain("current.id === 'fields'");
        expect(source).toContain('Tooltip content={label} side="right"');
        expect(source).toContain('tooltipSide="right"');
        expect(source).toContain('SectionEditPanel');
        expect(source).toContain('fields.insertVertex');
        expect(source).toContain('fields.handleMapDblClick');
        expect(source).toContain('fields.setInteractive(onFields)');
        expect(source).toContain('fields.cancelDraft()');
        expect(source).toContain('EquipmentTwinView');
        expect(source).toContain("current.id === 'equipment'");
        expect(source).toContain('MissionAssistant');
        expect(source).toContain("current.id === 'missions'");
        expect(source).toContain('fields.moveVertex');
        const canvas = readFileSync(resolve(ROOT, 'frontend/src/map/MapCanvas.tsx'), 'utf8');
        expect(canvas).toContain('dblClickEnabled');
        expect(canvas).toContain('Boolean(onMapDblClick)');
        expect(source).toContain('overlayLeft');
        expect(source).toContain('overlayRight');
        expect(source).toContain('studio-context-scrim');
        expect(source).toContain('fields.selectedFeatureId');
        expect(source).toContain('fields.childrenByField');
        expect(source).toContain('showCatalogue');
        const catalogue = readFileSync(
            resolve(ROOT, 'frontend/src/fields/useFieldCatalogue.ts'),
            'utf8',
        );
        expect(catalogue).toContain('interactiveRef.current');
        expect(catalogue).toContain('setInteractive');
        const toolbar = readFileSync(
            resolve(ROOT, 'frontend/src/fields/FieldsToolbar.tsx'),
            'utf8',
        );
        expect(toolbar).toContain('studio-map-tools');
        expect(toolbar).toContain('disabled={!canFinish}');
        const shellCss = readFileSync(resolve(ROOT, 'frontend/src/styles/shell.css'), 'utf8');
        expect(shellCss).toContain('.studio-context.is-overlay');
        expect(shellCss).toContain('.studio-inspector.is-overlay');
        expect(shellCss).toContain('.studio-canvas:has(.studio-twin)');
        expect(shellCss).not.toContain(".studio-shell[data-breakpoint='review'] .studio-context,");
    });

    it('hosts the section edit inspector when a selection exists', () => {
        const source = readFileSync(resolve(ROOT, 'frontend/src/app/AppShell.tsx'), 'utf8');
        expect(source).toContain('SectionEditPanel');
        expect(source).toContain('selectedIndices.length > 0');
        expect(source).toContain('OffsetDialog');
        expect(source).toContain('onBeginSelectionDrag');
        expect(source).toContain('hitSelectedSection');
    });

    it('drags a selected section on the map without going through the inspector pad', () => {
        const canvas = readFileSync(resolve(ROOT, 'frontend/src/map/MapCanvas.tsx'), 'utf8');
        expect(canvas).toContain('onBeginSelectionDrag');
        expect(canvas).toContain('setDragPanEnabled');
        expect(canvas).toContain('dataset.selectionHit');
        expect(canvas).toContain('dataset.selectionDrag');
        const editor = readFileSync(resolve(ROOT, 'frontend/src/map/useMissionEditor.ts'), 'utf8');
        expect(editor).toContain('beginSelectionDrag');
        expect(editor).toContain('localDelta');
        expect(editor).toContain('moveSections');
    });

    it('hosts the L9a mission tree, inspector accordion and live metrics', () => {
        const shell = readFileSync(resolve(ROOT, 'frontend/src/app/AppShell.tsx'), 'utf8');
        expect(shell).toContain('app.compare');
        expect(shell).toContain('readMissionContext');
        expect(shell).toContain('simulateMission');
        expect(shell).toContain('oddContext');
        expect(shell).toContain('gnssDegradedRings');
        expect(shell).toContain('rowLabelMode');
        const drawer = readFileSync(
            resolve(ROOT, 'frontend/src/simulation/SimulationDrawer.tsx'),
            'utf8',
        );
        expect(drawer).toContain('playbackIndexAtTime');
        expect(drawer).toContain('elapsed +=');
        expect(drawer).toContain('sim.footprintHint');
        expect(shell).toContain('CompareDialog');
        expect(shell).toContain('PublishDialog');
        // ReportsPanel and PublicationPanel left the shell in L13: they are remounted
        // inside the simulation and mission panels, not routed from the rail.
        expect(shell).not.toContain("current.id === 'reports'");
        expect(shell).not.toContain("current.id === 'publication'");
        expect(shell).toContain('workingWidthM');
        expect(shell).toContain('app.save');
        expect(shell).toContain('saveNow');
        expect(shell).toContain('hasWorkingDocument');
        expect(shell).toContain('autoSimKeyRef');
        expect(shell).toContain("module.id === 'simulation'");
        expect(shell).toContain('onRun={runSimulation}');
        expect(shell).toContain('app.blockers');
        expect(shell).toContain('metrics.strip');
        expect(shell).toContain('buildMissionTree');
        expect(shell).toContain('Accordion');
        expect(shell).toContain('inspector.accordion.geometry');
        const assistant = readFileSync(
            resolve(ROOT, 'frontend/src/missions/MissionAssistant.tsx'),
            'utf8',
        );
        expect(assistant).toContain('MissionTree');
        expect(assistant).toContain('Accordion');
        expect(assistant).toContain('PacksPanel');
        expect(assistant).toContain('TeachRepeatDialog');
        expect(assistant).toContain('map.draftNotListed');
        const editor = readFileSync(resolve(ROOT, 'frontend/src/map/useMissionEditor.ts'), 'utf8');
        expect(editor).toContain('selectIndices');
        expect(editor).toContain('reorderSelected');
        expect(editor).toContain('reorderTo');
        expect(editor).toContain('toggleHidden');
        expect(editor).toContain('toggleLocked');
        const css = readFileSync(resolve(ROOT, 'frontend/src/styles/shell.css'), 'utf8');
        expect(css).toContain('.studio-tree-row');
        const treeUi = readFileSync(resolve(ROOT, 'frontend/src/missions/MissionTree.tsx'), 'utf8');
        expect(treeUi).toContain('tree.lock');
        expect(treeUi).toContain('draggable');
        expect(treeUi).toContain('EyeOff');
        expect(treeUi).toContain('LockOpen');
        expect(css).toContain('.studio-metrics-strip');
        expect(css).toContain('.studio-row-label');
        expect(css).toContain('.studio-packs');
        expect(css).toContain('.studio-sim-empty');
        expect(css).toContain('.studio-place-search-toolbar');
        const search = readFileSync(resolve(ROOT, 'frontend/src/map/PlaceSearch.tsx'), 'utf8');
        expect(search).toContain('studio-metrics-strip');
    });
});
