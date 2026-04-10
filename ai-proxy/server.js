// ai-proxy/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const aiRoutes = require('./routes/aiRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// --- CORS ---
const corsOrigins = process.env.CORS_ORIGINS || '*';
const corsOptions = corsOrigins === '*'
    ? { origin: true }
    : { origin: corsOrigins.split(',').map(o => o.trim()) };
app.use(cors(corsOptions));

// --- Body parser (200KB limit for large game contexts) ---
app.use(express.json({ limit: '200kb' }));

// --- Health check ---
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// --- API routes ---
app.use('/ai', aiRoutes);

// --- 404 handler ---
app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
});

// --- Global error handler ---
app.use((err, _req, res, _next) => {
    console.error('[Server Error]', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error',
    });
});

app.listen(PORT, () => {
    console.log(`[文江 AI Proxy] Server running on port ${PORT}`);
    console.log(`[文江 AI Proxy] Health check: http://localhost:${PORT}/health`);
});
