/* =====================================================
   TorrentStream v2 — Frontend API Client
   Multi-torrent history support
   ===================================================== */

const API_BASE = '';

const SAMPLE_MAGNET =
  'magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplorer.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com';

const FILE_ICONS = {
  mp4:'🎬',mkv:'🎬',avi:'🎬',mov:'🎬',wmv:'🎬',webm:'🎬',flv:'🎬',m4v:'🎬',
  mp3:'🎵',flac:'🎵',aac:'🎵',wav:'🎵',ogg:'🎵',m4a:'🎵',
  jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',webp:'🖼️',bmp:'🖼️',
  pdf:'📄',txt:'📝',srt:'📝',zip:'🗜️',rar:'🗜️','7z':'🗜️',iso:'💿',
  exe:'⚙️',apk:'📱',epub:'📚',
};

const PLAYABLE_VIDEO = ['mp4','webm','ogg','mov','m4v'];
const PLAYABLE_AUDIO = ['mp3','ogg','wav','aac','m4a','flac'];
const PLAYABLE_IMAGE = ['jpg','jpeg','png','gif','webp','bmp','svg'];

// ── State ─────────────────────────────────────────────────
// Map of infoHash → { name, files, done }
const torrentMap = new Map();

// Global polling interval — polls all active torrents
let globalPollTimer = null;

// ── localStorage persistence ─────────────────────────────
const LS_KEY = 'ts_active_torrents';

function lsSave() {
  // Save minimal info: just infoHash + name (files come back from server on restore)
  const data = [];
  for (const [hash, state] of torrentMap.entries()) {
    data.push({ hash, name: state.name });
  }
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

async function restoreFromStorage() {
  const saved = lsLoad();
  if (!saved.length) return;

  for (const { hash, name } of saved) {
    if (torrentMap.has(hash)) continue;
    try {
      // Check if torrent still exists on the server
      const res = await fetch(`${API_BASE}/api/status/${hash}`);
      if (!res.ok) continue; // server restarted — torrent gone, skip
      const d = await res.json();

      // Re-add to map and render card
      torrentMap.set(hash, { name: d.name || name, files: d.files || [], done: d.done });
      insertCard(hash, d.name || name, d.length, d.files || []);
    } catch {
      // Server offline or torrent gone — skip silently
    }
  }

  if (torrentMap.size > 0) startGlobalPolling();
}


// ── DOM helpers ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id) && $(id).classList.remove('hidden');
const hide = id => $(id) && $(id).classList.add('hidden');
const setText = (id, val) => $(id) && ($(id).textContent = val);

// ── Toast ────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ── Formatters ───────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024,i)).toFixed(1) + ' ' + u[i];
}
function fmtSpeed(b) { return fmtBytes(b) + '/s'; }
function fmtEta(ms) {
  const s = ms / 1000;
  if (!isFinite(s) || s <= 0) return '—';
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  return `${(s/3600).toFixed(1)}h`;
}
function fileExt(name) { return name.split('.').pop().toLowerCase(); }
function fileIcon(name) { return FILE_ICONS[fileExt(name)] || '📁'; }

// Safe card element getter (by infoHash prefix used as ID)
const cardId    = h => `card-${h.slice(0,10)}`;
const cardEl    = h => document.getElementById(cardId(h));
const cardChild = (h, cls) => { const c = cardEl(h); return c ? c.querySelector('.' + cls) : null; };

// ── Sample ───────────────────────────────────────────────
function loadSample() {
  $('magnet-input').value = SAMPLE_MAGNET;
  startTorrent();
}

