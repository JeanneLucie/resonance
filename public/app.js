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
    if (STR[key]) el.innerHTML = STR[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (STR[key]) el.placeholder = STR[key];
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
// Affiche un compte à rebours en direct dans une zone de statut,
// quand le serveur a répondu "trop de tentatives" — plus rassurant
// qu'un simple message statique.
function showRateLimitCountdown(statusEl, retryAfterSeconds) {
  let remaining = Math.max(1, retryAfterSeconds);
  const render = () => {
    const m = Math.floor(remaining / 60);
    const s = (remaining % 60).toString().padStart(2, '0');
    statusEl.textContent = t('error.too_many_attempts_countdown').replace('{time}', m + ':' + s);
  };
  render();
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      statusEl.textContent = t('error.too_many_attempts_over');
      return;
    }
    render();
  }, 1000);
}

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('signup-status');
  status.textContent = '';
  const body = {
    artistName: document.getElementById('signup-artistName').value.trim(),
    email: document.getElementById('signup-email').value.trim(),
    password: document.getElementById('signup-password').value,
    acceptedTerms: document.getElementById('signup-terms').checked,
  };
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 1800;
    showRateLimitCountdown(status, retryAfter);
    return;
  }
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
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 1800;
    showRateLimitCountdown(status, retryAfter);
    return;
  }
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
  window.location.hash = '';
  window.scrollTo(0, 0);
});

