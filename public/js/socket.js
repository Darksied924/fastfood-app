const socketClient = (() => {
    let socket = null;
    let connectionStatus = {
        state: 'idle',
        message: 'Live updates have not connected yet.'
    };
    const statusListeners = new Set();

    const updateConnectionStatus = (state, message) => {
        connectionStatus = {
            state,
            message
        };

        statusListeners.forEach((listener) => {
            try {
                listener({ ...connectionStatus });
            } catch (error) {
                console.warn('Socket status listener error:', error.message || error);
            }
        });
    };

    const connect = () => {
        if (socket || !auth.isAuthenticated()) {
            if (!auth.isAuthenticated()) {
                updateConnectionStatus('unauthorized', 'Live updates unavailable. Please sign in again.');
            }
            return socket;
        }

        const token = auth.getToken();
        if (!token) {
            console.warn('Socket.IO skipped: no auth token available');
            updateConnectionStatus('unauthorized', 'Live updates unavailable. Please sign in again.');
            return null;
        }

        updateConnectionStatus('connecting', 'Connecting to live updates...');
        socket = io({
            auth: {
                token
            }
        });

        socket.on('connect', () => {
            console.info('Socket.IO connected', socket.id);
            updateConnectionStatus('connected', 'Live updates connected.');
        });

        socket.on('connect_error', (error) => {
            console.warn('Socket.IO connect error:', error.message || error);
            updateConnectionStatus('error', `Live updates unavailable: ${error.message || 'connection error'}`);
        });

        socket.on('disconnect', (reason) => {
            console.info('Socket.IO disconnected:', reason);
            updateConnectionStatus('disconnected', 'Live updates disconnected. Reconnecting when possible.');
        });

        return socket;
    };

    const on = (event, callback) => {
        if (!socket) {
            return;
        }
        socket.on(event, callback);
    };

    const off = (event, callback) => {
        if (!socket) {
            return;
        }
        socket.off(event, callback);
    };

    const onStatusChange = (callback) => {
        if (typeof callback !== 'function') {
            return () => {};
        }

        statusListeners.add(callback);
        callback({ ...connectionStatus });

        return () => {
            statusListeners.delete(callback);
        };
    };

    return {
        connect,
        on,
        off,
        onStatusChange,
        getConnectionStatus: () => ({ ...connectionStatus }),
        getSocket: () => socket
    };
})();

window.socketClient = socketClient;
