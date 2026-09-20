// --- i18n ---
let STR = {};
let CURRENT_LANG = localStorage.getItem('resonance_lang') || 'fr';

async function loadLang(lang) {
  const res = await fetch('/locales/' + lang + '.json');
  STR = await res.json();
  CURRENT_LANG = lang;
  localStorage.setItem('resonance_lang', lang);
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (STR[key]) el.textContent = STR[key];
  });
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-lang') === lang);
  });
  document.documentElement.lang = lang;
}

function t(key) {
  return STR[key] || key;
}

document.querySelectorAll('.lang-btn').forEach((btn) => {
  btn.addEventListener('click', () => loadLang(btn.getAttribute('data-lang')));
});

// --- Toast ---
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

// --- Decorative waveform ---
(function () {
  const g = document.getElementById('bars');
  let x = 0;
  for (let i = 0; i < 40; i++) {
    const h = 14 + Math.abs(Math.sin(i * 0.7)) * 70 + Math.random() * 16;
    const y = (120 - h) / 2;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', 3.5);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', 1.5);
    g.appendChild(rect);
    x += 6;
  }
})();

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- État courant ---
let currentUser = null;

async function refreshMe() {
  const res = await fetch('/api/me');
  const data = await res.json();
  currentUser = data.user;
  updateAuthUI();
  updateAdminUI();
  if (currentUser) {
    fillProfileForm(currentUser);
    loadMyTracks();
  }
}

function updateAuthUI() {
  const authBlock = document.getElementById('auth-block');
  const dashboardBlock = document.getElementById('dashboard-block');
  const navLogin = document.getElementById('nav-login');
  const navLogout = document.getElementById('nav-logout');
  const navDashboard = document.getElementById('nav-dashboard');

  if (currentUser) {
    authBlock.hidden = true;
    dashboardBlock.hidden = false;
    navLogin.hidden = true;
    navLogout.hidden = false;
    navDashboard.hidden = false;
  } else {
    authBlock.hidden = false;
    dashboardBlock.hidden = true;
    navLogin.hidden = false;
    navLogout.hidden = true;
    navDashboard.hidden = true;
  }
}

// --- Auth forms toggle ---
document.getElementById('show-signup').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-form-wrap').hidden = true;
  document.getElementById('signup-form-wrap').hidden = false;
});
document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('signup-form-wrap').hidden = true;
  document.getElementById('login-form-wrap').hidden = false;
});

// --- Signup ---
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('signup-status');
  status.textContent = '';
  const body = {
    artistName: document.getElementById('signup-artistName').value.trim(),
    email: document.getElementById('signup-email').value.trim(),
    password: document.getElementById('signup-password').value,
  };
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    status.textContent = t('error.' + data.error) || t('error.generic');
    return;
  }
  await refreshMe();
  showToast('👋');
});

// --- Login ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('login-status');
  status.textContent = '';
  const body = {
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
  };
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    status.textContent = t('error.' + data.error) || t('error.generic');
    return;
  }
  await refreshMe();
});

// --- Logout ---
document.getElementById('nav-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  updateAuthUI();
  updateAdminUI();
});

// --- Profil ---
function fillProfileForm(user) {
  document.getElementById('profile-artistName').value = user.artistName || '';
  document.getElementById('profile-bio').value = user.bio || '';
  document.getElementById('profile-donationLink').value = user.donationLink || '';
  document.getElementById('profile-spotifyUrl').value = user.spotifyUrl || '';
  document.getElementById('profile-appleUrl').value = user.appleUrl || '';
  document.getElementById('profile-soundcloudUrl').value = user.soundcloudUrl || '';
  document.getElementById('profile-instagramUrl').value = user.instagramUrl || '';
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('profile-status');
  const body = {
    artistName: document.getElementById('profile-artistName').value.trim(),
    bio: document.getElementById('profile-bio').value.trim(),
    donationLink: document.getElementById('profile-donationLink').value.trim(),
    spotifyUrl: document.getElementById('profile-spotifyUrl').value.trim(),
    appleUrl: document.getElementById('profile-appleUrl').value.trim(),
    soundcloudUrl: document.getElementById('profile-soundcloudUrl').value.trim(),
    instagramUrl: document.getElementById('profile-instagramUrl').value.trim(),
  };
  const res = await fetch('/api/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.ok) {
    currentUser = data.user;
    status.textContent = '✓';
    setTimeout(() => (status.textContent = ''), 2000);
    loadFeed();
  } else {
    status.textContent = t('error.generic');
  }
});

// --- Sélection du niveau IA (affiche/masque le détail outil) ---
document.querySelectorAll('input[name="ai-level"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const block = document.getElementById('ai-detail-block');
    block.hidden = document.querySelector('input[name="ai-level"]:checked').value === 'none';
  });
});
document.getElementById('track-aiTool').addEventListener('change', (e) => {
  document.getElementById('track-aiToolOther').hidden = e.target.value !== 'autre';
});