// --- Profil ---
function fillProfileForm(user) {
  document.getElementById('profile-artistName').value = user.artistName || '';
  document.getElementById('profile-bio').value = user.bio || '';
  document.getElementById('profile-donationLink').value = user.donationLink || '';
  document.getElementById('profile-soundcloudUrl').value = user.soundcloudUrl || '';
  document.getElementById('profile-instagramUrl').value = user.instagramUrl || '';
  document.getElementById('profile-sunoUrl').value = user.sunoUrl || '';

  const avatarPreview = document.getElementById('profile-avatar-preview');
  if (user.avatarUrl) { avatarPreview.src = user.avatarUrl; avatarPreview.hidden = false; } else { avatarPreview.hidden = true; avatarPreview.src = ''; }
  const bannerPreview = document.getElementById('profile-banner-preview');
  if (user.bannerUrl) { bannerPreview.src = user.bannerUrl; bannerPreview.hidden = false; } else { bannerPreview.hidden = true; bannerPreview.src = ''; }
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('profile-status');
  const formData = new FormData();
  formData.append('artistName', document.getElementById('profile-artistName').value.trim());
  formData.append('bio', document.getElementById('profile-bio').value.trim());
  formData.append('donationLink', document.getElementById('profile-donationLink').value.trim());
  formData.append('soundcloudUrl', document.getElementById('profile-soundcloudUrl').value.trim());
  formData.append('instagramUrl', document.getElementById('profile-instagramUrl').value.trim());
  formData.append('sunoUrl', document.getElementById('profile-sunoUrl').value.trim());
  const avatarFile = document.getElementById('profile-avatar').files[0];
  if (avatarFile) formData.append('avatar', avatarFile);
  const bannerFile = document.getElementById('profile-banner').files[0];
  if (bannerFile) formData.append('banner', bannerFile);

  const res = await fetch('/api/me', { method: 'PUT', body: formData });
  const data = await res.json();
  if (res.ok) {
    currentUser = data.user;
    fillProfileForm(currentUser);
    status.textContent = '✓';
    setTimeout(() => (status.textContent = ''), 2000);
    loadFeed();
    refreshOnboarding();
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
let trackFormDirty = false;
document.getElementById('track-form').addEventListener('input', () => {
  trackFormDirty = true;
});
window.addEventListener('beforeunload', (e) => {
  if (trackFormDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

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
  formData.append('collaborators', document.getElementById('track-collaborators').value.trim());
  formData.append('spotifyUrl', document.getElementById('track-spotifyUrl').value.trim());
  formData.append('appleUrl', document.getElementById('track-appleUrl').value.trim());
  formData.append('genesis', document.getElementById('track-genesis').value.trim());
  formData.append('explicit', document.getElementById('track-explicit').checked);
  formData.append('aiLevel', aiLevel);
  formData.append('aiTool', aiTool);
  formData.append('audio', fileInput.files[0]);
  const coverInput = document.getElementById('track-cover');
  if (coverInput.files[0]) formData.append('cover', coverInput.files[0]);

  status.textContent = '…';
  const res = await fetch('/api/tracks', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    status.textContent = data.error === 'email_not_verified' ? t('verify.blocksPublishShort') : data.message || t('error.generic');
    return;
  }
  status.textContent = '';
  document.getElementById('track-form').reset();
  trackFormDirty = false;
  document.getElementById('ai-detail-block').hidden = true;
  document.getElementById('track-aiToolOther').hidden = true;
  showToast('✓');
  loadMyTracks();
  loadFeed();
});

let MY_TRACKS = [];

function refreshOnboarding() {
  if (!currentUser) return;
  const banner = document.getElementById('verify-email-banner');
  banner.hidden = currentUser.emailVerified !== false;
  const publishBlock = document.getElementById('verify-blocks-publish');
  publishBlock.hidden = !(currentUser.emailVerified === false && MY_TRACKS.length >= 1);
  const steps = [
    { done: !!currentUser.avatarUrl, key: 'onboarding.step.avatar' },
    { done: !!(currentUser.bio && currentUser.bio.trim()), key: 'onboarding.step.bio' },
    { done: !!currentUser.donationLink, key: 'onboarding.step.donation' },
    { done: !!(currentUser.soundcloudUrl || currentUser.instagramUrl || currentUser.sunoUrl), key: 'onboarding.step.social' },
    { done: MY_TRACKS.length > 0, key: 'onboarding.step.track' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const panel = document.getElementById('onboarding-panel');
  if (doneCount === steps.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  document.getElementById('onboarding-progress-text').textContent = doneCount + '/' + steps.length + ' ' + t('onboarding.stepsDone');
  document.getElementById('onboarding-bar-fill').style.width = Math.round((doneCount / steps.length) * 100) + '%';
  document.getElementById('onboarding-list').innerHTML = steps
    .map((s) => '<li class="' + (s.done ? 'done' : '') + '"><span class="check">' + (s.done ? '✓' : '○') + '</span>' + t(s.key) + '</li>')
    .join('');
}

async function loadStats() {
  const totalPlays = MY_TRACKS.reduce((sum, tr) => sum + (tr.plays || 0), 0);
  document.getElementById('stats-total-plays').textContent = totalPlays;

  let followerCount = 0;
  if (currentUser) {
    try {
      const res = await fetch('/api/artists/' + currentUser.id);
      if (res.ok) followerCount = (await res.json()).followerCount || 0;
    } catch (err) {
      /* silencieux */
    }
  }
  document.getElementById('stats-followers').textContent = followerCount;

  const list = document.getElementById('stats-tracks-list');
  if (MY_TRACKS.length === 0) {
    list.innerHTML = '<p class="stats-empty">' + t('stats.empty') + '</p>';
    return;
  }
  const sorted = [...MY_TRACKS].sort((a, b) => (b.plays || 0) - (a.plays || 0));
  const maxPlays = Math.max(1, sorted[0].plays || 0);
  list.innerHTML = sorted
    .map(
      (tr) =>
        '<div class="stats-track-row"><div class="stats-track-top"><span class="stats-track-title">' +
        escapeHtml(tr.title) +
        '</span><span class="stats-track-count">' +
        (tr.plays === 1 ? t('track.playsOne') : t('track.playsMany').replace('{n}', tr.plays || 0)) +
        '</span></div><div class="stats-bar-track"><div class="stats-bar-fill" style="width:' +
        Math.round(((tr.plays || 0) / maxPlays) * 100) +
        '%"></div></div></div>'
    )
    .join('');
}

async function loadMyTracks() {
  const res = await fetch('/api/me/tracks');
  if (!res.ok) return;
  const { tracks } = await res.json();
  MY_TRACKS = tracks;
  loadStats();
  refreshOnboarding();
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
      const payHtml = '<button class="mini-btn pay-dist-btn" data-pay-id="' + tr.id + '">' + t('pay.button') + '</button>';
      return (
        '<div class="my-track-row"><span class="title">' +
        escapeHtml(tr.title) +
        '<span class="my-track-date">' + formatDate(tr.createdAt) + ' · ' + (tr.plays === 1 ? t('track.playsOne') : t('track.playsMany').replace('{n}', tr.plays)) + '</span>' +
        '</span><div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">' +
        distHtml +
        payHtml +
        '<button class="mini-btn edit-only-btn" data-edit-id="' +
        tr.id +
        '">' +
        t('dashboard.myTracks.edit') +
        '</button>' +
        '<button class="mini-btn promo-btn" data-promo-id="' +
        tr.id +
        '">' +
        t('dashboard.myTracks.promo') +
        '</button>' +
        '<button class="del-btn" data-id="' +
        tr.id +
        '">' +
        t('dashboard.myTracks.delete') +
        '</button></div></div>' +
        '<div class="edit-panel" id="edit-panel-' +
        tr.id +
        '" hidden></div>'
      );
    })
    .join('');
  list.querySelectorAll('.edit-only-btn').forEach((btn) => {
    btn.addEventListener('click', () => toggleEditPanel(Number(btn.getAttribute('data-edit-id'))));
  });
  list.querySelectorAll('.promo-btn').forEach((btn) => {
    btn.addEventListener('click', () => generatePromoVisual(Number(btn.getAttribute('data-promo-id'))));
  });
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
  list.querySelectorAll('.pay-dist-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.textContent = '…';
      const res = await fetch('/api/tracks/' + btn.getAttribute('data-pay-id') + '/pay-distribution', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error === 'not_configured' ? t('pay.notConfigured') : t('error.generic'));
        btn.textContent = t('pay.button');
        return;
      }
      window.location.href = data.checkoutUrl;
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

function coverArt(tr) {
  if (tr.coverUrl) {
    return '<img class="cover-art" src="' + escapeHtml(tr.coverUrl) + '" alt="">';
  }
  const letter = (tr.title || '?').trim().charAt(0).toUpperCase();
  const palette = [
    ['#D98F3D', '#B8721F'],
    ['#4FA69B', '#2E7B71'],
    ['#8C6FB0', '#5F4A82'],
  ];
  const [c1, c2] = palette[Math.abs(tr.id || 0) % palette.length];
  return (
    '<div class="cover-art" style="background:linear-gradient(145deg,' +
    c1 +
    ',' +
    c2 +
    ')">' +
    escapeHtml(letter) +
    '</div>'
  );
}

function renderTrackCard(tr) {
  const tags = [];
  if (tr.genre) tags.push('<span class="tag">' + escapeHtml(tr.genre) + '</span>');
  if (tr.aiLevel === 'assisted') tags.push('<span class="tag ai">' + t('ai.tag.assisted') + (tr.aiTool ? ' · ' + escapeHtml(tr.aiTool) : '') + '</span>');
  if (tr.aiLevel === 'generated') tags.push('<span class="tag ai">' + t('ai.tag.generated') + (tr.aiTool ? ' · ' + escapeHtml(tr.aiTool) : '') + '</span>');
  if (tr.explicit) tags.push('<span class="tag explicit">' + t('tag.explicit') + '</span>');
  if (Date.now() - tr.createdAt < 7 * 24 * 60 * 60 * 1000) tags.push('<span class="tag new">' + t('tag.new') + '</span>');

  const streamingLinks = [];
  if (tr.spotifyUrl) streamingLinks.push(linkPill(tr.spotifyUrl, t('link.spotify')));
  if (tr.appleUrl) streamingLinks.push(linkPill(tr.appleUrl, t('link.apple')));

  const otherLinks = [];
  if (tr.soundcloudUrl) otherLinks.push(linkPill(tr.soundcloudUrl, t('link.soundcloud')));
  if (tr.instagramUrl) otherLinks.push(linkPill(tr.instagramUrl, t('link.instagram')));
  if (tr.sunoUrl) otherLinks.push(linkPill(tr.sunoUrl, t('link.suno')));
  if (tr.donationLink) otherLinks.push(linkPill(tr.donationLink, t('link.donate'), true));

  return (
    '<div class="track">' +
    coverArt(tr) +
    '<div class="track-body">' +
    '<div class="meta"><h3>' +
    escapeHtml(tr.title) +
    '</h3><div class="artist"><a class="artist-name-link" href="#/artiste/' +
    tr.userId +
    '">' +
    escapeHtml(tr.artistName) +
    '</a>' +
    (tr.collaborators ? '<span class="collab"> · ' + t('track.with') + ' ' + escapeHtml(tr.collaborators) + '</span>' : '') +
    '</div><div class="tags">' +
    tags.join('') +
    '</div></div>' +
    '<button type="button" class="play-track-btn" aria-label="' +
    t('track.playAria').replace('{title}', escapeHtml(tr.title)) +
    '" data-track-id="' +
    tr.id +
    '" data-audio-url="' +
    escapeHtml(tr.audioUrl) +
    '" data-title="' +
    escapeHtml(tr.title) +
    '" data-artist="' +
    escapeHtml(tr.artistName) +
    '" data-cover="' +
    escapeHtml(tr.coverUrl || '') +
    '" data-cover-fallback="' +
    escapeHtml((tr.title || '?').trim().charAt(0).toUpperCase()) +
    '" data-cover-id="' +
    tr.id +
    '"><span class="play-icon">▶</span></button>' +
    '<div class="copyright">© ' +
    escapeHtml(tr.artistName) +
    ' · ' +
    t('track.publishedOn') +
    ' ' +
    formatDate(tr.createdAt) +
    ' · ' +
    (tr.plays === 1 ? t('track.playsOne') : t('track.playsMany').replace('{n}', tr.plays)) +
    '</div>' +
    (tr.genesis
      ? '<details class="genesis"><summary>' + t('track.genesisToggle') + '</summary><p>' + escapeHtml(tr.genesis) + '</p></details>'
      : '') +
    '</div>' +
    '<div class="actions">' +
    (streamingLinks.length ? '<div class="actions-row">' + streamingLinks.join('') + '</div>' : '') +
    '<div class="actions-row">' +
    otherLinks.join('') +
    '<button type="button" class="link-pill share-track-btn" title="' +
    t('track.shareTooltip') +
    '" data-share-url="' +
    escapeHtml(window.location.origin + '/#/morceau/' + tr.id) +
    '">🔗</button>' +
    '<button type="button" class="link-pill report-track-btn" data-report-id="' +
    tr.id +
    '" title="' +
    t('track.report') +
    '">🚩</button>' +
    '</div></div></div>'
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

let ALL_TRACKS = [];

async function loadFeed() {
  const res = await fetch('/api/tracks');
  const { tracks } = await res.json();
  ALL_TRACKS = tracks;
  populateGenreFilter(tracks);
  renderFilteredFeed();
}

function populateGenreFilter(tracks) {
  const select = document.getElementById('discover-genre');
  const current = select.value;
  const genres = [...new Set(tracks.map((t) => t.genre).filter(Boolean))].sort();
  const staticOption = select.querySelector('option[value=""]');
  select.innerHTML = '';
  select.appendChild(staticOption);
  genres.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    select.appendChild(opt);
  });
  select.value = current;
}

function renderFilteredFeed() {
  const feed = document.getElementById('feed');
  const query = document.getElementById('discover-search').value.trim().toLowerCase();
  const genre = document.getElementById('discover-genre').value;
  const aiLevel = document.getElementById('discover-ai').value;
  const hideExplicit = document.getElementById('discover-hide-explicit').checked;

  const filtered = ALL_TRACKS.filter((tr) => {
    const matchesQuery = !query || tr.title.toLowerCase().includes(query) || tr.artistName.toLowerCase().includes(query);
    const matchesGenre = !genre || tr.genre === genre;
    const matchesAi = !aiLevel || tr.aiLevel === aiLevel;
    const matchesExplicit = !hideExplicit || !tr.explicit;
    return matchesQuery && matchesGenre && matchesAi && matchesExplicit;
  });

  if (filtered.length === 0) {
    feed.innerHTML = '<div class="empty-state">' + (ALL_TRACKS.length === 0 ? t('discover.empty') : t('discover.noMatch')) + '</div>';
    return;
  }
  feed.innerHTML = filtered.map(renderTrackCard).join('');
  currentDiscoverQueue = filtered;
  refreshPlayButtons();
}

document.getElementById('discover-search').addEventListener('input', renderFilteredFeed);
document.getElementById('discover-genre').addEventListener('change', renderFilteredFeed);
document.getElementById('discover-ai').addEventListener('change', renderFilteredFeed);

const hideExplicitCheckbox = document.getElementById('discover-hide-explicit');
const savedHideExplicit = localStorage.getItem('resonance_hide_explicit');
if (savedHideExplicit !== null) hideExplicitCheckbox.checked = savedHideExplicit === 'true';
hideExplicitCheckbox.addEventListener('change', () => {
  localStorage.setItem('resonance_hide_explicit', hideExplicitCheckbox.checked);
  renderFilteredFeed();
});

// --- Contrôle parental (verrouillage local à cet appareil) ---
const parentalLockBtn = document.getElementById('parental-lock-btn');

function isParentalLocked() {
  return localStorage.getItem('resonance_parental_lock') === 'true';
}

function refreshParentalLockUI() {
  const locked = isParentalLocked();
  hideExplicitCheckbox.disabled = locked;
  parentalLockBtn.textContent = locked ? t('discover.parentalUnlock') : t('discover.parentalLock');
}

parentalLockBtn.addEventListener('click', () => {
  if (isParentalLocked()) {
    const pin = window.prompt(t('discover.parentalEnterPin'));
    if (pin === null) return;
    if (pin === localStorage.getItem('resonance_parental_pin')) {
      localStorage.removeItem('resonance_parental_lock');
      localStorage.removeItem('resonance_parental_pin');
      refreshParentalLockUI();
    } else {
      window.alert(t('discover.parentalWrongPin'));
    }
  } else {
    const pin = window.prompt(t('discover.parentalSetPin'));
    if (pin === null || pin.trim().length < 4) {
      if (pin !== null) window.alert(t('discover.parentalPinTooShort'));
      return;
    }
    const confirmPin = window.prompt(t('discover.parentalConfirmPin'));
    if (confirmPin !== pin) {
      window.alert(t('discover.parentalPinMismatch'));
      return;
    }
    hideExplicitCheckbox.checked = true;
    localStorage.setItem('resonance_hide_explicit', 'true');
    localStorage.setItem('resonance_parental_pin', pin.trim());
    localStorage.setItem('resonance_parental_lock', 'true');
    refreshParentalLockUI();
    renderFilteredFeed();
  }
});

refreshParentalLockUI();

function toggleEditPanel(trackId) {
  const panel = document.getElementById('edit-panel-' + trackId);
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  const tr = MY_TRACKS.find((x) => x.id === trackId);
  panel.innerHTML =
    '<label>' + t('dashboard.addTrack.trackTitle') + '</label>' +
    '<input type="text" class="edit-title" value="' + escapeHtml(tr.title) + '">' +
    '<label>' + t('dashboard.addTrack.genre') + '</label>' +
    '<input type="text" class="edit-genre" value="' + escapeHtml(tr.genre || '') + '">' +
    '<label>' + t('dashboard.addTrack.collaborators') + '</label>' +
    '<input type="text" class="edit-collab" value="' + escapeHtml(tr.collaborators || '') + '">' +
    '<label>' + t('dashboard.profile.spotify') + '</label>' +
    '<input type="url" class="edit-spotify" value="' + escapeHtml(tr.spotifyUrl || '') + '">' +
    '<label>' + t('dashboard.profile.apple') + '</label>' +
    '<input type="url" class="edit-apple" value="' + escapeHtml(tr.appleUrl || '') + '">' +
    '<label>' + t('dashboard.addTrack.genesis') + '</label>' +
    '<textarea class="edit-genesis">' + escapeHtml(tr.genesis || '') + '</textarea>' +
    '<label class="edit-explicit-row"><input type="checkbox" class="edit-explicit"' + (tr.explicit ? ' checked' : '') + '> ' + t('dashboard.addTrack.explicit') + '</label>' +
    '<label>' + t('dashboard.addTrack.aiLevel') + '</label>' +
    '<select class="edit-ai">' +
    '<option value="none"' + (tr.aiLevel === 'none' ? ' selected' : '') + '>' + t('ai.level.none') + '</option>' +
    '<option value="assisted"' + (tr.aiLevel === 'assisted' ? ' selected' : '') + '>' + t('ai.level.assisted') + '</option>' +
    '<option value="generated"' + (tr.aiLevel === 'generated' ? ' selected' : '') + '>' + t('ai.level.generated') + '</option>' +
    '</select>' +
    '<label>' + t('dashboard.addTrack.aiTool') + '</label>' +
    '<input type="text" class="edit-aitool" value="' + escapeHtml(tr.aiTool || '') + '">' +
    '<label>' + t('dashboard.addTrack.cover') + '</label>' +
    '<input type="file" class="edit-cover" accept="image/*">' +
    '<div class="form-actions"><button type="button" class="btn btn-primary edit-save">' + t('dashboard.myTracks.save') + '</button>' +
    '<span class="form-note edit-status"></span></div>';
  panel.hidden = false;

  panel.querySelector('.edit-save').addEventListener('click', async () => {
    const status = panel.querySelector('.edit-status');
    const formData = new FormData();
    formData.append('title', panel.querySelector('.edit-title').value.trim());
    formData.append('genre', panel.querySelector('.edit-genre').value.trim());
    formData.append('collaborators', panel.querySelector('.edit-collab').value.trim());
    formData.append('spotifyUrl', panel.querySelector('.edit-spotify').value.trim());
    formData.append('appleUrl', panel.querySelector('.edit-apple').value.trim());
    formData.append('genesis', panel.querySelector('.edit-genesis').value.trim());
    formData.append('explicit', panel.querySelector('.edit-explicit').checked);
    formData.append('aiLevel', panel.querySelector('.edit-ai').value);
    formData.append('aiTool', panel.querySelector('.edit-aitool').value.trim());
    const coverFile = panel.querySelector('.edit-cover').files[0];
    if (coverFile) formData.append('cover', coverFile);

    status.textContent = '…';
    const res = await fetch('/api/tracks/' + trackId, { method: 'PUT', body: formData });
    if (!res.ok) {
      status.textContent = t('error.generic');
      return;
    }
    showToast('✓');
    panel.hidden = true;
    loadMyTracks();
    loadFeed();
  });
}

// --- Visuel promo (image carrée prête à poster) ---
async function generatePromoVisual(trackId) {
  const tr = MY_TRACKS.find((x) => x.id === trackId);
  if (!tr) return;

  await document.fonts.ready;

  const SIZE = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // Fond dégradé
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, '#1E1A2E');
  bg.addColorStop(1, '#2A2540');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Barres décoratives en bas — s'arrêtent avant la zone réservée au QR code
  const barColors = ['#D98F3D', '#4FA69B'];
  const barsMaxX = SIZE - 108 - 44 - 30; // laisse l'espace du QR code libre
  let x = 40;
  let i = 0;
  while (x < barsMaxX) {
    const h = 20 + Math.abs(Math.sin(i * 0.6)) * 90;
    ctx.fillStyle = barColors[i % 2];
    ctx.fillRect(x, SIZE - 70 - h, 10, h);
    x += 18;
    i++;
  }

  // Pochette (image réelle ou bloc généré)
  const coverSize = 640;
  const coverX = (SIZE - coverSize) / 2;
  const coverY = 140;
  ctx.save();
  roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 24);
  ctx.clip();
  if (tr.coverUrl) {
    const img = await loadImage(tr.coverUrl);
    ctx.fillStyle = '#1E1A2E';
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
    const scale = Math.max(coverSize / img.width, coverSize / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, coverX + (coverSize - dw) / 2, coverY + (coverSize - dh) / 2, dw, dh);
  } else {
    const palette = [['#D98F3D', '#B8721F'], ['#4FA69B', '#2E7B71'], ['#8C6FB0', '#5F4A82']];
    const [c1, c2] = palette[Math.abs(tr.id || 0) % palette.length];
    const grad = ctx.createLinearGradient(coverX, coverY, coverX + coverSize, coverY + coverSize);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '600 220px Fraunces, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((tr.title || '?').trim().charAt(0).toUpperCase(), coverX + coverSize / 2, coverY + coverSize / 2 + 20);
  }
  ctx.restore();

  // Titre
  ctx.fillStyle = '#EDE7D9';
  ctx.textAlign = 'center';
  ctx.font = '600 62px Fraunces, serif';
  fitText(ctx, tr.title, SIZE / 2, coverY + coverSize + 90, SIZE - 120, 62);

  // Artiste (+ collaborateurs éventuels)
  const artistLine = (tr.artistName || (currentUser && currentUser.artistName) || '') + (tr.collaborators ? ' · ' + t('track.with') + ' ' + tr.collaborators : '');
  ctx.fillStyle = '#B8B0A0';
  ctx.font = '400 34px "IBM Plex Sans", sans-serif';
  fitText(ctx, artistLine, SIZE / 2, coverY + coverSize + 140, SIZE - 100, 34, '400', '"IBM Plex Sans", sans-serif');

  // Marque
  ctx.fillStyle = '#D98F3D';
  ctx.font = '600 30px Fraunces, serif';
  ctx.textAlign = 'left';
  ctx.fillText('Résonance', 44, SIZE - 30);

  // QR code vers la page de l'artiste sur Résonance
  const qrSize = 108;
  const qrTargetUrl = window.location.origin + '/#/artiste/' + tr.userId;
  const qr = qrcode(0, 'M');
  qr.addData(qrTargetUrl);
  qr.make();
  const modules = qr.getModuleCount();
  const cell = qrSize / modules;
  const qrX = SIZE - qrSize - 44;
  const qrY = SIZE - qrSize - 30;
  ctx.fillStyle = '#EDE7D9';
  ctx.fillRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 16);
  ctx.fillStyle = '#1E1A2E';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(qrX + col * cell, qrY + row * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  const fileName = (tr.title || 'resonance').replace(/[^a-zA-Z0-9-_]+/g, '_') + '.png';

  // Sur téléphone : ouvre le menu de partage natif (Instagram, TikTok,
  // messages…), prêt en un clic. Sinon (ordinateur, navigateurs qui ne
  // le permettent pas), on télécharge simplement l'image.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: tr.title || 'Résonance' });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // l'artiste a annulé le partage
      // sinon, on continue vers le téléchargement classique ci-dessous
    }
  }

  const link = document.createElement('a');
  link.download = fileName;
  link.href = URL.createObjectURL(blob);
  link.click();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fitText(ctx, text, x, y, maxWidth, baseSize, weight, family) {
  weight = weight || '600';
  family = family || 'Fraunces, serif';
  const minSize = family.indexOf('IBM') !== -1 ? 20 : 30;
  let size = baseSize;
  ctx.font = weight + ' ' + size + 'px ' + family;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = weight + ' ' + size + 'px ' + family;
  }
  ctx.fillText(text, x, y);
}

// --- Administration ---
async function loadAdminReports() {
  const res = await fetch('/api/admin/reports');
  if (!res.ok) return;
  const { reports } = await res.json();
  const list = document.getElementById('admin-reports-list');
  if (reports.length === 0) {
    list.innerHTML = '<p class="empty-state">' + t('admin.reports.empty') + '</p>';
    return;
  }
  list.innerHTML = reports
    .map(
      (r) =>
        '<div class="admin-row"><div class="who"><span>' +
        escapeHtml(r.trackTitle) +
        ' — ' +
        escapeHtml(r.artistName) +
        '</span><span class="sub">' +
        escapeHtml(r.reason) +
        ' · ' +
        formatDate(r.createdAt) +
        '</span></div><button class="del-btn" data-resolve-id="' +
        r.id +
        '">' +
        t('admin.reports.resolve') +
        '</button></div>'
    )
    .join('');
  list.querySelectorAll('[data-resolve-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch('/api/admin/reports/' + btn.getAttribute('data-resolve-id') + '/resolve', { method: 'POST' });
      loadAdminReports();
    });
  });
}

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
  loadAdminReports();

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

  const banner = document.getElementById('artist-page-banner');
  if (artist.bannerUrl) { banner.src = artist.bannerUrl; banner.hidden = false; } else { banner.hidden = true; }
  const avatar = document.getElementById('artist-page-avatar');
  if (artist.avatarUrl) { avatar.src = artist.avatarUrl; avatar.hidden = false; } else { avatar.hidden = true; }

  const links = [];
  if (artist.soundcloudUrl) links.push(linkPill(artist.soundcloudUrl, t('link.soundcloud')));
  if (artist.instagramUrl) links.push(linkPill(artist.instagramUrl, t('link.instagram')));
  if (artist.sunoUrl) links.push(linkPill(artist.sunoUrl, t('link.suno')));
  if (artist.donationLink) links.push(linkPill(artist.donationLink, t('link.donate'), true));
  document.getElementById('artist-page-links').innerHTML = links.join('');

  document.getElementById('artist-follower-count').textContent =
    followerCount + ' ' + (followerCount === 1 ? t('artist.follower') : t('artist.followers'));

  const followBtn = document.getElementById('follow-btn');
  const isMe = currentUser && currentUser.id === artist.id;
  if (isMe) {
    followBtn.hidden = true;
  } else if (!currentUser) {
    followBtn.hidden = false;
    followBtn.textContent = t('artist.followLoginPrompt');
    followBtn.onclick = () => {
      window.location.hash = '#espace';
    };
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
  const hideExplicitPref = localStorage.getItem('resonance_hide_explicit') !== 'false';
  const visibleTracks = tracks.filter((tr) => !hideExplicitPref || !tr.explicit);
  tracksFeed.innerHTML =
    visibleTracks.length === 0 ? '<div class="empty-state">' + t('discover.empty') + '</div>' : visibleTracks.map(renderTrackCard).join('');
  currentArtistQueue = visibleTracks;
  refreshPlayButtons();
}

