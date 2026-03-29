/* =====================================================
   TorrentStream — app.js
   Browser-based torrent client using WebTorrent.js
   ===================================================== */

// ── Constants ──────────────────────────────────────
const SAMPLE_MAGNET =
  'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplorer.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com';

const FILE_ICONS = {
  // Video
  mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', wmv: '🎬', webm: '🎬', flv: '🎬',
  // Audio
  mp3: '🎵', flac: '🎵', aac: '🎵', wav: '🎵', ogg: '🎵', m4a: '🎵',
  // Image
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️', svg: '🖼️',
  // Docs / Other
  pdf: '📄', txt: '📝', zip: '🗜️', rar: '🗜️', '7z': '🗜️', iso: '💿',
  exe: '⚙️', apk: '📱', epub: '📚',
};

const STREAMABLE_VIDEO = ['mp4', 'webm', 'ogg', 'mkv', 'avi', 'mov', 'flv'];
const STREAMABLE_AUDIO = ['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a'];
const STREAMABLE_IMAGE = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

// ── State ──────────────────────────────────────────
let client = null;
let activeTorrent = null;
let statsInterval = null;
let objectURLs = [];

// ── DOM Helpers ────────────────────────────────────
const $  = id => document.getElementById(id);
const show = id => $( id).classList.remove('hidden');
const hide = id => $( id).classList.add('hidden');

function setEl(id, value) { $(id).textContent = value; }

// ── Toast ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), duration);
}

// ── Format helpers ─────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

function formatETA(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function getExt(filename) {
  return filename.split('.').pop().toLowerCase();
}

function getIcon(filename) {
  return FILE_ICONS[getExt(filename)] || '📁';
}

// ── Load sample ────────────────────────────────────
function loadSample() {
  $('magnet-input').value = SAMPLE_MAGNET;
  startTorrent();
}

// ── Init WebTorrent client ─────────────────────────
function ensureClient() {
  if (!client) {
    client = new WebTorrent();
    client.on('error', err => {
      console.error('WebTorrent client error:', err);
      showToast('⚠️ Client error: ' + err.message);
    });
  }
}

// ── Start torrent ──────────────────────────────────
function startTorrent() {
  const magnetInput = $('magnet-input');
  const magnet = magnetInput.value.trim();

  if (!magnet) {
    showToast('⚠️ Please paste a magnet link first.');
    magnetInput.focus();
    return;
  }

  if (!magnet.startsWith('magnet:')) {
    showToast('❌ That doesn\'t look like a valid magnet link.');
    return;
  }

  // Disable button & show spinner
  const btn = $('load-btn');
  btn.disabled = true;
  hide('btn-text');
  show('btn-spinner');

  // Remove previous torrent if any
  if (activeTorrent) {
    removeTorrent(false);
  }

  ensureClient();

  // Show status section
  show('status-section');
  hide('player-section');
  setEl('torrent-name', 'Connecting to peers...');
  setEl('torrent-size', 'Size: —');
  setEl('torrent-peers', 'Peers: 0');
  setEl('torrent-status-text', 'Connecting...');
  setEl('progress-percent', '0%');
  setEl('download-speed', '↓ 0 B/s');
  setEl('upload-speed', '↑ 0 B/s');
  setEl('eta', 'ETA: —');
  $('progress-bar').style.width = '0%';
  $('files-list').innerHTML = '';

  // Scroll to status
  setTimeout(() => $('status-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  client.add(magnet, { announce: [
    'wss://tracker.btorrent.xyz',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.fastcast.nz',
    'wss://tracker.webtorrent.dev',
  ]}, onTorrentReady);
}

// ── Torrent ready ──────────────────────────────────
function onTorrentReady(torrent) {
  activeTorrent = torrent;

  // Re-enable button
  $('load-btn').disabled = false;
  show('btn-text');
  hide('btn-spinner');

  // Set name & size
  setEl('torrent-name', torrent.name || 'Unknown Torrent');
  setEl('torrent-size', 'Size: ' + formatBytes(torrent.length));

  // Render file list
  renderFiles(torrent.files);

  // Start stats polling
  statsInterval = setInterval(() => updateStats(torrent), 1000);
  updateStats(torrent);

  torrent.on('done', () => {
    setEl('torrent-status-text', '✅ Complete');
    setEl('eta', 'ETA: Done!');
    clearInterval(statsInterval);
    showToast('✅ Download complete!', 4000);
  });

  torrent.on('error', err => {
    console.error('Torrent error:', err);
    showToast('❌ Torrent error: ' + err.message);
    $('load-btn').disabled = false;
    show('btn-text');
    hide('btn-spinner');
  });
}