// --- Ajout de morceau ---
document.getElementById('track-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('track-status');
  const fileInput = document.getElementById('track-audio');
  if (!fileInput.files[0]) return;

  const aiLevel = document.querySelector('input[name="ai-level"]:checked').value;
  let aiTool = '';
  if (aiLevel !== 'none') {
    const toolSelect = document.getElementById('track-aiTool').value;
    aiTool = toolSelect === 'autre' ? document.getElementById('track-aiToolOther').value.trim() : toolSelect;
  }

  const formData = new FormData();
  formData.append('title', document.getElementById('track-title').value.trim());
  formData.append('genre', document.getElementById('track-genre').value.trim());
  formData.append('aiLevel', aiLevel);
  formData.append('aiTool', aiTool);
  formData.append('audio', fileInput.files[0]);

  status.textContent = '…';
  const res = await fetch('/api/tracks', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    status.textContent = data.message || t('error.generic');
    return;
  }
  status.textContent = '';
  document.getElementById('track-form').reset();
  document.getElementById('ai-detail-block').hidden = true;
  document.getElementById('track-aiToolOther').hidden = true;
  showToast('✓');
  loadMyTracks();
  loadFeed();
});

async function loadMyTracks() {
  const res = await fetch('/api/me/tracks');
  if (!res.ok) return;
  const { tracks } = await res.json();
  const list = document.getElementById('my-tracks-list');
  if (tracks.length === 0) {
    list.innerHTML = '<p class="empty-state">' + t('dashboard.myTracks.empty') + '</p>';
    return;
  }
  list.innerHTML = tracks
    .map((tr) => {
      const dist = tr.distribution;
      let distHtml;
      if (dist) {
        distHtml = '<span class="dist-status">' + t('dist.status.' + dist.status) + '</span>';
      } else {
        distHtml = '<button class="mini-btn dist-only-btn" data-dist-id="' + tr.id + '">' + t('dist.button') + '</button>';
      }
      return (
        '<div class="my-track-row"><span class="title">' +
        escapeHtml(tr.title) +
        '</span><div style="display:flex; gap:10px; align-items:center;">' +
        distHtml +
        '<button class="del-btn" data-id="' +
        tr.id +
        '">' +
        t('dashboard.myTracks.delete') +
        '</button></div></div>'
      );
    })
    .join('');
  list.querySelectorAll('.dist-only-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.textContent = '…';
      const res = await fetch('/api/tracks/' + btn.getAttribute('data-dist-id') + '/distribute', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error === 'not_configured' ? t('dist.notConfigured') : t('error.generic'));
        btn.textContent = t('dist.button');
        return;
      }
      loadMyTracks();
    });
  });
  list.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch('/api/tracks/' + btn.getAttribute('data-id'), { method: 'DELETE' });
      loadMyTracks();
      loadFeed();
    });
  });
}

// --- Feed public ---
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(CURRENT_LANG === 'en' ? 'en-GB' : 'fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderTrackCard(tr) {
  const tags = [];
  if (tr.genre) tags.push('<span class="tag">' + escapeHtml(tr.genre) + '</span>');
  if (tr.aiLevel === 'assisted') tags.push('<span class="tag ai">' + t('ai.tag.assisted') + (tr.aiTool ? ' · ' + escapeHtml(tr.aiTool) : '') + '</span>');
  if (tr.aiLevel === 'generated') tags.push('<span class="tag ai">' + t('ai.tag.generated') + (tr.aiTool ? ' · ' + escapeHtml(tr.aiTool) : '') + '</span>');

  const links = [];
  if (tr.spotifyUrl) links.push(linkPill(tr.spotifyUrl, t('link.spotify')));
  if (tr.appleUrl) links.push(linkPill(tr.appleUrl, t('link.apple')));
  if (tr.soundcloudUrl) links.push(linkPill(tr.soundcloudUrl, t('link.soundcloud')));
  if (tr.instagramUrl) links.push(linkPill(tr.instagramUrl, t('link.instagram')));
  if (tr.donationLink) links.push(linkPill(tr.donationLink, t('link.donate'), true));

  return (
    '<div class="track">' +
    '<audio controls controlsList="nodownload" oncontextmenu="return false" preload="none" src="' +
    escapeHtml(tr.audioUrl) +
    '"></audio>' +
    '<div class="meta"><h3>' +
    escapeHtml(tr.title) +
    '</h3><div class="artist"><a class="artist-name-link" href="#/artiste/' +
    tr.userId +
    '">' +
    escapeHtml(tr.artistName) +
    '</a></div><div class="tags">' +
    tags.join('') +
    '</div><div class="copyright">© ' +
    escapeHtml(tr.artistName) +
    ' · ' +
    t('track.publishedOn') +
    ' ' +
    formatDate(tr.createdAt) +
    '</div></div>' +
    '<div class="actions">' +
    links.join('') +
    '</div></div>'
  );
}
function linkPill(url, label, donate) {
  return (
    '<a class="link-pill' +
    (donate ? ' donate' : '') +
    '" href="' +
    escapeHtml(url) +
    '" target="_blank" rel="noopener">' +
    label +
    '</a>'
  );
}