function handleRoute() {
  const artistMatch = window.location.hash.match(/^#\/artiste\/(\d+)$/);
  const trackMatch = window.location.hash.match(/^#\/morceau\/(\d+)$/);
  const artistSection = document.getElementById('artiste');
  const trackSection = document.getElementById('morceau');
  const mainViews = document.querySelectorAll('.main-view');
  if (artistMatch) {
    mainViews.forEach((el) => (el.hidden = true));
    artistSection.hidden = false;
    trackSection.hidden = true;
    loadArtistPage(artistMatch[1]);
    window.scrollTo(0, 0);
  } else if (trackMatch) {
    mainViews.forEach((el) => (el.hidden = true));
    artistSection.hidden = true;
    trackSection.hidden = false;
    loadTrackPage(trackMatch[1]);
    window.scrollTo(0, 0);
  } else {
    mainViews.forEach((el) => (el.hidden = false));
    artistSection.hidden = true;
    trackSection.hidden = true;
  }
}
window.addEventListener('hashchange', handleRoute);

document.getElementById('back-to-discover-from-track').addEventListener('click', () => {
  window.location.hash = '';
});

async function loadTrackPage(trackId) {
  const container = document.getElementById('track-page-content');
  const moreContainer = document.getElementById('track-page-more');
  container.innerHTML = '';
  moreContainer.innerHTML = '';
  const res = await fetch('/api/tracks/' + trackId);
  if (!res.ok) {
    container.innerHTML = '<div class="empty-state">' + t('track.notFound') + '</div>';
    return;
  }
  const { track } = await res.json();
  container.innerHTML = renderTrackCard(track);
  currentDiscoverQueue = [track];
  document.title = track.title + ' — ' + track.artistName + ' — Résonance';

  // "Plus de cet artiste" — quelques autres morceaux, pour continuer la découverte
  const artistRes = await fetch('/api/artists/' + track.userId);
  if (artistRes.ok) {
    const { tracks } = await artistRes.json();
    const others = tracks.filter((tr) => tr.id !== track.id);
    if (others.length) {
      moreContainer.innerHTML =
        '<h3>' + t('track.moreFromArtist').replace('{artist}', escapeHtml(track.artistName)) + '</h3>' +
        '<div class="feed">' + others.map(renderTrackCard).join('') + '</div>';
      currentArtistQueue = tracks;
    }
  }
  refreshPlayButtons();
}

// --- Service worker (installation en app) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// --- Bouton "Installer l'appli" ---
const installBtn = document.getElementById('install-btn');
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const isMacSafari = /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
let deferredInstallPrompt = null;

if (!isStandalone) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.hidden = false;
  });
  if (isIOS || isMacSafari) installBtn.hidden = false;
}

