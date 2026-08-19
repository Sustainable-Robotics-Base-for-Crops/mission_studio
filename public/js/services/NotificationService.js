/**
 * Notification management service
 */

class NotificationService {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Create the notification container if it does not exist
        this.container = document.getElementById('notificationContainer');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'notificationContainer';
            this.container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; max-width: 400px;';
            document.body.appendChild(this.container);
        }
    }

    /**
     * Show a notification
     * @param {string} message - Message to display (can be a translation key starting with 'notification.')
     * @param {string} type - Notification type ('success', 'error', 'warning', 'info')
     * @param {number} duration - Display duration in ms (0 = permanent)
     * @param {Object} params - Translation parameters (optional)
     */
    show(message, type = 'info', duration = 3000, params = {}) {
        // Translate the message if i18n is available and the message is a translation key
        let translatedMessage = message;
        if (window.i18n && typeof message === 'string') {
            // If the message starts with 'notification.', it is a translation key
            if (message.startsWith('notification.')) {
                try {
                    translatedMessage = window.i18n.t(message, params);
                    // If the translation returns the key itself (not found), log a warning
                    if (translatedMessage === message) {
                        console.warn('[NotificationService] Translation not found for:', message);
                    }
                } catch (e) {
                    console.error('[NotificationService] Translation error for', message, e);
                    translatedMessage = message; // Fall back to the original message
                }
            }
        }
        
        const notification = document.createElement('div');
        // Use two separate classes to match the CSS: .notification.success
        notification.className = `notification ${type}`;
        // Do not use inline styles so CSS can handle the appearance
        // Only keep animation styles that are not in the CSS
        notification.textContent = translatedMessage;

        this.container.appendChild(notification);

        // Remove after the specified duration
        if (duration > 0) {
            setTimeout(() => {
                notification.classList.add('hiding');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, duration);
        }

        return notification;
    }


    /**
     * Show a success notification
     * @param {string} message - Message to display
     * @param {number} duration - Display duration in ms
     */
    success(message, duration = 3000) {
        return this.show(message, 'success', duration);
    }

    /**
     * Show an error notification
     * @param {string} message - Message to display
     * @param {number} duration - Display duration in ms
     */
    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    /**
     * Show a warning notification
     * @param {string} message - Message to display
     * @param {number} duration - Display duration in ms
     */
    warning(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    }

    /**
     * Show an info notification
     * @param {string} message - Message to display
     * @param {number} duration - Display duration in ms
     */
    info(message, duration = 3000) {
        return this.show(message, 'info', duration);
    }
}

// Export the class and create a global instance
window.NotificationService = NotificationService;
window.notificationService = new NotificationService();