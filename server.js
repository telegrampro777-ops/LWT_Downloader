require('dotenv').config();
const express = require('express');
const WebTorrent = require('webtorrent');
const path = require('path');
const cors = require('cors');
const os = require('os');
const { spawn } = require('child_process');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('./auth');
const authRoutes = require('./auth-routes');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'lwt-secret-key-123';
const TMP_DIR = path.join(os.tmpdir(), 'torrentstream');

// ── Logger (color-coded + timestamps) ───────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', white: '\x1b[37m',
};
function ts() {
  return C.dim + new Date().toLocaleTimeString('en-IN', { hour12: false }) + C.reset + ' ';
}
const log = {
  info  : (tag, msg) => console.log(`${ts()}${C.cyan}${C.bold}[${tag}]${C.reset} ${msg}`),
  ok    : (tag, msg) => console.log(`${ts()}${C.green}${C.bold}[${tag}]${C.reset} ${msg}`),
  warn  : (tag, msg) => console.log(`${ts()}${C.yellow}${C.bold}[${tag}]${C.reset} ${msg}`),
  error : (tag, msg) => console.log(`${ts()}${C.red}${C.bold}[${tag}]${C.reset} ${msg}`),
  stream: (tag, msg) => console.log(`${ts()}${C.magenta}${C.bold}[${tag}]${C.reset} ${msg}`),
};

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions
app.use(session({
  store: new SQLiteStore({ dir: './', db: 'sessions.db' }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 1 week
}));

app.use(passport.initialize());
app.use(passport.session());

// Mount Auth Routes (Before static files)
app.use('/auth', authRoutes);

// Protect main app files (except login)
app.use((req, res, next) => {
  const publicPaths = ['/login', '/login.html', '/login.js', '/login.css', '/auth', '/favicon.ico'];
  if (req.isAuthenticated() || publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }
  
  // If not authenticated, redirect to clean /login
  if (req.path === '/' || req.path.endsWith('.html')) {
    return res.redirect('/login');
  }
  next();
});

// Clean URL for login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Log API requests (hush frequent /api/status updates)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    // Only log if it's NOT a successful status check
    if (!req.path.includes('/status')) {
      log.info('REQ', `${C.white}${req.method}${C.reset} ${req.path}`);
    }
  }
  next();
});

// ── WebTorrent Client ────────────────────────────────────────
const client = new WebTorrent({ maxWebConns: 10, uploadLimit: 1024 * 100 });

client.on('error', (err) => log.error('WT', err.message));

// Auto-remove torrents after 2 hours of inactivity
const torrentLastAccess = {};
setInterval(() => {
  const now = Date.now();
  client.torrents.forEach((torrent) => {
    const last = torrentLastAccess[torrent.infoHash] || 0;
    if (now - last > 2 * 60 * 60 * 1000) {
      log.warn('CLEANUP', `Idle torrent removed: "${torrent.name}"`);
      torrent.destroy({ destroyStore: true });
    }
  });
}, 10 * 60 * 1000);

// ── Helpers ─────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
    '.m4v': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.srt': 'text/plain',
  };
  return types[ext] || 'application/octet-stream';
}

function formatTorrentInfo(torrent) {
  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    length: torrent.length,
    files: torrent.files.map((f, i) => ({
      index: i,
      name: f.name,
      length: f.length,
      path: f.path,
    })),
  };
}

function formatTorrentStatus(torrent) {
  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    progress: torrent.progress,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    timeRemaining: torrent.timeRemaining,
    done: torrent.done,
    length: torrent.length,
    // Include files once metadata is ready (files array is populated by WebTorrent)
    files: torrent.files.length > 0
      ? torrent.files.map((f, i) => ({ index: i, name: f.name, length: f.length }))
      : null,
  };
}


// ── API Routes ──────────────────────────────────────────────

/**
 * POST /api/add
 * Body: { magnet: "magnet:?xt=..." }
 * Returns the infoHash IMMEDIATELY — does not wait for metadata.
 * The frontend polls /api/status which returns files once metadata arrives.
 */
