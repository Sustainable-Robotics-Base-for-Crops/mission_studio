/**
 * View for the side panel
 * Handles the display of trajectory properties, section list, and edit panel
 */
class PanelView {
    constructor() {
        this.sectionEditPanel = null;
        this.sectionEditButtonsSetup = false; // Flag to prevent configuring listeners multiple times
    }

    /**
     * Update the trajectory properties in the panel
     * @param {Object} trajectory - Trajectory
     */
    updateTrajectoryProperties(trajectory) {
        const fileNameInput = document.getElementById('fileName');
        const vehicleIdInput = document.getElementById('vehicleId');
        const fileTypeSelect = document.getElementById('fileType');

        if (fileNameInput) {
            fileNameInput.value = trajectory.filename || 'new_trajectory.json';
        }
        if (vehicleIdInput) {
            vehicleIdInput.value = trajectory.vehicle_id || 'v1';
        }
        if (fileTypeSelect) {
            fileTypeSelect.value = trajectory.file_type || 'draft';
        }
    }

    /**
     * Update the section list
     * @param {Object} trajectory - Trajectory
     * @param {Array<number>} selectedIndices - Selected section indices
     * @param {Function} onSectionClick - Callback for section click
     * @param {Function} onSectionEdit - Callback to edit a section
     * @param {Function} onSectionDelete - Callback to delete a section
     * @param {Function} onSectionReorder - Callback when a section is reordered (fromIndex, toIndex)
     */
    updateSectionsList(trajectory, selectedIndices = [], onSectionClick, onSectionEdit, onSectionDelete, onSectionReorder) {
        const sectionsList = document.getElementById('sectionsList');
        const sectionCount = document.getElementById('sectionCount');

        if (!sectionsList) return;

        const selCount = selectedIndices.length;
        if (sectionCount) {
            sectionCount.textContent = trajectory.points.length +
                (selCount > 1 ? ` (${selCount} sélectionnées)` : '');
        }

        sectionsList.innerHTML = '';

        if (!trajectory.points || trajectory.points.length === 0) {
            return;
        }

        const t = (key, fallback) => (window.i18n && window.i18n.t ? window.i18n.t(key) : fallback) || fallback;
        const dragHandleTitle = t('sectionEdit.dragHandle', 'Drag to reorder');

        // Shared state for the in-progress drag. We compute the target position as a "gap"
        // (insertBefore index) rather than a row index, so the visual indicator and the
        // splice math both refer to the same thing: the space between two sections.
        const dragState = { fromIndex: -1, insertAt: -1 };
        const reorderEnabled = typeof onSectionReorder === 'function';

        const clearDropIndicators = () => {
            sectionsList.querySelectorAll('.section-item.drop-before, .section-item.drop-after')
                .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
        };

        const setInsertAt = (insertAt) => {
            dragState.insertAt = insertAt;
            clearDropIndicators();
            const rows = sectionsList.querySelectorAll('.section-item');
            if (insertAt >= rows.length) {
                const last = rows[rows.length - 1];
                if (last) last.classList.add('drop-after');
                return;
            }
            const target = rows[insertAt];
            if (target) target.classList.add('drop-before');
        };

        trajectory.points.forEach((section, index) => {
            const item = document.createElement('div');
            const isSelected = selectedIndices.includes(index);
            const isTurn = section.section_type === 'turn_path' || section.section_type === 'turn_square';

            item.className = `section-item ${isSelected ? 'selected' : ''} ${isTurn ? 'turn' : ''}`;
            item.dataset.sectionIndex = String(index);
            if (reorderEnabled) {
                item.setAttribute('draggable', 'true');
            }

            item.innerHTML = `
                <span class="section-drag-handle" title="${dragHandleTitle}" aria-hidden="true">
                    <i class="material-icons">drag_indicator</i>
                </span>
                <div class="section-info">
                    <div class="section-title">${isTurn ? '↺ Demi-tour' : '→ Section'} ${index + 1}</div>
                    <div class="section-details">${section.values.length} pts</div>
                </div>
                <div class="section-actions">
                    <button class="section-action edit-btn" title="Modifier">
                        <i class="material-icons">edit</i>
                    </button>
                    <button class="section-action delete-btn" title="Supprimer">
                        <i class="material-icons">delete</i>
                    </button>
                </div>
            `;

            // Click on section (except on action buttons or right after a drop)
            item.addEventListener('click', (e) => {
                if (item.dataset.suppressNextClick === 'true') {
                    delete item.dataset.suppressNextClick;
                    return;
                }
                if (e.target.closest('.section-action')) {
                    return;
                }
                if (onSectionClick) {
                    onSectionClick(index);
                }
            });

            // Edit button
            const editBtn = item.querySelector('.edit-btn');
            if (editBtn && onSectionEdit) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onSectionEdit(index);
                });
            }