// ── Add New Torrent ──────────────────────────────────────
async function startTorrent() {
  const magnet = $('magnet-input').value.trim();
  if (!magnet)                        { showToast('⚠️ Please paste a magnet link first.'); return; }
  if (!magnet.startsWith('magnet:'))  { showToast('❌ Not a valid magnet link.'); return; }

  const btn = $('load-btn');
  btn.disabled = true;
  hide('btn-text');
  show('btn-spinner');

  try {
    const res  = await fetch(`${API_BASE}/api/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magnet }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    // If this torrent was already added, just scroll to its card
    if (torrentMap.has(data.infoHash)) {
      showToast('ℹ️ This torrent is already loaded.');
      cardEl(data.infoHash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('magnet-input').value = '';
      return;
    }

    // Save to map
    torrentMap.set(data.infoHash, { name: data.name, files: data.files, done: false });

    // Insert card at TOP of history
    insertCard(data.infoHash, data.name, data.length, data.files);

    // Persist to localStorage
    lsSave();

    // Start global polling if not running
    startGlobalPolling();

    $('magnet-input').value = '';
    showToast(`✅ Torrent added: ${data.name || 'Loading...'}`);

  } catch (err) {
    showToast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    show('btn-text');
    hide('btn-spinner');
  }
}

// ── Insert Torrent Card (newest first) ───────────────────
function insertCard(hash, name, length, files) {
  const container = $('history-container');

  // Show history section if hidden
  show('history-section');
  updateHistoryHeader();

  // Build card HTML
  const card = document.createElement('div');
  card.className = 'torrent-card';
  card.id = cardId(hash);

  card.innerHTML = `
    <div class="torrent-header">
      <div class="torrent-icon">📦</div>
      <div class="torrent-meta">
        <h2 class="torrent-name tc-name">${name || 'Loading metadata...'}</h2>
        <div class="torrent-stats">
          <span class="tc-size">${length ? 'Size: ' + fmtBytes(length) : 'Size: —'}</span>
          <span class="sep">·</span>
          <span class="tc-peers">Peers: 0</span>
          <span class="sep">·</span>
          <span class="tc-status">🔍 Connecting...</span>
        </div>
      </div>
      <button class="close-btn" onclick="removeTorrent('${hash}')" title="Remove">✕</button>
    </div>
    <div class="progress-container">
      <div class="progress-bar-bg">
        <div class="progress-bar-fill tc-bar" style="width:0%"></div>
      </div>
      <div class="progress-stats">
        <span class="tc-pct" style="color:var(--accent);font-weight:600">0%</span>
        <span class="tc-dl" style="color:var(--green)">↓ 0 B/s</span>
        <span class="tc-ul" style="color:var(--accent2)">↑ 0 B/s</span>
        <span class="tc-eta">ETA: —</span>
      </div>
    </div>
    <div class="files-section">
      <h3 class="files-title">Files in this torrent</h3>
      <div class="files-list tc-files">
        ${files && files.length > 0
          ? renderFilesHTML(hash, files)
          : `<div class="files-loading"><div class="mini-spinner"></div><span>Fetching metadata from peers...</span></div>`
        }
      </div>
    </div>`;

  // Insert at top
  container.insertBefore(card, container.firstChild);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Animate in
  card.style.opacity = '0';
  card.style.transform = 'translateY(-12px)';
  requestAnimationFrame(() => {
    card.style.transition = 'opacity .4s ease, transform .4s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  });
}

// ── Render file list HTML ────────────────────────────────
function renderFilesHTML(hash, files) {
  if (!files || files.length === 0) {
    return '<div class="files-loading"><span>No files found.</span></div>';
  }
  return files.map((f, i) => {
    const e = fileExt(f.name);
    // All video + audio + image files → playFile (handles mkv/avi via ffmpeg + detects audio tracks)
    const canPlay = PLAYABLE_VIDEO.includes(e) || PLAYABLE_AUDIO.includes(e)
                 || PLAYABLE_IMAGE.includes(e)
                 || ['mkv','avi','wmv','flv','ts','m2ts'].includes(e);
    const dlUrl   = `${API_BASE}/api/stream/${hash}/${i}?download=1`;
    return `
      <div class="file-item">
        <span class="file-emoji">${fileIcon(f.name)}</span>
        <div class="file-info">
          <div class="file-name" title="${f.name}">${f.name}</div>
          <div class="file-size">${fmtBytes(f.length)}</div>
        </div>
        <div class="file-actions">
          ${canPlay
            ? `<button class="btn-play" onclick="playFile('${hash}',${i},'${encodeURIComponent(f.name)}','${e}')">▶ Play</button>`
            : ''
          }
          <a class="btn-dl" href="${dlUrl}" download="${f.name}">⬇ Download</a>
        </div>
      </div>`;
  }).join('');
}


// ── Global Polling (all active torrents) ─────────────────
function startGlobalPolling() {
  if (globalPollTimer) return;
  globalPollTimer = setInterval(pollAllTorrents, 1500);
  pollAllTorrents(); // immediate
}

function stopGlobalPolling() {
  if (globalPollTimer) { clearInterval(globalPollTimer); globalPollTimer = null; }
}

async function pollAllTorrents() {
  if (torrentMap.size === 0) { stopGlobalPolling(); return; }

  for (const [hash, state] of torrentMap.entries()) {
    // For done torrents: still poll occasionally to confirm status (every ~30s)
    if (state.done && (Date.now() - (state.lastPoll || 0)) < 28000) continue;
    try {
      const res = await fetch(`${API_BASE}/api/status/${hash}`);
      if (!res.ok) continue;
      const d = await res.json();
      if (state) state.lastPoll = Date.now();
      updateCard(hash, d);
    } catch { /* ignore blips */ }
  }
}

// ── Update a Specific Card ────────────────────────────────
function updateCard(hash, d) {
  const card = cardEl(hash);
  if (!card) return;

  const pct = (d.progress * 100).toFixed(1);

  const set = (cls, val) => { const el = card.querySelector('.' + cls); if (el) el.textContent = val; };
  const bar = card.querySelector('.tc-bar');
  if (bar) bar.style.width = pct + '%';

  set('tc-pct',    pct + '%');
  set('tc-peers',  'Peers: ' + d.numPeers);
  set('tc-dl',     '↓ ' + fmtSpeed(d.downloadSpeed));
  set('tc-ul',     '↑ ' + fmtSpeed(d.uploadSpeed));
  set('tc-eta',    'ETA: ' + fmtEta(d.timeRemaining));
  if (d.length)  set('tc-size', 'Size: ' + fmtBytes(d.length));
  if (d.name)    set('tc-name', d.name);

  // ── Files: render as soon as metadata arrives ──────────────
  // d.files is null until WebTorrent fetches the metadata from peers
  const filesEl = card.querySelector('.tc-files');
  if (filesEl && d.files && d.files.length > 0) {
    // If the file list still shows the spinner, replace it with real files
    if (filesEl.querySelector('.mini-spinner')) {
      filesEl.innerHTML = renderFilesHTML(hash, d.files);
    }
  } else if (filesEl && !d.files) {
    // Still waiting — show peer count in the loading message
    const loadSpan = filesEl.querySelector('span');
    if (loadSpan && filesEl.querySelector('.mini-spinner')) {
      loadSpan.textContent = d.numPeers > 0
        ? `Connected to ${d.numPeers} peer${d.numPeers > 1 ? 's' : ''} — fetching metadata...`
        : 'Searching for peers to fetch metadata...';
    }
  }

  if (d.done) {
    set('tc-status', '✅ Complete');
    set('tc-dl',     '↓ 0 B/s');
    set('tc-ul',     '↑ ' + fmtSpeed(d.uploadSpeed));
    set('tc-eta',    'Done!');
    set('tc-pct',    '100%');
    if (bar) { bar.style.width = '100%'; bar.style.boxShadow = '0 0 12px rgba(0,230,118,.7)'; bar.style.background = 'linear-gradient(90deg,#00c853,#00e676)'; }
    // Add done class to card for visual emphasis
    const card = cardEl(hash);
    if (card) card.classList.add('card-done');
    const state = torrentMap.get(hash);
    if (state && !state.done) {
      state.done = true;
      showToast(`✅ Done: ${d.name || 'Torrent'}`, 4000);
    }
  } else {
    set('tc-status', d.numPeers > 0 ? '⬇️ Downloading...' : '🔍 Connecting...');
  }
}


// ── Update history header count ───────────────────────────
function updateHistoryHeader() {
  const count = torrentMap.size;
  const header = $('history-header');
  if (header) header.textContent = `📋 Active Torrents (${count})`;
  if (count === 0) hide('history-section');
}


// ── Remove a Single Torrent Card ─────────────────────────────
async function removeTorrent(hash) {
  const card = cardEl(hash);
  if (card) {
    card.style.transition = 'opacity .3s ease, transform .3s ease';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.97)';
    setTimeout(() => card.remove(), 300);
  }
  torrentMap.delete(hash);
  lsSave();
  updateHistoryHeader();
  try { await fetch(`${API_BASE}/api/remove/${hash}`, { method: 'DELETE' }); } catch {}
  showToast('🗑️ Torrent removed.');
  if (torrentMap.size === 0) stopGlobalPolling();
}

// ── Remove ALL torrents ───────────────────────────────────────
async function removeAllTorrents() {
  for (const hash of torrentMap.keys()) {
    try { await fetch(`${API_BASE}/api/remove/${hash}`, { method: 'DELETE' }); } catch {}
  }
  torrentMap.clear();
  lsSave();
  $('history-container').innerHTML = '';
  hide('history-section');
  stopGlobalPolling();
  showToast('🗑️ All torrents cleared.');
}


// ── Play File ────────────────────────────────────────────────
function playFile(hash, fileIndex, encodedName, ext_) {
  const name = decodeURIComponent(encodedName);
  const url  = `${API_BASE}/api/stream/${hash}/${fileIndex}`;

  // Open modal
  $('player-modal').classList.remove('hidden');
  $('player-filename').textContent = name;
  document.body.style.overflow = 'hidden';

  // Reset all players
  ['video-player','audio-player','image-viewer','unsupported-msg'].forEach(id => {
    hide(id);
    if (id === 'video-player') { $(id).pause(); $(id).src = ''; }
    if (id === 'audio-player') { $(id).pause(); $(id).src = ''; }
  });
  $('image-display').src = '';

  if (PLAYABLE_IMAGE.includes(ext_)) {
    $('image-display').src = url; show('image-viewer'); return;
  }
  if (PLAYABLE_AUDIO.includes(ext_)) {
    const a = $('audio-player'); a.src = url; a.load(); a.play().catch(() => {}); show('audio-player'); return;
  }

  // All video types → direct stream with HTTP range requests (fully seekable)
  const v = $('video-player');
  v.src = url; v.load(); v.play().catch(() => {}); show('video-player');

  const mkvLike = ['mkv','avi','wmv','flv','ts','m2ts'].includes(ext_);
  if (mkvLike) showToast('⚠️ MKV/AVI — if video is blank, use ⬇ Download instead.', 4000);
}




// ── Close Modal Player ───────────────────────────────────────
function closePlayer() {
  const v = $('video-player'); v.pause(); v.src = ''; v.load();
  const a = $('audio-player'); a.pause(); a.src = ''; a.load();
  $('image-display').src = '';
  $('player-modal').classList.add('hidden');
  document.body.style.overflow = ''; // restore scroll
  const bar = document.getElementById('track-selector-bar');
  if (bar) bar.remove();
}

// Click backdrop to close
function handleModalClick(e) {
  if (e.target === $('player-modal')) closePlayer();
}


// ── Auth & User Session ──────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch('/auth/me');
    const data = await res.json();
    
    if (!data.authenticated) {
      window.location.href = '/login.html';
      return;
    }

    const user = data.user;
    window.currentUser = user; // Store for profile modal
    const profileEl = document.getElementById('user-profile');
    if (profileEl) {
      profileEl.innerHTML = `
        <div class="user-info" onclick="toggleDropdown(event)">
          <img src="${user.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(user.name)+'&background=6366f1&color=fff'}" class="user-avatar" alt="User">
          <span class="user-name">${user.name}</span>
          <span class="dropdown-arrow">▼</span>
        </div>
        <div id="profile-dropdown" class="profile-dropdown hidden">
          <button class="dropdown-item" onclick="openProfile()">
            <i>👤</i> My Profile
          </button>
          <button class="dropdown-item" onclick="openAbout()">
            <i>ℹ️</i> About Us
          </button>
          <div class="dropdown-divider"></div>
          <a href="/auth/logout" class="dropdown-item logout">
            <i>🚪</i> Logout
          </a>
        </div>
      `;
      profileEl.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Auth check failed', err);
  }
}

function toggleDropdown(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

// Global click handler for dropdown and modals
document.addEventListener('click', () => {
  const dropdown = document.getElementById('profile-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
});

// ── About Modal ──────────────────────────────────────────────
function openAbout() { show('about-modal'); document.body.style.overflow = 'hidden'; }
function closeAbout() { hide('about-modal'); document.body.style.overflow = ''; }
function handleAboutClick(e) { if (e.target === $('about-modal')) closeAbout(); }

// ── Profile Modal ──────────────────────────────────────────────
function openProfile() {
  const user = window.currentUser;
  if (!user) return;
  
  $('prof-avatar').src = user.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(user.name)+'&background=6366f1&color=fff';
  $('prof-name').textContent = user.name;
  $('prof-email').textContent = user.email || 'No email provided';
  
  // Format join date
  if (user.created_at) {
    const date = new Date(user.created_at);
    $('prof-joined').textContent = `Member since ${date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`;
  }
  
  show('profile-modal');
  document.body.style.overflow = 'hidden';
}

function closeProfile() { hide('profile-modal'); document.body.style.overflow = ''; }
function handleProfileClick(e) { if (e.target === $('profile-modal')) closeProfile(); }

function logout() {
  window.location.href = '/auth/logout';
}

async function deleteAccount() {
  const confirmed = confirm("⚠️ Are you absolutely sure? This will delete your account and all torrent history permanently.");
  if (!confirmed) return;
  
  try {
    const res = await fetch('/auth/delete-account', { method: 'DELETE' });
    if (res.ok) {
      alert("Account deleted successfully. Logging out...");
      window.location.href = '/login.html';
    } else {
      showToast("Error deleting account.");
    }
  } catch (err) {
    showToast("Server error. Try again later.");
  }
}

// ── Enter key + restore on load ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check if session is valid first
  checkAuth();

  $('magnet-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startTorrent();
  });

  // ESC key closes the player modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePlayer();
  });

  // Restore previous torrents from localStorage (if server still has them)
  restoreFromStorage();
});