async function loadFeed() {
  const feed = document.getElementById('feed');
  const res = await fetch('/api/tracks');
  const { tracks } = await res.json();

  if (tracks.length === 0) {
    feed.innerHTML = '<div class="empty-state">' + t('discover.empty') + '</div>';
    return;
  }
  feed.innerHTML = tracks.map(renderTrackCard).join('');
}

// --- Administration ---
function updateAdminUI() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('nav-admin').hidden = !isAdmin;
  document.getElementById('admin-block').hidden = !isAdmin;
  if (isAdmin) loadAdminOverview();
}

async function loadAdminOverview() {
  const res = await fetch('/api/admin/overview');
  if (!res.ok) return;
  const { users, tracks } = await res.json();

  const usersList = document.getElementById('admin-users-list');
  usersList.innerHTML = users
    .map(
      (u) =>
        '<div class="admin-row"><div class="who"><span>' +
        escapeHtml(u.artistName) +
        (u.role === 'admin' ? ' · admin' : '') +
        '</span><span class="sub">' +
        escapeHtml(u.email) +
        '</span></div>' +
        (u.role === 'admin'
          ? ''
          : '<button class="del-btn" data-user-id="' + u.id + '">' + t('admin.remove') + '</button>') +
        '</div>'
    )
    .join('');
  usersList.querySelectorAll('[data-user-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.confirmRemoveUser'))) return;
      await fetch('/api/admin/users/' + btn.getAttribute('data-user-id'), { method: 'DELETE' });
      loadAdminOverview();
      loadFeed();
    });
  });

  const tracksList = document.getElementById('admin-tracks-list');
  tracksList.innerHTML = tracks
    .map(
      (tr) =>
        '<div class="admin-row"><div class="who"><span>' +
        escapeHtml(tr.title) +
        '</span><span class="sub">' +
        escapeHtml(tr.artistName) +
        '</span></div>' +
        '<button class="del-btn" data-track-id="' +
        tr.id +
        '">' +
        t('admin.remove') +
        '</button></div>'
    )
    .join('');
  tracksList.querySelectorAll('[data-track-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.confirmRemoveTrack'))) return;
      await fetch('/api/admin/tracks/' + btn.getAttribute('data-track-id'), { method: 'DELETE' });
      loadAdminOverview();
      loadFeed();
    });
  });
}

// --- Page artiste publique ---
document.getElementById('back-to-discover').addEventListener('click', () => {
  window.location.hash = '#decouvrir';
});

async function loadArtistPage(artistId) {
  const res = await fetch('/api/artists/' + artistId);
  if (!res.ok) {
    window.location.hash = '#decouvrir';
    return;
  }
  const { artist, tracks, followerCount, isFollowing } = await res.json();

  document.getElementById('artist-page-name').textContent = artist.artistName;
  document.getElementById('artist-page-bio').textContent = artist.bio || '';
  document.getElementById('artist-page-bio').hidden = !artist.bio;

  const links = [];
  if (artist.spotifyUrl) links.push(linkPill(artist.spotifyUrl, t('link.spotify')));
  if (artist.appleUrl) links.push(linkPill(artist.appleUrl, t('link.apple')));
  if (artist.soundcloudUrl) links.push(linkPill(artist.soundcloudUrl, t('link.soundcloud')));
  if (artist.instagramUrl) links.push(linkPill(artist.instagramUrl, t('link.instagram')));
  if (artist.donationLink) links.push(linkPill(artist.donationLink, t('link.donate'), true));
  document.getElementById('artist-page-links').innerHTML = links.join('');

  document.getElementById('artist-follower-count').textContent =
    followerCount + ' ' + (followerCount === 1 ? t('artist.follower') : t('artist.followers'));

  const followBtn = document.getElementById('follow-btn');
  const isMe = currentUser && currentUser.id === artist.id;
  if (!currentUser || isMe) {
    followBtn.hidden = true;
  } else {
    followBtn.hidden = false;
    followBtn.textContent = isFollowing ? t('artist.unfollow') : t('artist.follow');
    followBtn.onclick = async () => {
      const action = followBtn.textContent === t('artist.follow') ? 'follow' : 'unfollow';
      await fetch('/api/artists/' + artist.id + '/' + action, { method: 'POST' });
      loadArtistPage(artistId);
    };
  }

  const tracksFeed = document.getElementById('artist-page-tracks');
  tracksFeed.innerHTML =
    tracks.length === 0 ? '<div class="empty-state">' + t('discover.empty') + '</div>' : tracks.map(renderTrackCard).join('');
}

function handleRoute() {
  const match = window.location.hash.match(/^#\/artiste\/(\d+)$/);
  const artistSection = document.getElementById('artiste');
  const mainViews = document.querySelectorAll('.main-view');
  if (match) {
    mainViews.forEach((el) => (el.hidden = true));
    artistSection.hidden = false;
    loadArtistPage(match[1]);
    window.scrollTo(0, 0);
  } else {
    mainViews.forEach((el) => (el.hidden = false));
    artistSection.hidden = true;
  }
}
window.addEventListener('hashchange', handleRoute);

// --- Service worker (installation en app) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// --- Init ---
(async function init() {
  await loadLang(CURRENT_LANG);
  await refreshMe();
  await loadFeed();
  handleRoute();
})();