            // Delete button
            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn && onSectionDelete) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onSectionDelete(index);
                });
            }

            // Drag-and-drop reordering: the entire row is draggable, the handle icon
            // is purely a visual hint. Action buttons stop their own clicks so they
            // never trigger a drag accidentally.
            if (reorderEnabled) {
                item.addEventListener('dragstart', (e) => {
                    dragState.fromIndex = index;
                    dragState.insertAt = index;
                    item.classList.add('dragging');
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        // Required for Firefox to actually start the drag.
                        try { e.dataTransfer.setData('text/plain', String(index)); } catch (_) { /* noop */ }
                    }
                });

                item.addEventListener('dragend', () => {
                    item.classList.remove('dragging');
                    clearDropIndicators();
                    dragState.fromIndex = -1;
                    dragState.insertAt = -1;
                });

                item.addEventListener('dragover', (e) => {
                    if (dragState.fromIndex < 0) return;
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    const rect = item.getBoundingClientRect();
                    const isBefore = (e.clientY - rect.top) < rect.height / 2;
                    // Translate "drop on the top/bottom half of row N" to "insert in gap K"
                    // where K is the number of rows that should sit before the dragged one.
                    let insertAt = isBefore ? index : index + 1;
                    if (insertAt === dragState.fromIndex || insertAt === dragState.fromIndex + 1) {
                        // Hovering above or just below the dragged row → no real move.
                        clearDropIndicators();
                        dragState.insertAt = dragState.fromIndex;
                        return;
                    }
                    setInsertAt(insertAt);
                });

                item.addEventListener('drop', (e) => {
                    if (dragState.fromIndex < 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    item.dataset.suppressNextClick = 'true';
                    const fromIndex = dragState.fromIndex;
                    const insertAt = dragState.insertAt;
                    // Convert insertAt (pre-removal gap index) to splice toIndex (post-removal).
                    const toIndex = fromIndex < insertAt ? insertAt - 1 : insertAt;
                    if (toIndex !== fromIndex) {
                        onSectionReorder(fromIndex, toIndex);
                    }
                });
            }

            sectionsList.appendChild(item);
        });

        // Container-level handlers cover the case where the cursor is in the gap below the
        // last row (so no item receives dragover), and let us drop "at the very end".
        if (reorderEnabled && !sectionsList.dataset.reorderBound) {
            sectionsList.dataset.reorderBound = 'true';

            sectionsList.addEventListener('dragover', (e) => {
                if (dragState.fromIndex < 0) return;
                // Only handle the trailing gap: defer to per-item handlers when the cursor
                // is actually over a row.
                if (e.target.closest('.section-item')) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                const total = sectionsList.querySelectorAll('.section-item').length;
                if (total === 0) return;
                if (dragState.fromIndex === total - 1) {
                    clearDropIndicators();
                    dragState.insertAt = dragState.fromIndex;
                    return;
                }
                setInsertAt(total);
            });

            sectionsList.addEventListener('drop', (e) => {
                if (dragState.fromIndex < 0) return;
                if (e.target.closest('.section-item')) return;
                e.preventDefault();
                const fromIndex = dragState.fromIndex;
                const insertAt = dragState.insertAt;
                const toIndex = fromIndex < insertAt ? insertAt - 1 : insertAt;
                if (toIndex !== fromIndex) {
                    onSectionReorder(fromIndex, toIndex);
                }
            });
        }
    }

    /**
     * Update the instruction card
     * @param {string} editMode - Current edit mode
     * @param {number} tempPointsCount - Number of temporary points
     * @param {Object} i18n - i18n object for translations
     */
    updateInstructionCard(editMode, tempPointsCount = 0, i18n = null) {
        const card = document.getElementById('instructionCard');
        const text = document.getElementById('instructionText');

        if (!card || !text) return;

        const t = (key) => i18n && i18n.t ? i18n.t(key) : key;

        let message = '';
        let bgColor = '#34495e';

        // Check whether the section edit panel is open
        const sectionEditPanel = document.getElementById('sectionEditPanel');
        if (sectionEditPanel && sectionEditPanel.style.display !== 'none') {
            // While inside section editing, override the instruction when the user
            // is actively placing the new endpoint of an extension.
            if (editMode === 'extend_section') {
                message = tempPointsCount === 0
                    ? t('instruction.extendSectionPlace')
                    : t('instruction.extendSectionConfirm');
                bgColor = '#FF9800';
            } else {
                message = t('instruction.editSection');
                bgColor = '#F44336'; // Red for section editing (section selection red)
            }
            text.textContent = message;
            const contentEl = card.querySelector('.instruction-content');
            if (contentEl) {
                contentEl.style.backgroundColor = bgColor;
            }
            return;
        }

        switch (editMode) {
            case 'draw_line':
                message = t('instruction.drawLine');
                bgColor = 'var(--trajectory-green)';
                break;
            case 'draw_parcel':
                message = t('instruction.drawParcel');
                bgColor = 'var(--trajectory-blue)';
                break;
            case 'select_zone':
                message = t('instruction.selectSections');
                bgColor = '#F44336';
                break;
            case 'select_sections_polygon':
                message = tempPointsCount < 3
                    ? t('instruction.selectSectionsZonePlace')
                    : t('instruction.selectSectionsZoneConfirm');
                bgColor = '#3F51B5';
                break;
            case 'geofence':
                message = t('instruction.geofence');
                bgColor = 'var(--trajectory-orange)';
                break;
            case 'edit_working_zone':
                message = tempPointsCount < 3
                    ? 'Cliquez pour dessiner la zone (au moins 3 points). Puis validez et choisissez working_zone 1 ou 0.'
                    : 'Cliquez sur « Valider la zone » puis choisissez zone de travail (1) ou hors zone (0).';
                bgColor = '#FF9800';
                break;
            case 'delete_points_zone':
                message = tempPointsCount < 3
                    ? 'Cliquez pour dessiner la zone (au moins 3 points). Validez pour supprimer les points dans la zone (sections tronquées ou découpées).'
                    : 'Cliquez sur « Valider » pour confirmer la suppression des points dans la zone.';
                bgColor = '#F44336';
                break;
            case 'ruler':
                message = tempPointsCount === 0
                    ? 'Cliquez le premier point de la règle.'
                    : 'Cliquez le deuxième point. La distance restera affichée (hors fichier trajectoire).';
                bgColor = '#9C27B0';
                break;
            default:
                message = t('instruction.selectMode');
                bgColor = 'var(--trajectory-dark-gray)';
        }

        text.textContent = message;
        const contentEl = card.querySelector('.instruction-content');
        if (contentEl) {
            contentEl.style.backgroundColor = bgColor;
        }
    }

    /**
     * Update the validation buttons
     * @param {string} editMode - Edit mode
     * @param {number} tempPointsCount - Number of temporary points
     * @param {boolean} hasGeofencing - Whether geofencing is present
     * @param {boolean} hasRuler - Whether ruler is present
     * @param {number} selectedSectionsCount - Number of selected sections (optional)
     * @param {boolean} isSectionEditPanelOpen - If the section edit panel is open (optional)
     */
    updateValidationButtons(editMode, tempPointsCount = 0, hasGeofencing = false, hasRuler = false, selectedSectionsCount = 0, isSectionEditPanelOpen = false) {
        const validationButtons = document.getElementById('validationButtons');
        const finishDrawLineBtn = document.getElementById('finishDrawLineBtn');
        const finishGeofenceBtn = document.getElementById('finishGeofenceBtn');
        const finishEditWorkingZoneBtn = document.getElementById('finishEditWorkingZoneBtn');
        const cancelEditActionBtn = document.getElementById('cancelEditActionBtn');
        const finishDeletePointsZoneBtn = document.getElementById('finishDeletePointsZoneBtn');
        const clearGeofenceBtn = document.getElementById('clearGeofenceBtn');
        const clearRulerBtn = document.getElementById('clearRulerBtn');
        const finishSelectSectionsBtn = document.getElementById('finishSelectSectionsBtn');
        const finishSelectSectionsPolygonBtn = document.getElementById('finishSelectSectionsPolygonBtn');
        const deleteSelectedSectionsBtn = document.getElementById('deleteSelectedSectionsBtn');
        if (!validationButtons) return;

        // Les libellés dynamiques incluent un compteur, ils doivent donc passer par i18n ici.
        const t = window.i18n ? window.i18n.t.bind(window.i18n) : (key, params = {}) => {
            const fallbackLabels = {
                'validation.finishLineWithCount': `Finish Line (${params.count} points)`,
                'validation.generateRowsWithCount': `Generate Rows (${params.count} points)`,
                'validation.finishSelectSections': `Finish Selection (${params.count} section${params.plural || ''})`
            };
            return fallbackLabels[key] || key;
        };
        const getPointPlural = (count) => (count > 1 ? 's' : '');

        // Hide all buttons by default
        validationButtons.style.display = 'none';
        if (finishDrawLineBtn) finishDrawLineBtn.style.display = 'none';
        if (finishGeofenceBtn) finishGeofenceBtn.style.display = 'none';
        if (finishEditWorkingZoneBtn) finishEditWorkingZoneBtn.style.display = 'none';
        if (cancelEditActionBtn) cancelEditActionBtn.style.display = 'none';
        if (finishDeletePointsZoneBtn) finishDeletePointsZoneBtn.style.display = 'none';
        if (clearGeofenceBtn) clearGeofenceBtn.style.display = 'none';
        if (clearRulerBtn) clearRulerBtn.style.display = 'none';
        if (finishSelectSectionsBtn) finishSelectSectionsBtn.style.display = 'none';
        if (finishSelectSectionsPolygonBtn) finishSelectSectionsPolygonBtn.style.display = 'none';
        if (deleteSelectedSectionsBtn) deleteSelectedSectionsBtn.style.display = 'none';

        // Show buttons according to the mode
        if (editMode === 'draw_line') {
            validationButtons.style.display = 'block';
            if (cancelEditActionBtn) {
                cancelEditActionBtn.style.display = 'block';
            }
            if (tempPointsCount >= 2 && finishDrawLineBtn) {
                finishDrawLineBtn.style.display = 'block';
                finishDrawLineBtn.innerHTML = `<i class="material-icons">check</i> <span>${t('validation.finishLineWithCount', { count: tempPointsCount, plural: getPointPlural(tempPointsCount) })}</span>`;
            }
        } else if (editMode === 'draw_parcel') {
            validationButtons.style.display = 'block';
            if (cancelEditActionBtn) {
                cancelEditActionBtn.style.display = 'block';
            }
            if (tempPointsCount >= 3 && finishDrawLineBtn) {
                finishDrawLineBtn.style.display = 'block';
                finishDrawLineBtn.innerHTML = `<i class="material-icons">check</i> <span>${t('validation.generateRowsWithCount', { count: tempPointsCount, plural: getPointPlural(tempPointsCount) })}</span>`;
            }
        } else if (editMode === 'geofence') {
            validationButtons.style.display = 'block';
            if (tempPointsCount >= 3 && finishGeofenceBtn) {
                finishGeofenceBtn.style.display = 'block';
            }
            if ((hasGeofencing || tempPointsCount > 0) && clearGeofenceBtn) {
                clearGeofenceBtn.style.display = 'block';
            }
        } else if (editMode === 'edit_working_zone') {
            validationButtons.style.display = 'block';
            // Cancellation remains available before validation to discard temporary points.
            if (cancelEditActionBtn) {
                cancelEditActionBtn.style.display = 'block';
            }
            if (tempPointsCount >= 3 && finishEditWorkingZoneBtn) {
                finishEditWorkingZoneBtn.style.display = 'block';
            }
        } else if (editMode === 'delete_points_zone') {
            validationButtons.style.display = 'block';
            if (cancelEditActionBtn) {
                cancelEditActionBtn.style.display = 'block';
            }
            if (tempPointsCount >= 3 && finishDeletePointsZoneBtn) {
                finishDeletePointsZoneBtn.style.display = 'block';
            }
        } else if (editMode === 'select_sections_polygon') {
            validationButtons.style.display = 'block';
            if (cancelEditActionBtn) {
                cancelEditActionBtn.style.display = 'block';
            }
            if (tempPointsCount >= 3 && finishSelectSectionsPolygonBtn) {
                finishSelectSectionsPolygonBtn.style.display = 'block';
            }
        } else if (editMode === 'select_zone') {
            // Zone selection mode: show validation and delete buttons when sections are selected
            if (selectedSectionsCount > 0 && finishSelectSectionsBtn) {
                validationButtons.style.display = 'block';
                finishSelectSectionsBtn.style.display = 'block';
                // Update the text with the section count
                const plural = selectedSectionsCount > 1 ? 's' : '';
                finishSelectSectionsBtn.innerHTML = `<i class="material-icons">check</i> <span>${t('validation.finishSelectSections', { count: selectedSectionsCount, plural })}</span>`;
                deleteSelectedSectionsBtn.style.display = 'block';
            }
        }

        if (hasRuler && clearRulerBtn) {
            validationButtons.style.display = 'block';
            clearRulerBtn.style.display = 'block';
        }
    }

    /**
     * Show the section edit panel in the left panel
     * @param {Object} section - Section to edit
     * @param {number} index - Section index
     * @param {Function} onClose - Close callback
     */
    showSectionEditPanel(section, index, onClose) {
        const mainPanel = document.getElementById('mainPanel');
        const sectionEditPanel = document.getElementById('sectionEditPanel');

        if (!mainPanel || !sectionEditPanel) {
            console.warn('[PanelView] Section edit panel elements not found');
            return;
        }

        // Update the title with the section number
        this.updateSectionEditTitle(index + 1, 1);

        // Hide normal sections and show the edit panel
        mainPanel.classList.add('hide-sections');
        sectionEditPanel.style.display = 'block';

        // Store the close callback and section index
        this.onSectionEditClose = onClose;
        this.currentEditIndex = index;

        // Initialize values from the editor
        const editor = window.trajectoryEditor;
        const moveStepInput = document.getElementById('panelMoveStep');
        const rotationStepInput = document.getElementById('panelRotationStep');
        const rotationValue = document.getElementById('panelRotationValue');

        if (moveStepInput && editor) {
            moveStepInput.value = editor.moveStep || '0.5';
        }
        if (rotationStepInput && editor) {
            rotationStepInput.value = editor.rotationStep || '5';
        }
        if (rotationValue && editor) {
            editor.currentRotationAngle = 0;
            rotationValue.textContent = '0°';
        }

        // Update move step display
        this.updateMoveStepDisplay();

        // Show copy/paste, reverse and extend blocks
        const copyBlock = document.getElementById('panelCopyPasteSection');
        const reverseBlock = document.getElementById('panelReverseSection');
        const extendBlock = document.getElementById('panelExtendSection');
        if (copyBlock) copyBlock.style.display = 'block';
        if (reverseBlock) reverseBlock.style.display = 'block';
        if (extendBlock) extendBlock.style.display = 'block';
        // Reset the extend sub-block to its inactive state (picker visible, apply hidden)
        this.setExtendSectionUIState(false);

        // Configure edit panel buttons
        this.setupSectionEditButtons();

        // IMPORTANT: Re-translate all elements after cloning
        // because cloneNode(true) also clones textContent, which may be stale
        if (window.trajectoryEditor && window.trajectoryEditor.updateTranslations) {
            window.trajectoryEditor.updateTranslations();
        }

        // Update the instruction card to show section editing instructions
        const i18n = window.i18n || null;
        this.updateInstructionCard('none', 0, i18n);

        // Invalidate the map size so it adjusts
        if (window.trajectoryEditor && window.trajectoryEditor.mapController) {
            const map = window.trajectoryEditor.mapController.getMap();
            if (map) {
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }
        }
    }

    /**
     * Configure the buttons in the section edit panel
     * @private
     */
    setupSectionEditButtons() {
        const editor = window.trajectoryEditor;
        if (!editor) return;

        // Configure listeners only once
        if (this.sectionEditButtonsSetup) return;

        // "Finish Edit" button
        const finishBtn = document.getElementById('finishSectionEdit');

        if (finishBtn) {
            finishBtn.addEventListener('click', () => {
                // Call the callback that will deselect sections and hide the panel
                if (this.onSectionEditClose) {
                    this.onSectionEditClose();
                } else {
                    // Fallback: hide the panel if there is no callback
                    this.hideSectionEditPanel();
                }
            });
        }

        // Movement buttons
        const moveUpBtn = document.getElementById('panelMoveUp');
        const moveDownBtn = document.getElementById('panelMoveDown');
        const moveLeftBtn = document.getElementById('panelMoveLeft');
        const moveRightBtn = document.getElementById('panelMoveRight');

        if (moveUpBtn) {
            moveUpBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length > 0) {
                    editor.moveSelectedSections(0, editor.getMoveStep());
                }
            });
        }

        if (moveDownBtn) {
            moveDownBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length > 0) {
                    editor.moveSelectedSections(0, -editor.getMoveStep());
                }
            });
        }

        if (moveLeftBtn) {
            moveLeftBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length > 0) {
                    editor.moveSelectedSections(-editor.getMoveStep(), 0);
                }
            });
        }

        if (moveRightBtn) {
            moveRightBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length > 0) {
                    editor.moveSelectedSections(editor.getMoveStep(), 0);
                }
            });
        }

        // Rotation buttons
        const rotatePlusBtn = document.getElementById('panelRotatePlus');
        const rotateMinusBtn = document.getElementById('panelRotateMinus');

        if (rotatePlusBtn) {
            rotatePlusBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length > 0) {
                    editor.rotateSelectedSections(editor.getRotationStep());
                }
            });
        }

        if (rotateMinusBtn) {
            rotateMinusBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length > 0) {
                    editor.rotateSelectedSections(-editor.getRotationStep());
                }
            });
        }

        // Duplicate button
        const pastePerpBtn = document.getElementById('duplicateSectionBtn');
        if (pastePerpBtn) {
            pastePerpBtn.addEventListener('click', () => {
                const input = document.getElementById('duplicateSectionDistance');
                const countInput = document.getElementById('duplicateSectionCount');
                const sideEl = document.getElementById('duplicateSectionSide');
                const dist = input ? parseFloat(input.value) : 2.5;
                // Keep the UI tolerant: invalid counts fall back to one duplicated section.
                const count = countInput ? parseInt(countInput.value, 10) : 1;
                const side = (sideEl && sideEl.value === 'right') ? 'right' : 'left';
                editor.duplicateSectionAtDistance(isNaN(dist) ? 2.5 : dist, side, isNaN(count) ? 1 : count);
            });
        }

        // Reverse button
        const reverseBtn = document.getElementById('panelReverseSectionBtn');
        if (reverseBtn) {
            reverseBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndices && editor.selectedSectionIndices.length === 1) {
                    editor.reverseSectionPoints(editor.selectedSectionIndices[0]);
                }
            });
        }

        // Extend section buttons (start, end, apply, cancel)
        const extendStartBtn = document.getElementById('panelExtendStartBtn');
        if (extendStartBtn) {
            extendStartBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndex !== null && editor.selectedSectionIndex !== undefined) {
                    editor.startExtendSection('start');
                }
            });
        }

        const extendEndBtn = document.getElementById('panelExtendEndBtn');
        if (extendEndBtn) {
            extendEndBtn.addEventListener('click', () => {
                if (editor.selectedSectionIndex !== null && editor.selectedSectionIndex !== undefined) {
                    editor.startExtendSection('end');
                }
            });
        }

        const extendApplyBtn = document.getElementById('panelExtendSectionApply');
        if (extendApplyBtn) {
            extendApplyBtn.addEventListener('click', () => editor.finishExtendSection());
        }

        const extendCancelBtn = document.getElementById('panelExtendSectionCancel');
        if (extendCancelBtn) {
            extendCancelBtn.addEventListener('click', () => editor.cancelExtendSection());
        }

        // Step inputs
        const moveStepInput = document.getElementById('panelMoveStep');
        const rotationStepInput = document.getElementById('panelRotationStep');

        if (moveStepInput) {
            moveStepInput.addEventListener('input', () => {
                editor.setMoveStep(parseFloat(moveStepInput.value) || 0.5);
                this.updateMoveStepDisplay();
            });
        }

        if (rotationStepInput) {
            rotationStepInput.addEventListener('input', () => {
                editor.setRotationStep(parseFloat(rotationStepInput.value) || 5);
            });
        }

        // Mark as configured to avoid reconfiguring
        this.sectionEditButtonsSetup = true;
    }

    /**
     * Toggle the extend-section sub-block between "picker" (start/end choice)
     * and "active" (placement + apply/cancel) states.
     */
    setExtendSectionUIState(active) {
        const picker = document.getElementById('panelExtendSectionPicker');
        const activeBlock = document.getElementById('panelExtendSectionActive');
        if (picker) picker.style.display = active ? 'none' : 'flex';
        if (activeBlock) activeBlock.style.display = active ? 'flex' : 'none';
        if (!active) {
            const distanceEl = document.getElementById('panelExtendSectionDistance');
            const applyBtn = document.getElementById('panelExtendSectionApply');
            if (distanceEl) distanceEl.textContent = '--';
            if (applyBtn) applyBtn.disabled = true;
        }
    }

    /**
     * Update the move step display
     * @private
     */
    updateMoveStepDisplay() {
        const display = document.getElementById('panelMoveStepDisplay');
        const input = document.getElementById('panelMoveStep');
        if (display && input) {
            const value = parseFloat(input.value) || 0.5;
            display.textContent = `${value}m`;
        }
    }


    /**
     * Hide the section edit panel and restore the main panel
     */
    /**
     * Show the edit panel for multiple selected sections
     * @param {Array<number>} indices - Indices of selected sections
     * @param {Function} onClose - Close callback
     */
    showSectionEditPanelForSelection(indices, onClose) {
        if (!indices || indices.length === 0) return;

        const mainPanel = document.getElementById('mainPanel');
        const sectionEditPanel = document.getElementById('sectionEditPanel');

        if (!mainPanel || !sectionEditPanel) {
            console.warn('[PanelView] Section edit panel elements not found');
            return;
        }


        // Hide normal sections and show the edit panel
        mainPanel.classList.add('hide-sections');
        sectionEditPanel.style.display = 'block';

        // Store the close callback
        this.onSectionEditClose = onClose;
        this.currentEditIndex = null; // No unique index for multiple sections

        // Update the title with the number of sections
        this.updateSectionEditTitle(null, indices.length);

        // Initialize values from the editor
        const editor = window.trajectoryEditor;
        const moveStepInput = document.getElementById('panelMoveStep');
        const rotationStepInput = document.getElementById('panelRotationStep');
        const rotationValue = document.getElementById('panelRotationValue');

        if (moveStepInput && editor) {
            moveStepInput.value = editor.moveStep || '0.5';
        }
        if (rotationStepInput && editor) {
            rotationStepInput.value = editor.rotationStep || '5';
        }
        if (rotationValue && editor) {
            editor.currentRotationAngle = 0;
            rotationValue.textContent = '0°';
        }

        // Update move step display
        this.updateMoveStepDisplay();

        // Show/hide copy/paste and reverse blocks (only for a single section)
        const copyBlock = document.getElementById('panelCopyPasteSection');
        const reverseBlock = document.getElementById('panelReverseSection');
        if (copyBlock) copyBlock.style.display = indices.length === 1 ? 'block' : 'none';
        if (reverseBlock) reverseBlock.style.display = indices.length === 1 ? 'block' : 'none';

        // Configure edit panel buttons
        this.setupSectionEditButtons();

        // IMPORTANT: Re-translate all elements after cloning
        // because cloneNode(true) also clones textContent, which may be stale
        if (window.trajectoryEditor && window.trajectoryEditor.updateTranslations) {
            window.trajectoryEditor.updateTranslations();
        }

        // Update the instruction card to show section editing instructions
        const i18n = window.i18n || null;
        this.updateInstructionCard('none', 0, i18n);

        // Invalidate the map size so it adjusts
        if (window.trajectoryEditor && window.trajectoryEditor.mapController) {
            const map = window.trajectoryEditor.mapController.getMap();
            if (map) {
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }
        }
    }

    hideSectionEditPanel() {
        const mainPanel = document.getElementById('mainPanel');
        const sectionEditPanel = document.getElementById('sectionEditPanel');

        if (mainPanel) {
            mainPanel.classList.remove('hide-sections');
        }

        if (sectionEditPanel) {
            sectionEditPanel.style.display = 'none';
        }

        // Force the section list to be displayed again
        const sectionsList = document.getElementById('sectionsList');
        if (sectionsList && sectionsList.parentElement) {
            const panelSection = sectionsList.closest('.panel-section');
            if (panelSection) {
                panelSection.style.display = '';
            }
        }

        // Invalidate the map size so it adjusts
        if (window.trajectoryEditor && window.trajectoryEditor.mapController) {
            const map = window.trajectoryEditor.mapController.getMap();
            if (map) {
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            }
        }

        this.onSectionEditClose = null;
    }

    /**
     * Update the section edit panel title
     * @param {number|null} sectionNumber - Section number (if only one section) or null
     * @param {number} count - Number of selected sections
     */
    updateSectionEditTitle(sectionNumber, count) {
        const titleElement = document.getElementById('panelSectionEditTitle');
        if (!titleElement || !window.i18n) return;

        let titleKey, titleParams;

        if (count === 1 && sectionNumber !== null) {
            // Single section: "Edit Section x"
            titleKey = 'sectionEdit.title';
            titleParams = { number: sectionNumber };
        } else {
            // Multiple sections: "Edit x Sections"
            titleKey = 'sectionEdit.titleMultiple';
            titleParams = { count: count };
        }

        // Update the title with the translation
        titleElement.textContent = window.i18n.t(titleKey, titleParams);
    }
}

// Export for global use
window.PanelView = PanelView;
