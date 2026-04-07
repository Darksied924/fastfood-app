const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const app = require('./app');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { setSocketServer } = require('./socket');

const HTTP_PORT = config.port;
const HTTPS_PORT = config.https.port;
const WEB_APP_URL = config.https.enabled
  ? `https://localhost:${HTTPS_PORT}`
  : `http://localhost:${HTTP_PORT}`;

let appServer;
let redirectServer;

const closeServer = (server) => new Promise((resolve) => {
  if (!server) {
    resolve();
    return;
  }

  server.close(() => resolve());
});

const resolveIfRelative = (filePath) => {
  if (!filePath) {
    return '';
  }

  return path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
};

const loadTlsOptions = () => {
  const keyPath = resolveIfRelative(config.https.keyPath);
  const certPath = resolveIfRelative(config.https.certPath);
  const caPath = resolveIfRelative(config.https.caPath);

  if (!keyPath || !certPath) {
    throw new Error('HTTPS is enabled but HTTPS_KEY_PATH or HTTPS_CERT_PATH is missing.');
  }

  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };

  if (caPath) {
    options.ca = fs.readFileSync(caPath);
  }

  return options;
};

const createHttpRedirectServer = () => http.createServer((req, res) => {
  const hostHeader = req.headers.host || 'localhost';
  const host = hostHeader.split(':')[0];
  const httpsPortSegment = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
  const location = `https://${host}${httpsPortSegment}${req.url}`;

  res.writeHead(301, { Location: location });
  res.end();
});

const startServer = async () => {
  try {
    await db.testConnection();

    if (config.https.enabled) {
      const tlsOptions = loadTlsOptions();

      appServer = https.createServer(tlsOptions, app);
      const io = new Server(appServer);
      setSocketServer(io);

      appServer.listen(HTTPS_PORT, () => {
        logger.info(`HTTPS server running in ${config.nodeEnv} mode on port ${HTTPS_PORT}`);
        logger.info(`Web app: ${WEB_APP_URL}`);
      });

      if (config.https.redirectHttp) {
        redirectServer = createHttpRedirectServer().listen(HTTP_PORT, () => {
          logger.info(`HTTP redirect server running on port ${HTTP_PORT} -> HTTPS ${HTTPS_PORT}`);
        });
      }
    } else {
      appServer = app.listen(HTTP_PORT, () => {
        logger.info(`Server running in ${config.nodeEnv} mode on port ${HTTP_PORT}`);
        logger.info(`Web app: ${WEB_APP_URL}`);
      });
      const io = new Server(appServer);
      setSocketServer(io);
    }
  } catch (error) {
    logger.error('Failed to start server.');
    logger.error(error.message);
    process.exit(1);
  }
};

const shutdown = async (exitCode = 1) => {
  try {
    await Promise.all([closeServer(appServer), closeServer(redirectServer)]);
  } finally {
    process.exit(exitCode);
  }
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...');
  logger.error(err.name, err.message);
  shutdown(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  logger.error(err.name, err.message);
  shutdown(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Closing servers...');
  shutdown(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Closing servers...');
  shutdown(0);
});