installBtn.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  } else if (isIOS) {
    window.alert(t('nav.installIOS'));
  } else if (isMacSafari) {
    window.alert(t('nav.installMac'));
  } else {
    window.alert(t('nav.installGeneric'));
  }
});

// --- Bouton "Partager" (page courante ou lien spécifique) ---
async function shareUrl(url, textKey) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Résonance', text: t(textKey || 'nav.shareText'), url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  // Pas de partage natif (ordinateur) : on copie le lien et on montre le QR code
  try {
    await navigator.clipboard.writeText(url);
    showToast(t('nav.shareCopied'));
  } catch (err) {
    /* silencieux si le presse-papiers échoue */
  }
  showShareQr(url);
}

document.getElementById('soundcloud-connect-btn').addEventListener('click', async () => {
  const res = await fetch('/api/soundcloud/connect');
  if (res.status === 503) {
    showToast(t('soundcloud.notConfigured'));
    return;
  }
  const data = await res.json();
  if (data.authorizeUrl) window.location.href = data.authorizeUrl;
});

document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.getAttribute('data-target'));
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? '👁' : '🙈';
  });
});

document.getElementById('resend-verification-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  await fetch('/api/resend-verification', { method: 'POST' });
  showToast(t('verify.resent'));
  setTimeout(() => (btn.disabled = false), 3000);
});

