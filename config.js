const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const defaultEnvPath = path.join(__dirname, '.env');
const legacyEnvPath = path.join(__dirname, 'env.env');

if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath });
} else if (fs.existsSync(legacyEnvPath)) {
  dotenv.config({ path: legacyEnvPath });
} else {
  dotenv.config();
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: process.env.TRUST_PROXY === 'true',
  apiDocsEnabled: process.env.API_DOCS_ENABLED !== 'false',
  https: {
    enabled: process.env.HTTPS_ENABLED === 'true',
    port: parseInt(process.env.HTTPS_PORT, 10) || 3443,
    redirectHttp: process.env.HTTPS_REDIRECT_HTTP !== 'false',
    keyPath: process.env.HTTPS_KEY_PATH || '',
    certPath: process.env.HTTPS_CERT_PATH || '',
    caPath: process.env.HTTPS_CA_PATH || ''
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fastfood_db',
    socketPath: process.env.DB_SOCKET_PATH || undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expire: process.env.JWT_EXPIRE || '7d'
  },
  google: {
    enabled: process.env.GOOGLE_AUTH_ENABLED === 'true',
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  },
  facebook: {
    enabled: process.env.FACEBOOK_AUTH_ENABLED === 'true',
    appId: process.env.FACEBOOK_APP_ID || '',
    appSecret: process.env.FACEBOOK_APP_SECRET || '',
    apiVersion: process.env.FACEBOOK_API_VERSION || 'v22.0'
  },
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
  rateLimit: {
    apiWindowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    apiMaxRequests: parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS, 10) || 300,
    authWindowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    authMaxRequests: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10) || 20,
    userOrderCreateWindowMs: parseInt(process.env.USER_ORDER_CREATE_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000,
    userOrderCreateMaxRequests: parseInt(process.env.USER_ORDER_CREATE_RATE_LIMIT_MAX_REQUESTS, 10) || 10,
    userPaymentInitWindowMs: parseInt(process.env.USER_PAYMENT_INIT_RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000,
    userPaymentInitMaxRequests: parseInt(process.env.USER_PAYMENT_INIT_RATE_LIMIT_MAX_REQUESTS, 10) || 8,
    paymentCallbackWindowMs: parseInt(process.env.PAYMENT_CALLBACK_RATE_LIMIT_WINDOW_MS, 10) || 5 * 60 * 1000,
    paymentCallbackMaxRequests: parseInt(process.env.PAYMENT_CALLBACK_RATE_LIMIT_MAX_REQUESTS, 10) || 30
  },
  mpesa: {
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    businessShortCode: process.env.MPESA_BUSINESS_SHORT_CODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
    callbackUrl: process.env.MPESA_CALLBACK_URL || '',
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    stkPaymentWindowMs: parseInt(process.env.MPESA_STK_PAYMENT_WINDOW_MS, 10) || 2 * 60 * 1000
  }
};