// ── Update stats ───────────────────────────────────
function updateStats(torrent) {
  const pct = (torrent.progress * 100).toFixed(1);
  setEl('progress-percent', pct + '%');
  setEl('torrent-peers', 'Peers: ' + torrent.numPeers);
  setEl('download-speed', '↓ ' + formatSpeed(torrent.downloadSpeed));
  setEl('upload-speed', '↑ ' + formatSpeed(torrent.uploadSpeed));
  setEl('eta', 'ETA: ' + formatETA(torrent.timeRemaining / 1000));
  setEl('torrent-status-text', torrent.done ? '✅ Complete' : (torrent.numPeers > 0 ? '⬇️ Downloading' : '🔍 Finding peers...'));
  $('progress-bar').style.width = pct + '%';
}

// ── Render files ───────────────────────────────────
function renderFiles(files) {
  const list = $('files-list');
  list.innerHTML = '';

  files.forEach((file, index) => {
    const ext = getExt(file.name);
    const isStreamable = STREAMABLE_VIDEO.includes(ext) || STREAMABLE_AUDIO.includes(ext) || STREAMABLE_IMAGE.includes(ext);

    const item = document.createElement('div');
    item.className = 'file-item';
    item.id = `file-item-${index}`;

    item.innerHTML = `
      <span class="file-emoji">${getIcon(file.name)}</span>
      <div class="file-info">
        <div class="file-name" title="${file.name}">${file.name}</div>
        <div class="file-size">${formatBytes(file.length)}</div>
      </div>
      <div class="file-actions">
        ${isStreamable ? `<button class="btn-stream" id="btn-stream-${index}" onclick="streamFile(${index})">▶ Play</button>` : ''}
        <button class="btn-download" id="btn-dl-${index}" onclick="downloadFile(${index})" disabled title="Download becomes active once file is ready">⬇ Download</button>
      </div>
    `;

    list.appendChild(item);
  });

  // Enable downloads progressively as files download
  if (activeTorrent) {
    activeTorrent.files.forEach((file, index) => {
      file.on('done', () => {
        const dlBtn = $(`btn-dl-${index}`);
        if (dlBtn) dlBtn.disabled = false;
      });
    });

    // Also check if already done
    if (activeTorrent.done) {
      activeTorrent.files.forEach((_, index) => {
        const dlBtn = $(`btn-dl-${index}`);
        if (dlBtn) dlBtn.disabled = false;
      });
    }
  }
}

// ── Stream file ────────────────────────────────────
function streamFile(index) {
  if (!activeTorrent) return;
  const file = activeTorrent.files[index];
  const ext = getExt(file.name);

  show('player-section');
  setEl('player-filename', file.name);
  $('player-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Hide all players first
  hide('video-player');
  hide('audio-player');
  hide('image-viewer');

  // Revoke old object URLs to avoid memory leaks
  objectURLs.forEach(url => URL.revokeObjectURL(url));
  objectURLs = [];

  if (STREAMABLE_VIDEO.includes(ext)) {
    const videoEl = $('video-player');

    // Use WebTorrent's renderTo for efficient streaming
    file.renderTo(videoEl, { autoplay: true }, err => {
      if (err) {
        console.error('Stream error:', err);
        showToast('⚠️ Could not stream this file directly. Try downloading it.');
        hide('player-section');
      }
    });

    show('video-player');

  } else if (STREAMABLE_AUDIO.includes(ext)) {
    const audioEl = $('audio-player');

    file.renderTo(audioEl, { autoplay: true }, err => {
      if (err) {
        console.error('Stream error:', err);
        showToast('⚠️ Could not stream audio.');
        hide('player-section');
      }
    });

    show('audio-player');

  } else if (STREAMABLE_IMAGE.includes(ext)) {
    file.getBlobURL((err, url) => {
      if (err) {
        showToast('⚠️ Could not load image.'); return;
      }
      objectURLs.push(url);
      $('image-display').src = url;
      show('image-viewer');
    });
  }
}

// ── Download file ──────────────────────────────────
function downloadFile(index) {
  if (!activeTorrent) return;
  const file = activeTorrent.files[index];

  showToast('⏳ Preparing download...');

  file.getBlobURL((err, url) => {
    if (err) {
      showToast('❌ Download failed: ' + err.message);
      return;
    }

    objectURLs.push(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast('✅ Download started: ' + file.name);
  });
}

// ── Close player ───────────────────────────────────
function closePlayer() {
  const videoEl = $('video-player');
  videoEl.pause();
  videoEl.src = '';
  videoEl.load();

  const audioEl = $('audio-player');
  audioEl.pause();
  audioEl.src = '';
  audioEl.load();

  $('image-display').src = '';

  hide('player-section');
}

// ── Remove torrent ─────────────────────────────────
function removeTorrent(resetInput = true) {
  if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
  closePlayer();

  if (activeTorrent) {
    activeTorrent.destroy();
    activeTorrent = null;
  }

  // Revoke object URLs
  objectURLs.forEach(url => URL.revokeObjectURL(url));
  objectURLs = [];

  hide('status-section');
  hide('player-section');

  if (resetInput) {
    $('magnet-input').value = '';
    $('load-btn').disabled = false;
    show('btn-text');
    hide('btn-spinner');
    showToast('🗑️ Torrent removed.');
  }
}

// ── Allow Enter key to submit ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('magnet-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startTorrent();
  });
});
