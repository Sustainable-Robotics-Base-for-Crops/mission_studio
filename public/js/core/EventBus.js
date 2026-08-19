/**
 * Event system (pub/sub) to decouple modules
 */

class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Function to call
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Function to remove
     */
    off(event, callback) {
        if (!this.listeners[event]) return;

        this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Data to transmit
     */
    emit(event, data = null) {
        if (!this.listeners[event]) return;

        this.listeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in listener for ${event}:`, error);
            }
        });
    }

    /**
     * Emit an event asynchronously
     * @param {string} event - Event name
     * @param {*} data - Data to transmit
     */
    async emitAsync(event, data = null) {
        if (!this.listeners[event]) return;

        const promises = this.listeners[event].map(callback => {
            try {
                return Promise.resolve(callback(data));
            } catch (error) {
                console.error(`Error in listener for ${event}:`, error);
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
    }
}

// Export the class and create a global instance
window.EventBus = EventBus;
window.eventBus = new EventBus();