document.getElementById('resend-verification-btn-2').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  await fetch('/api/resend-verification', { method: 'POST' });
  showToast(t('verify.resent'));
  setTimeout(() => (btn.disabled = false), 3000);
});

document.getElementById('share-page-btn').addEventListener('click', () => shareUrl(window.location.href));

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.share-track-btn');
  if (btn) shareUrl(btn.getAttribute('data-share-url'), 'nav.shareTrackText');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.report-track-btn');
  if (!btn) return;
  const reason = window.prompt(t('track.reportPrompt'));
  if (!reason || !reason.trim()) return;
  const res = await fetch('/api/tracks/' + btn.getAttribute('data-report-id') + '/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason.trim() }),
  });
  showToast(res.ok ? t('track.reportSent') : t('error.generic'));
});

function showShareQr(url) {
  const popover = document.getElementById('share-qr-popover');
  const holder = document.getElementById('share-qr-code');
  holder.innerHTML = '';
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  holder.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4 });
  popover.hidden = false;
}
document.getElementById('close-qr-popover').addEventListener('click', () => {
  document.getElementById('share-qr-popover').hidden = true;
});

// --- Lecteur persistant (continue en fond en naviguant sur le site) ---
let currentDiscoverQueue = [];
let currentArtistQueue = [];
let currentTrackId = null;
let currentQueueRef = [];

