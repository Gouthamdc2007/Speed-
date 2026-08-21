const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for testing flexibility across LAN/WAN
app.use(cors());

// Middleware to disable caching for all API endpoints
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Pre-generate a 1MB incompressible pseudo-random buffer once in memory
// This prevents CPU and Garbage Collection bottlenecks during multi-gigabit download tests
const CHUNK_SIZE = 1024 * 1024; // 1 MB
const pseudoRandomChunk = crypto.randomBytes(CHUNK_SIZE);

/**
 * 1. PING / LATENCY ENDPOINT
 * Minimal overhead instant round-trip response
 */
app.get('/api/ping', (req, res) => {
  res.status(200).json({
    status: 'ok',
    serverTime: Date.now()
  });
});

/**
 * 2. DOWNLOAD SPEED ENDPOINT
 * High-throughput zero-delay binary streaming.
 * Accepts ?size=MB or ?bytes=N (default 25MB, max 200MB per request)
 */
app.get('/api/download', (req, res) => {
  const reqSizeMB = parseFloat(req.query.size) || 25;
  const maxMB = 200;
  const targetMB = Math.min(Math.max(reqSizeMB, 0.1), maxMB);
  const totalBytes = Math.floor(targetMB * 1024 * 1024);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', totalBytes);
  res.setHeader('Content-Disposition', 'attachment; filename="speedtest.bin"');

  let sentBytes = 0;

  function sendNextChunks() {
    let ok = true;
    while (ok && sentBytes < totalBytes) {
      const remaining = totalBytes - sentBytes;
      const currentChunkSize = Math.min(remaining, CHUNK_SIZE);
      const chunk = currentChunkSize === CHUNK_SIZE ? pseudoRandomChunk : pseudoRandomChunk.subarray(0, currentChunkSize);

      sentBytes += currentChunkSize;
      ok = res.write(chunk);
    }

    if (sentBytes >= totalBytes) {
      res.end();
    } else {
      // Handle backpressure
      res.once('drain', sendNextChunks);
    }
  }

  sendNextChunks();
});

/**
 * 3. UPLOAD SPEED ENDPOINT
 * Streams incoming payload directly to memory sink to measure upload throughput
 */
app.post('/api/upload', (req, res) => {
  const startTime = process.hrtime.bigint();
  let totalBytes = 0;

  req.on('data', (chunk) => {
    totalBytes += chunk.length;
  });

  req.on('end', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1e6;

    res.status(200).json({
      status: 'ok',
      bytesReceived: totalBytes,
      durationMs: durationMs
    });
  });

  req.on('error', (err) => {
    console.error('Upload stream error:', err);
    res.status(500).json({ error: 'Upload stream failed' });
  });
});

/**
 * 4. CLIENT TELEMETRY & IP INFO
 * Returns client IP, User-Agent, and estimated network info
 */
app.get('/api/ip-info', async (req, res) => {
  const forwarded = req.headers['x-forwarded-for'];
  let clientIp = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;

  if (clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1') {
    clientIp = '127.0.0.1 (Localhost)';
  }

  let geoData = {
    ip: clientIp,
    isp: 'Local Network',
    city: 'Local Machine',
    country: 'Internal',
    org: 'Internal Network'
  };

  // Try to lookup public IP details if client IP is public
  if (clientIp && !clientIp.includes('127.0.0.1') && !clientIp.startsWith('192.168.') && !clientIp.startsWith('10.')) {
    try {
      const response = await fetch(`http://ip-api.com/json/${clientIp}?fields=status,message,country,city,isp,org,query`);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success') {
          geoData = {
            ip: data.query,
            isp: data.isp || data.org || 'Unknown ISP',
            city: data.city || 'Unknown City',
            country: data.country || 'Unknown Country',
            org: data.org || data.isp
          };
        }
      }
    } catch (e) {
      // Fallback silently if offline or rate limited
    }
  }

  res.json({
    ...geoData,
    userAgent: req.headers['user-agent'] || 'Unknown'
  });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 SpeedPulse Network Speed Test Server is Running!`);
  console.log(`🌐 Local Access:    http://localhost:${PORT}`);
  console.log(`📱 LAN Access:      http://<YOUR-IP>:${PORT}`);
  console.log(`====================================================`);
});
