/**
 * Utility for displaying confirmation dialogs
 * Uses the confirmDialog modal instead of window.confirm()
 */
class ConfirmDialog {
    /**
     * Display a confirmation dialog
     * @param {string} messageKey - Translation key for the message
     * @param {string} titleKey - Translation key for the title (optional, default: 'confirm.title')
     * @param {Object} messageParams - Parameters for the message (optional)
     * @returns {Promise<boolean>} true if confirmed, false if canceled
     */
    static async show(messageKey, titleKey = 'confirm.title', messageParams = {}) {
        return new Promise((resolve) => {
            const dialog = document.getElementById('confirmDialog');
            const titleEl = document.getElementById('confirmTitle');
            const messageEl = document.getElementById('confirmMessage');
            const okBtn = document.getElementById('confirmOk');
            const cancelBtn = document.getElementById('confirmCancel');

            if (!dialog || !titleEl || !messageEl || !okBtn || !cancelBtn) {
                // Fall back to confirm if elements do not exist
                console.warn('[ConfirmDialog] Confirmation dialog elements not found, falling back to window.confirm()');
                const t = window.i18n ? window.i18n.t.bind(window.i18n) : (key) => key;
                const message = t(messageKey, messageParams);
                const title = t(titleKey);
                resolve(confirm(`${title}\n\n${message}`));
                return;
            }

            // Translate the title and message
            const t = window.i18n ? window.i18n.t.bind(window.i18n) : (key) => key;
            titleEl.textContent = t(titleKey);
            messageEl.textContent = t(messageKey, messageParams);

            // Translate the buttons
            okBtn.textContent = t('confirm.ok');
            cancelBtn.textContent = t('confirm.cancel');

            // Show the dialog
            dialog.style.display = 'flex';

            const cleanup = () => {
                dialog.style.display = 'none';
                okBtn.removeEventListener('click', onOk);
                cancelBtn.removeEventListener('click', onCancel);
            };

            const onOk = () => {
                cleanup();
                resolve(true);
            };

            const onCancel = () => {
                cleanup();
                resolve(false);
            };

            okBtn.addEventListener('click', onOk);
            cancelBtn.addEventListener('click', onCancel);
        });
    }
}

// Export for global use
window.ConfirmDialog = ConfirmDialog;