const globalAudio = document.getElementById('global-audio');
const playerBar = document.getElementById('player-bar');
const playerPlaypause = document.getElementById('player-playpause');
const playerSeek = document.getElementById('player-seek');
const playerTimeCurrent = document.getElementById('player-time-current');
const playerTimeDuration = document.getElementById('player-time-duration');

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

function findTrackById(id) {
  return ALL_TRACKS.find((t) => t.id === id) || (MY_TRACKS || []).find((t) => t.id === id) || null;
}

let playCountTimer = null;

function playTrackById(id, audioUrl, title, artist, coverUrl, coverFallback, queue) {
  currentQueueRef = queue || currentDiscoverQueue;
  currentTrackId = id;
  globalAudio.src = audioUrl;
  globalAudio.play().catch(() => {});
  saveRecentListen({ id, title, artistName: artist, coverUrl });

  // Une écoute ne compte qu'après 15 secondes de lecture réelle, pour
  // éviter qu'un simple clic accidentel gonfle les chiffres — comme le
  // font les vraies plateformes de streaming.
  if (playCountTimer) clearTimeout(playCountTimer);
  playCountTimer = setTimeout(() => {
    fetch('/api/tracks/' + id + '/register-play', { method: 'POST' }).catch(() => {});
  }, 15000);

  document.getElementById('player-title').textContent = title;
  document.getElementById('player-artist').textContent = artist;
  const img = document.getElementById('player-cover-img');
  const fallback = document.getElementById('player-cover-fallback');
  if (coverUrl) {
    img.src = coverUrl;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = coverFallback || '?';
  }
  playerBar.hidden = false;
  refreshPlayButtons();
}

