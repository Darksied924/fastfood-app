const socketClient = (() => {
    let socket = null;

    const connect = () => {
        if (socket || !auth.isAuthenticated()) {
            return socket;
        }

        const token = auth.getToken();
        if (!token) {
            console.warn('Socket.IO skipped: no auth token available');
            return null;
        }

        socket = io({
            auth: {
                token
            }
        });

        socket.on('connect', () => {
            console.info('Socket.IO connected', socket.id);
        });

        socket.on('connect_error', (error) => {
            console.warn('Socket.IO connect error:', error.message || error);
        });

        socket.on('disconnect', (reason) => {
            console.info('Socket.IO disconnected:', reason);
        });

        return socket;
    };

    const on = (event, callback) => {
        if (!socket) {
            return;
        }
        socket.on(event, callback);
    };

    return {
        connect,
        on,
        getSocket: () => socket
    };
})();

window.socketClient = socketClient;
