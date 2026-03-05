const express = require('express');
const path = require('path');
const cors = require('cors');
const config = require('./config');
const logger = require('./logger');
const { createRateLimiter } = require('./middleware/rateLimiter');
const openApiSpec = require('./docs/openapi.json');

// Route imports
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes.js');
const productRoutes = require('./routes/products.routes');
const orderRoutes = require('./routes/orders.routes');
const paymentRoutes = require('./routes/payments.routes');

// Middleware imports
const errorMiddleware = require('./middleware/error.middleware');

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Body parser
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Enable CORS
app.use(cors());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Global API rate limit to reduce basic DoS/flood traffic
const apiRateLimiter = createRateLimiter({
  windowMs: config.rateLimit.apiWindowMs,
  maxRequests: config.rateLimit.apiMaxRequests,
  message: 'Too many API requests from this source. Please try again later.'
});

app.use('/api', apiRateLimiter);

if (config.apiDocsEnabled) {
  app.get('/api/openapi.json', (req, res) => {
    res.json(openApiSpec);
  });

  app.get('/api/docs', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FastFood API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger-ui",
        docExpansion: "none",
        persistAuthorization: true
      });
    </script>
  </body>
</html>`;

    res.type('html').send(html);
  });
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

app.get('/reset-password/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/delivery/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'delivery-dashboard.html'));
});

app.get('/customer/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-menu.html'));
});

app.get('/customer/cart', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-cart.html'));
});

app.get('/customer/orders', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer-orders.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/admin/users', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});

app.get('/admin/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-products.html'));
});

app.get('/admin/orders', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-orders.html'));
});

app.get('/admin/analytics', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-analytics.html'));
});

// Error handling middleware (should be last)
app.use(errorMiddleware);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

module.exports = app;
