/**
 * Service for communication with the backend API
 */

class ApiService {
    constructor() {
        this.baseUrl = '';
    }

    /**
     * Extract a clean error message from an HTTP response
     * @param {Response} response - HTTP response
     * @param {string} errorText - Raw response text
     * @returns {string} Extracted error message
     */
    async _extractErrorMessage(response, errorText) {
        // Try to parse as JSON first (always try, even when content-type is not detected)
        try {
            // Look for a JSON object in the text (it may be preceded by other text)
            // Find the first opening brace and the last closing brace
            const firstBrace = errorText.indexOf('{');
            const lastBrace = errorText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const jsonStr = errorText.substring(firstBrace, lastBrace + 1);
                try {
                    const jsonData = JSON.parse(jsonStr);
                    if (jsonData.error) {
                        return jsonData.error;
                    }
                    if (jsonData.message) {
                        return jsonData.message;
                    }
                } catch (e) {
                    // Invalid JSON in this part, continue
                }
            }
            
            // If nothing matches, try parsing the string directly
            const jsonData = JSON.parse(errorText);
            if (jsonData.error) {
                return jsonData.error;
            }
            if (jsonData.message) {
                return jsonData.message;
            }
        } catch (e) {
            // Not JSON, continue with HTML extraction
        }

        // If this is HTML, try to extract the error message
        if (errorText.includes('<!DOCTYPE') || errorText.includes('<html')) {
            // Search for a <p>Message: ...</p> element
            const messageMatch = errorText.match(/<p>Message:\s*([^<]+)<\/p>/i);
            if (messageMatch && messageMatch[1]) {
                return messageMatch[1].trim();
            }
        }

        // If no specific message was found, use a generic message
        const statusMessages = {
            400: 'Invalid request',
            401: 'Unauthorized',
            403: 'Access denied',
            404: 'Resource not found',
            413: 'File too large',
            500: 'Internal server error'
        };

        return statusMessages[response.status] || `Error ${response.status}: ${response.statusText}`;
    }

    /**
     * Get authentication headers
     * @returns {Promise<Object>} Headers with token when available
     */
    async getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };

        // Use the auth provider injected by the plugin registry when available.
        const authManager = (window.custom_plugins && window.custom_plugins.authManager) || window.authManager;
        if (authManager && typeof authManager.getAuthHeaders === 'function') {
            try {
                const authHeaders = await authManager.getAuthHeaders();
                return { ...headers, ...authHeaders };
            } catch (error) {
                console.warn('[ApiService] Error while retrieving auth headers:', error);
            }
        }

        // Fallback: add a Bearer token if the auth provider exposes one directly.
        if (authManager && authManager.idToken) {
            headers['Authorization'] = `Bearer ${authManager.idToken}`;
        }

        return headers;
    }

    /**
     * Perform a GET request
     * @param {string} endpoint - API endpoint
     * @param {Object} params - Request parameters (optional)
     * @returns {Promise<Object>} JSON response
     */
    async get(endpoint, params = {}) {
        const headers = await this.getAuthHeaders();
        
        // Build the URL with parameters
        const url = new URL(endpoint, window.location.origin);
        Object.keys(params).forEach(key => {
            url.searchParams.append(key, params[key]);
        });
        
        const response = await fetch(url.pathname + url.search, {
            method: 'GET',
            headers: headers,
            credentials: 'include'
        });

        if (!response.ok) {
            const errorText = await response.text();
            const errorMessage = await this._extractErrorMessage(response, errorText);
            const error = new Error(errorMessage);
            error.status = response.status;
            
            // If there is a 401 error on /app, check whether it is really an authentication issue
            // Do not redirect automatically because it can create loops
            // The backend should handle authentication redirects
            if (response.status === 401 && window.location.pathname === '/app') {
                console.warn('[ApiService] 401 error on /app, not redirecting automatically (may be rate limit)');
                // Do not redirect automatically - let the backend handle it through session cookies
            }
            
            throw error;
        }

        return await response.json();
    }

    /**
     * Perform a POST request
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Data to send
     * @returns {Promise<Object>} JSON response
     */
    async post(endpoint, data, additionalHeaders = {}) {
        const headers = await this.getAuthHeaders();
        // Merge additional headers with authentication headers
        const mergedHeaders = { ...headers, ...additionalHeaders };
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: mergedHeaders,
            credentials: 'include',
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorText = await response.text();
            const errorMessage = await this._extractErrorMessage(response, errorText);
            throw new Error(errorMessage);
        }

        return await response.json();
    }

    /**
     * Perform a PUT request
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Data to send
     * @returns {Promise<Object>} JSON response
     */
    async put(endpoint, data) {
        const headers = await this.getAuthHeaders();
        
        const response = await fetch(endpoint, {
            method: 'PUT',
            headers: headers,
            credentials: 'include',
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorText = await response.text();
            const errorMessage = await this._extractErrorMessage(response, errorText);
            throw new Error(errorMessage);
        }

        return await response.json();
    }

    /**
     * Perform a DELETE request
     * @param {string} endpoint - API endpoint
     * @returns {Promise<Object>} JSON response
     */
    async delete(endpoint) {
        const headers = await this.getAuthHeaders();
        
        const response = await fetch(endpoint, {
            method: 'DELETE',
            headers: headers,
            credentials: 'include'
        });

        if (!response.ok) {
            const errorText = await response.text();
            const errorMessage = await this._extractErrorMessage(response, errorText);
            throw new Error(errorMessage);
        }

        return await response.json();
    }

    /**
     * Get the UI configuration from the backend
     * @returns {Promise<Object>} UI configuration
     */
    async getUIConfig() {
        return await this.get('/api/user/ui-config');
    }

    /**
     * List trajectories
     * @param {Object} params - Parameters (storage, metadata)
     * @returns {Promise<Array>} List of trajectories
     */
    async listTrajectories(params = {}) {
        return await this.get('/api/trajectories', params);
    }

    /**
     * Load a trajectory
     * @param {string} filepath - File path
     * @param {boolean} download - If true, download the file
     * @returns {Promise<Object>} Trajectory
     */
    async loadTrajectory(filepath, download = false) {
        const params = download ? { download: 'true' } : {};
        return await this.get(`/api/trajectories/${encodeURIComponent(filepath)}`, params);
    }

    /**
     * Save a trajectory
     * @param {Object} trajectory - Trajectory data
     * @param {string} storageMode - Storage mode ('local', plugin backend name, 'both')
     * @returns {Promise<Object>} Save result
     */
    async saveTrajectory(trajectory, storageMode = 'local') {
        const headers = await this.getAuthHeaders();
        headers['X-Storage-Mode'] = storageMode;
        
        const response = await fetch('/api/trajectories', {
            method: 'POST',
            headers: headers,
            credentials: 'include',
            body: JSON.stringify(trajectory)
        });

        if (!response.ok) {
            const errorText = await response.text();
            const errorMessage = await this._extractErrorMessage(response, errorText);
            throw new Error(errorMessage);
        }

        return await response.json();
    }

    /**
     * Delete a trajectory
     * @param {string} filepath - File path
     * @returns {Promise<Object>} Delete result
     */
    async deleteTrajectory(filepath) {
        return await this.delete(`/api/trajectories/${encodeURIComponent(filepath)}`);
    }
}

// Export the class and create a global instance
window.ApiService = ApiService;
window.apiService = new ApiService();