app.post('/api/add', (req, res) => {
  const { magnet } = req.body;
  if (!magnet || !magnet.startsWith('magnet:')) {
    return res.status(400).json({ error: 'A valid magnet link is required.' });
  }

  // Already added? Return current state immediately
  const existing = client.get(magnet);
  if (existing) {
    torrentLastAccess[existing.infoHash] = Date.now();
    return res.json({
      infoHash: existing.infoHash,
      name: existing.name,
      length: existing.length,
      files: existing.files.map((f, i) => ({ index: i, name: f.name, length: f.length })),
    });
  }

  // Limit concurrent torrents
  if (client.torrents.length >= 5) {
    return res.status(429).json({ error: 'Server is busy. Max 5 torrents at once.' });
  }

  log.info('ADD', magnet.substring(20, 90) + '...');

  // client.add() returns the torrent object SYNCHRONOUSLY with infoHash available.
  const torrent = client.add(magnet, { path: TMP_DIR }, (t) => {
    torrentLastAccess[t.infoHash] = Date.now();
    log.ok('READY', `"${t.name}" | ${t.files.length} file(s) | ${formatBytes(t.length)}`);
  });

  torrent.on('error', (err) => log.error('TORRENT', err.message));

  // Return immediately — frontend will poll for files/progress
  res.json({
    infoHash: torrent.infoHash,
    name: torrent.name || null,
    length: torrent.length || null,
    files: [], // empty — metadata not yet available; poll /api/status
  });
});


/**
 * GET /api/status/:infoHash
 * Returns real-time download stats
 */
app.get('/api/status/:infoHash', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found. It may have been removed due to inactivity.' });
  }
  torrentLastAccess[torrent.infoHash] = Date.now();
  res.json(formatTorrentStatus(torrent));
});

/**
 * GET /api/stream/:infoHash/:fileIndex
 * Streams a file from the torrent with full HTTP Range support
 * Supports video seeking / audio scrubbing
 */
app.get('/api/stream/:infoHash/:fileIndex', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) {
    return res.status(404).json({ error: 'Torrent not found.' });
  }

  const fileIndex = parseInt(req.params.fileIndex, 10);
  if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= torrent.files.length) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const file = torrent.files[fileIndex];
  torrentLastAccess[torrent.infoHash] = Date.now();

  const mimeType = getMimeType(file.name);
  const fileSize = file.length;
  const rangeHeader = req.headers.range;

  const isDownload = req.query.download === '1';
  const disposition = isDownload
    ? `attachment; filename="${encodeURIComponent(file.name)}"`
    : `inline; filename="${encodeURIComponent(file.name)}"`;

  if (rangeHeader) {
    // ── Partial content (range request) — needed for video seeking ──
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Content-Disposition': disposition,
    });

    const stream = file.createReadStream({ start, end });
    stream.on('error', (err) => {
      log.error('STREAM', `Range error: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': disposition,
    });
    const stream = file.createReadStream();
    stream.on('error', (err) => {
      log.error('STREAM', `Error: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  }
});

// ── Language code → readable name ────────────────────────────
const LANG_NAMES = {
  tel:'Telugu', tam:'Tamil', hin:'Hindi', eng:'English',
  mal:'Malayalam', kan:'Kannada', fra:'French', spa:'Spanish',
  jpn:'Japanese', kor:'Korean', chi:'Chinese', zho:'Chinese',
  ara:'Arabic', por:'Portuguese', ger:'German', deu:'German',
  ita:'Italian', rus:'Russian', und:'Unknown',
};

// Codec-description pattern — these should NOT be shown as the language name
const CODEC_DESC = /\b(aac|ac3|dts|mp3|opus|pcm|flac|kbps|audio|\d+\.\d+|channel|stereo|surround)\b/i;

function langName(code, title, idx) {
  const c = (code || 'und').toLowerCase().slice(0, 3);
  // 1. Known language code → use readable name
  if (LANG_NAMES[c] && c !== 'und') return LANG_NAMES[c];
  // 2. Title exists and is NOT a codec description → use it
  if (title && !CODEC_DESC.test(title)) return title;
  // 3. Fallback: Track 1, Track 2, …
  return `Track ${idx + 1}`;
}


/**
 * GET /api/tracks/:infoHash/:fileIndex
 * Uses ffprobe to detect all audio tracks in a video file.
 * Returns: [ { index, streamIndex, lang, title, codec, channels } ]
 */