function pausePlayback() {
  globalAudio.pause();
  refreshPlayButtons();
}

function refreshPlayButtons() {
  document.querySelectorAll('.play-track-btn').forEach((btn) => {
    const isThisTrack = Number(btn.getAttribute('data-track-id')) === currentTrackId;
    const isPlaying = isThisTrack && !globalAudio.paused;
    btn.classList.toggle('is-playing', isPlaying);
  });
  playerPlaypause.textContent = globalAudio.paused ? '▶' : '⏸';
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.play-track-btn');
  if (!btn) return;
  const id = Number(btn.getAttribute('data-track-id'));
  if (id === currentTrackId) {
    if (globalAudio.paused) {
      globalAudio.play().catch(() => {});
    } else {
      globalAudio.pause();
    }
    refreshPlayButtons();
    return;
  }
  // Détermine la file d'attente : celle de la page artiste si le bouton s'y trouve, sinon celle de Découvrir
  const inArtistPage = !!btn.closest('#artist-page-tracks');
  playTrackById(
    id,
    btn.getAttribute('data-audio-url'),
    btn.getAttribute('data-title'),
    btn.getAttribute('data-artist'),
    btn.getAttribute('data-cover'),
    btn.getAttribute('data-cover-fallback'),
    inArtistPage ? currentArtistQueue : currentDiscoverQueue
  );
});

playerPlaypause.addEventListener('click', () => {
  if (!currentTrackId) {
    showToast(t('player.pickTrackFirst'));
    return;
  }
  if (globalAudio.paused) globalAudio.play().catch(() => {});
  else globalAudio.pause();
  refreshPlayButtons();
});

document.getElementById('player-close').addEventListener('click', () => {
  globalAudio.pause();
  globalAudio.src = '';
  currentTrackId = null;
  playerBar.hidden = true;
  refreshPlayButtons();
});

globalAudio.addEventListener('play', refreshPlayButtons);
globalAudio.addEventListener('pause', refreshPlayButtons);

