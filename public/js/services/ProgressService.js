/**
 * Progress indicator management service
 */

class ProgressService {
    constructor() {
        this.overlay = null;
        this.progressBar = null;
        this.progressText = null;
        this.init();
    }

    /**
     * Initialize the service
     */
    init() {
        // Create the progress overlay if it does not exist
        if (!document.getElementById('progressOverlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'progressOverlay';
            overlay.className = 'progress-overlay';
            overlay.innerHTML = `
                <div class="progress-dialog">
                    <div class="progress-spinner"></div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" id="globalProgressBar"></div>
                    </div>
                    <p class="progress-text" id="globalProgressText">Loading...</p>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        this.overlay = document.getElementById('progressOverlay');
        this.progressBar = document.getElementById('globalProgressBar');
        this.progressText = document.getElementById('globalProgressText');
    }

    /**
     * Show the progress indicator
     * @param {string} message - Message to display
     * @param {number} progress - Progress (0-100), null for indeterminate mode
     */
    show(message = 'Loading...', progress = null) {
        if (this.progressText) {
            this.progressText.textContent = message;
        }
        
        if (this.progressBar) {
            if (progress !== null) {
                this.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
            } else {
                // Indeterminate mode - animation
                this.progressBar.style.width = '30%';
                this.progressBar.style.animation = 'progress-indeterminate 1.5s ease-in-out infinite';
            }
        }

        if (this.overlay) {
            this.overlay.style.display = 'flex';
        }
    }

    /**
     * Update the progress message
     * @param {string} message - New message
     */
    updateMessage(message) {
        if (this.progressText) {
            this.progressText.textContent = message;
        }
    }

    /**
     * Update progress
     * @param {number} progress - Progress (0-100)
     */
    updateProgress(progress) {
        if (this.progressBar) {
            this.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
            this.progressBar.style.animation = 'none';
        }
    }

    /**
     * Hide the progress indicator
     */
    hide() {
        if (this.overlay) {
            this.overlay.style.display = 'none';
        }
        // Reset
        if (this.progressBar) {
            this.progressBar.style.width = '0%';
            this.progressBar.style.animation = 'none';
        }
        if (this.progressText) {
            this.progressText.textContent = 'Loading...';
        }
    }
}

// Export the class and create a global instance
window.ProgressService = ProgressService;
window.progressService = new ProgressService();