app.get('/api/tracks/:infoHash/:fileIndex', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found.' });

  const fi = parseInt(req.params.fileIndex, 10);
  if (isNaN(fi) || fi >= torrent.files.length) return res.status(404).json({ error: 'File not found.' });

  const file = torrent.files[fi];
  torrentLastAccess[torrent.infoHash] = Date.now();

  // Run ffprobe, feeding the first 8 MB of the file via stdin (header contains track info)
  const probe = spawn('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'a',
    '-i', 'pipe:0',
  ]);

  let json = '';
  let errOut = '';
  probe.stdout.on('data', d => (json += d));
  probe.stderr.on('data', d => (errOut += d));

  probe.on('close', (code) => {
    try {
      const data = JSON.parse(json);
      let audioIdx = 0;
      const tracks = (data.streams || []).map((s, idx) => ({
        index:       audioIdx++,
        streamIndex: s.index,
        lang:        langName(s.tags?.language, s.tags?.title, idx),
        codec:       s.codec_name,
        channels:    s.channels,
      }));
      log.ok('TRACKS', `${file.name} → ${tracks.length} audio track(s): ${tracks.map(t => t.lang).join(', ')}`);
      res.json({ tracks });
    } catch {
      log.warn('TRACKS', 'ffprobe could not parse audio tracks (file may still be downloading)');
      res.json({ tracks: [] });
    }
  });

  probe.on('error', (err) => {
    log.error('TRACKS', `ffprobe error: ${err.message}`);
    res.json({ tracks: [] });
  });

  // Feed first 8 MB (enough for container headers)
  const readStream = file.createReadStream({ start: 0, end: Math.min(8 * 1024 * 1024, file.length - 1) });
  readStream.pipe(probe.stdin);
  readStream.on('end', () => { try { probe.stdin.end(); } catch {} });
  readStream.on('error', () => { try { probe.stdin.end(); } catch {} });
});

/**
 * GET /api/stream/:infoHash/:fileIndex?audio=N
 * When ?audio=N is present, uses ffmpeg to mux only audio track N into a
 * fragmented MP4 stream the browser can play.
 * Without ?audio, falls through to the original direct range-request stream.
 */
app.get('/api/transcode/:infoHash/:fileIndex', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found.' });

  const fi = parseInt(req.params.fileIndex, 10);
  if (isNaN(fi) || fi >= torrent.files.length) return res.status(404).json({ error: 'File not found.' });

  const file = torrent.files[fi];
  const audioTrack = parseInt(req.query.audio ?? '0', 10);
  torrentLastAccess[torrent.infoHash] = Date.now();

  log.stream('TRANSCODE', `"${file.name}" audio track ${audioTrack}`);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);

  // ffmpeg: copy video, pick specific audio track, output fragmented MP4 to stdout
  const ff = spawn('ffmpeg', [
    '-re',                              // read at native rate
    '-i', 'pipe:0',                     // input from stdin
    '-map', '0:v:0',                    // first video stream
    '-map', `0:a:${audioTrack}`,        // chosen audio track
    '-c:v', 'copy',                     // copy video (no re-encode = fast)
    '-c:a', 'aac',                      // re-encode audio to AAC (browser compat)
    '-b:a', '192k',
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-loglevel', 'error',
    'pipe:1',                           // output to stdout
  ]);

  const fileStream = file.createReadStream();
  fileStream.pipe(ff.stdin);

  ff.stdout.pipe(res);

  ff.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) log.error('FFMPEG', msg);
  });

  ff.on('error', (err) => {
    log.error('FFMPEG', err.message);
    if (!res.headersSent) res.status(500).end();
  });

  res.on('close', () => {
    try { ff.kill('SIGKILL'); } catch {}
    try { fileStream.destroy(); } catch {}
  });
});



/**
 * DELETE /api/remove/:infoHash
 * Removes torrent and cleans up temp files
 */
app.delete('/api/remove/:infoHash', (req, res) => {
  const torrent = client.get(req.params.infoHash);
  if (torrent) {
    torrent.destroy({ destroyStore: true }, () => {
      log.warn('REMOVE', `"${torrent.name}"`);
    });
    delete torrentLastAccess[req.params.infoHash];
  }
  res.json({ success: true });
});

/**
 * GET /
 * Serve the frontend (public/index.html)
 */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start Server (auto-retry port if busy) ──────────────────
function startServer(port) {
  const server = app.listen(port, () => {
    const line = '─'.repeat(45);
    console.log(`\n${C.cyan}${line}${C.reset}`);
    console.log(`  ${C.green}${C.bold}🚀 TorrentStream is running!${C.reset}`);
    console.log(`  ${C.bold}URL  :${C.reset} ${C.cyan}http://localhost:${port}${C.reset}`);
    console.log(`  ${C.bold}Temp :${C.reset} ${C.dim}${TMP_DIR}${C.reset}`);
    console.log(`  ${C.dim}Press Ctrl+C to stop${C.reset}`);
    console.log(`${C.cyan}${line}${C.reset}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.warn('PORT', `${port} is busy — trying ${port + 1}...`);
      startServer(port + 1);
    } else throw err;
  });
}

startServer(PORT);