globalAudio.addEventListener('loadedmetadata', () => {
  playerSeek.max = globalAudio.duration || 0;
  playerTimeDuration.textContent = formatTime(globalAudio.duration);
});
globalAudio.addEventListener('timeupdate', () => {
  playerSeek.value = globalAudio.currentTime;
  playerTimeCurrent.textContent = formatTime(globalAudio.currentTime);
});
playerSeek.addEventListener('input', () => {
  globalAudio.currentTime = Number(playerSeek.value);
});

globalAudio.addEventListener('ended', () => {
  const idx = currentQueueRef.findIndex((t) => t.id === currentTrackId);
  const next = idx > -1 ? currentQueueRef[idx + 1] : null;
  if (next) {
    playTrackById(next.id, next.audioUrl, next.title, next.artistName, next.coverUrl, (next.title || '?').trim().charAt(0).toUpperCase(), currentQueueRef);
  } else {
    refreshPlayButtons();
  }
});

// --- Historique d'écoute récent (localStorage uniquement, aucun compte
// requis — ne quitte jamais l'appareil de la personne) ---
const RECENT_LISTENS_KEY = 'resonance_recent_listens';
const RECENT_LISTENS_MAX = 12;

function saveRecentListen(track) {
  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem(RECENT_LISTENS_KEY) || '[]');
  } catch (err) {
    recent = [];
  }
  recent = recent.filter((r) => r.id !== track.id);
  recent.unshift({ id: track.id, title: track.title, artistName: track.artistName, coverUrl: track.coverUrl || '' });
  recent = recent.slice(0, RECENT_LISTENS_MAX);
  try {
    localStorage.setItem(RECENT_LISTENS_KEY, JSON.stringify(recent));
  } catch (err) {
    /* silencieux si le stockage local est plein/indisponible */
  }
  renderRecentListens();
}

function renderRecentListens() {
  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem(RECENT_LISTENS_KEY) || '[]');
  } catch (err) {
    recent = [];
  }
  const block = document.getElementById('recent-listens-block');
  const strip = document.getElementById('recent-listens-strip');
  if (recent.length === 0) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  strip.innerHTML = recent
    .map(
      (r) =>
        '<button type="button" class="recent-listen-item recent-listen-play" data-track-id="' + r.id + '">' +
        (r.coverUrl
          ? '<img class="recent-listen-cover" src="' + escapeHtml(r.coverUrl) + '" alt="">'
          : '<div class="recent-listen-cover-fallback">' + escapeHtml((r.title || '?').trim().charAt(0).toUpperCase()) + '</div>') +
        '<div class="recent-listen-title">' + escapeHtml(r.title) + '</div>' +
        '<div class="recent-listen-artist">' + escapeHtml(r.artistName) + '</div>' +
        '</button>'
    )
    .join('');
}

document.getElementById('recent-listens-strip').addEventListener('click', (e) => {
  const btn = e.target.closest('.recent-listen-play');
  if (!btn) return;
  const id = Number(btn.getAttribute('data-track-id'));
  const track = ALL_TRACKS.find((t) => t.id === id);
  if (track) {
    playTrackById(track.id, track.audioUrl, track.title, track.artistName, track.coverUrl, (track.title || '?').trim().charAt(0).toUpperCase(), currentDiscoverQueue);
  } else {
    // Le morceau n'est plus dans le fil actuellement chargé (site
    // rechargé) : on va chercher ses infos avant de le lancer.
    fetch('/api/tracks/' + id)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.track) {
          playTrackById(data.track.id, data.track.audioUrl, data.track.title, data.track.artistName, data.track.coverUrl, (data.track.title || '?').trim().charAt(0).toUpperCase(), [data.track]);
        }
      });
  }
});

document.getElementById('shuffle-play-btn').addEventListener('click', () => {
  if (ALL_TRACKS.length === 0) return;
  const pick = ALL_TRACKS[Math.floor(Math.random() * ALL_TRACKS.length)];
  playTrackById(pick.id, pick.audioUrl, pick.title, pick.artistName, pick.coverUrl, (pick.title || '?').trim().charAt(0).toUpperCase(), ALL_TRACKS);
});

document.getElementById('artist-shuffle-play-btn').addEventListener('click', () => {
  if (currentArtistQueue.length === 0) return;
  const pick = currentArtistQueue[Math.floor(Math.random() * currentArtistQueue.length)];
  playTrackById(pick.id, pick.audioUrl, pick.title, pick.artistName, pick.coverUrl, (pick.title || '?').trim().charAt(0).toUpperCase(), currentArtistQueue);
});

// --- Init ---
(async function init() {
  // Confirmation d'e-mail : le lien envoyé par e-mail revient sur
  // #espace?verified=1 (ou 0 en cas d'échec) — on le détecte avant de
  // nettoyer l'ancre, puis on informe la personne une fois chargé.
  const verifiedMatch = window.location.hash.match(/[?&]verified=(\d)/);
  const verifiedResult = verifiedMatch ? verifiedMatch[1] : null;

  // Si l'adresse garde une ancienne ancre (#decouvrir, etc.) sans être une
  // vraie page artiste, on revient en haut plutôt que de suivre le saut
  // automatique du navigateur vers cette section.
  if (window.location.hash && !window.location.hash.match(/^#\/artiste\/\d+$/) && !window.location.hash.match(/^#\/morceau\/\d+$/)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  await loadLang(CURRENT_LANG);
  await refreshMe();
  await loadFeed();
  renderRecentListens();
  handleRoute();
  window.scrollTo(0, 0);
  if (verifiedResult === '1') showToast(t('verify.success'));
  else if (verifiedResult === '0') showToast(t('verify.failed'));
})();
