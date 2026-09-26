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
  // Le rafraîchissement générique ci-dessus vient d'écraser ces deux
  // libellés avec leur texte par défaut ("Nom d'artiste") : on les
  // réapplique aussitôt selon le type de compte, sinon un changement de
  // langue en pleine inscription (ou sur son profil) fait perdre le
  // libellé "Nom d'utilisateur" propre à un compte auditeur.
  updateSignupNameLabel();
  if (currentUser) {
    const profileLabel = document.getElementById('profile-name-label');
    if (profileLabel) profileLabel.textContent = currentUser.accountType === 'fan' ? t('auth.userName') : t('auth.artistName');
  }
  document.documentElement.lang = lang;
  if (ANNOUNCEMENTS_LOADED) renderAnnouncements();
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
  // Un message long reste affiché plus longtemps, pour avoir le temps de le lire.
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), Math.max(2600, String(msg).length * 60));
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

// --- Identifiant d'appareil (pour "j'aime" sans compte) ---
// Un visiteur non connecté peut quand même aimer un morceau : on lui donne
// un identifiant aléatoire conservé sur son appareil (localStorage), pour
// reconnaître ses likes sans lui demander de créer un compte. Dès qu'il se
// connecte ou s'inscrit, ces likes sont rattachés à son compte côté serveur
// (voir mergeDeviceLikes dans server.js) : l'identité "appareil" et
// l'identité "compte" finissent par se rejoindre.
function getDeviceId() {
  try {
    let id = localStorage.getItem('resonance_device_id');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('resonance_device_id', id);
    }
    return id;
  } catch (err) {
    return '';
  }
}
function deviceQS() {
  const id = getDeviceId();
  return id ? 'deviceId=' + encodeURIComponent(id) : '';
}

// --- État courant ---
let currentUser = null;

async function refreshMe() {
  const res = await fetch('/api/me');
  const data = await res.json();
  currentUser = data.user;
  updateAuthUI();
  updateAdminUI();
  loadAnnouncements();
  // Le compte admin n'a pas d'espace artiste : rien à charger de ce côté.
  if (currentUser && currentUser.role !== 'admin') {
    fillProfileForm(currentUser);
    loadMyAlbums();
    loadMyTracks();
    loadMessages();
    loadPlaylists();
    initPushUI();
    // Sans cet appel, les panneaux qui dépendent du type de compte (avis
    // "compte auditeur", bouton pour redevenir auditeur, case SACEM...)
    // restaient sur leur état "hidden" par défaut du HTML tant qu'aucune
    // autre action (connexion, sauvegarde du profil...) n'avait eu lieu
    // dans la même session : un simple rechargement de page les cachait.
    refreshOnboarding();
  }
}

function updateAuthUI() {
  const authBlock = document.getElementById('auth-block');
  const dashboardBlock = document.getElementById('dashboard-block');
  const navLogin = document.getElementById('nav-login');
  const navLogout = document.getElementById('nav-logout');
  const navDashboard = document.getElementById('nav-dashboard');

  if (currentUser) {
    const isAdmin = currentUser.role === 'admin';
    authBlock.hidden = true;
    dashboardBlock.hidden = isAdmin;
    navLogin.hidden = true;
    navLogout.hidden = false;
    navDashboard.hidden = isAdmin;
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
document.getElementById('show-forgot-password').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-form-wrap').hidden = true;
  document.getElementById('forgot-password-wrap').hidden = false;
});
document.getElementById('show-login-from-forgot').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgot-password-wrap').hidden = true;
  document.getElementById('login-form-wrap').hidden = false;
});

// --- Mot de passe oublié ---
document.getElementById('forgot-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('forgot-password-status');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  status.textContent = '…';
  submitBtn.disabled = true;
  const body = { email: document.getElementById('forgot-password-email').value.trim() };
  const res = await fetch('/api/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  submitBtn.disabled = false;
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 1800;
    showRateLimitCountdown(status, retryAfter);
    return;
  }
  status.textContent = t('auth.forgotPassword.sent');
});

// --- Réinitialisation du mot de passe (lien reçu par e-mail) ---
let RESET_PASSWORD_TOKEN = null;
document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('reset-password-status');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const newPassword = document.getElementById('reset-password-new').value;
  const confirmPassword = document.getElementById('reset-password-confirm').value;
  if (newPassword !== confirmPassword) {
    status.textContent = t('auth.resetPassword.mismatch');
    return;
  }
  status.textContent = '…';
  submitBtn.disabled = true;
  const res = await fetch('/api/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: RESET_PASSWORD_TOKEN, password: newPassword }),
  });
  submitBtn.disabled = false;
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
  status.textContent = t('auth.resetPassword.success');
  e.target.reset();
  RESET_PASSWORD_TOKEN = null;
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

function updateSignupNameLabel() {
  const checked = document.querySelector('input[name="account-type"]:checked');
  document.getElementById('signup-name-label').textContent = checked && checked.value === 'fan' ? t('auth.userName') : t('auth.artistName');
}
document.querySelectorAll('input[name="account-type"]').forEach((radio) => {
  radio.addEventListener('change', updateSignupNameLabel);
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('signup-status');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  status.textContent = '…';
  submitBtn.disabled = true;
  const body = {
    artistName: document.getElementById('signup-artistName').value.trim(),
    email: document.getElementById('signup-email').value.trim(),
    password: document.getElementById('signup-password').value,
    acceptedTerms: document.getElementById('signup-terms').checked,
    accountType: document.querySelector('input[name="account-type"]:checked').value,
    deviceId: getDeviceId(),
  };
  const res = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  submitBtn.disabled = false;
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
  status.textContent = '';
  await refreshMe();
  showToast('👋');
});

// --- Login ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('login-status');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  status.textContent = '…';
  submitBtn.disabled = true;
  const body = {
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
    deviceId: getDeviceId(),
  };
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  submitBtn.disabled = false;
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
  if (data.totpRequired) {
    status.textContent = '';
    document.getElementById('login-form-wrap').hidden = true;
    document.getElementById('login-totp-wrap').hidden = false;
    document.getElementById('login-totp-code').value = '';
    document.getElementById('login-totp-code').focus();
    document.getElementById('login-webauthn-status').textContent = '';
    document.getElementById('login-webauthn-btn').hidden = !(data.webauthnAvailable && window.PublicKeyCredential);
    return;
  }
  status.textContent = '';
  await refreshMe();
});

// --- Code de vérification (double authentification, compte admin) ---
document.getElementById('login-totp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('login-totp-status');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  status.textContent = '…';
  submitBtn.disabled = true;
  const body = {
    code: document.getElementById('login-totp-code').value.trim(),
    deviceId: getDeviceId(),
  };
  const res = await fetch('/api/login/totp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  submitBtn.disabled = false;
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
  status.textContent = '';
  document.getElementById('login-totp-wrap').hidden = true;
  document.getElementById('login-form-wrap').hidden = false;
  await refreshMe();
});

// --- WebAuthn (Face ID / Touch ID) : conversions communes à
// l'enregistrement et à la connexion. Les navigateurs récents savent
// convertir directement depuis/vers le JSON attendu par le serveur
// (PublicKeyCredential.parseCreationOptionsFromJSON / .toJSON()) ; les
// fonctions manuelles ci-dessous ne servent que de repli pour un
// navigateur qui ne les aurait pas encore.
function base64urlToBuffer(base64url) {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer.buffer;
}
function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  bytes.forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function webauthnParseCreationOptions(options) {
  if (window.PublicKeyCredential && PublicKeyCredential.parseCreationOptionsFromJSON) {
    return PublicKeyCredential.parseCreationOptionsFromJSON(options);
  }
  const parsed = Object.assign({}, options, {
    challenge: base64urlToBuffer(options.challenge),
    user: Object.assign({}, options.user, { id: base64urlToBuffer(options.user.id) }),
  });
  if (parsed.excludeCredentials) parsed.excludeCredentials = parsed.excludeCredentials.map((c) => Object.assign({}, c, { id: base64urlToBuffer(c.id) }));
  return parsed;
}
function webauthnParseRequestOptions(options) {
  if (window.PublicKeyCredential && PublicKeyCredential.parseRequestOptionsFromJSON) {
    return PublicKeyCredential.parseRequestOptionsFromJSON(options);
  }
  const parsed = Object.assign({}, options, { challenge: base64urlToBuffer(options.challenge) });
  if (parsed.allowCredentials) parsed.allowCredentials = parsed.allowCredentials.map((c) => Object.assign({}, c, { id: base64urlToBuffer(c.id) }));
  return parsed;
}
function webauthnCredentialToJSON(cred) {
  if (typeof cred.toJSON === 'function') return cred.toJSON();
  const response = cred.response;
  const json = {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: { clientDataJSON: bufferToBase64url(response.clientDataJSON) },
  };
  if (response.attestationObject) json.response.attestationObject = bufferToBase64url(response.attestationObject);
  if (response.authenticatorData) json.response.authenticatorData = bufferToBase64url(response.authenticatorData);
  if (response.signature) json.response.signature = bufferToBase64url(response.signature);
  if (response.userHandle) json.response.userHandle = bufferToBase64url(response.userHandle);
  return json;
}

document.getElementById('login-webauthn-btn').addEventListener('click', async () => {
  const status = document.getElementById('login-webauthn-status');
  status.textContent = '…';
  try {
    const optRes = await fetch('/api/login/webauthn/options', { method: 'POST' });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || 'error');
    const publicKey = webauthnParseRequestOptions(options);
    const assertion = await navigator.credentials.get({ publicKey });
    const payload = webauthnCredentialToJSON(assertion);
    payload.deviceId = getDeviceId();
    const verifyRes = await fetch('/api/login/webauthn/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.error || 'error');
    status.textContent = '';
    document.getElementById('login-totp-wrap').hidden = true;
    document.getElementById('login-form-wrap').hidden = false;
    await refreshMe();
  } catch (err) {
    status.textContent = t('auth.webauthn.error');
  }
});

// --- Logout ---
document.getElementById('nav-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  updateAuthUI();
  updateAdminUI();
  loadAnnouncements();
  window.location.hash = '';
  window.scrollTo(0, 0);
});

// --- Profil ---
function fillProfileForm(user) {
  // Même bascule de libellé qu'à l'inscription (voir plus bas,
  // signup-name-label) : un compte auditeur n'a pas de "nom d'artiste",
  // ce champ sert alors de simple nom d'affichage. Sans ça, la page de
  // profil affichait toujours "Nom d'artiste" même pour un compte
  // auditeur, ce qui n'avait pas de sens et ne laissait aucune autre
  // case où mettre un nom d'affichage adapté.
  document.getElementById('profile-name-label').textContent = user.accountType === 'fan' ? t('auth.userName') : t('auth.artistName');
  document.getElementById('profile-artistName').value = user.artistName || '';
  document.getElementById('profile-bio').value = user.bio || '';
  document.getElementById('profile-donationLink').value = user.donationLink || '';
  document.getElementById('profile-soundcloudUrl').value = user.soundcloudUrl || '';
  document.getElementById('profile-instagramUrl').value = user.instagramUrl || '';
  document.getElementById('profile-sunoUrl').value = user.sunoUrl || '';
  document.getElementById('profile-bandcampUrl').value = user.bandcampUrl || '';
  document.getElementById('profile-coverNameStyle').value = user.coverNameStyle === 'initials' ? 'initials' : 'full';
  document.getElementById('profile-sacemMember').checked = user.sacemMember === true;

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
  formData.append('bandcampUrl', document.getElementById('profile-bandcampUrl').value.trim());
  formData.append('sacemMember', document.getElementById('profile-sacemMember').checked ? 'true' : 'false');
  // Envoyé seulement s'il change (tant que l'étape Supabase n'est pas faite,
  // le profil s'enregistre donc normalement).
  const coverNameStyle = document.getElementById('profile-coverNameStyle').value;
  if (coverNameStyle !== ((currentUser && currentUser.coverNameStyle) || 'full')) formData.append('coverNameStyle', coverNameStyle);
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

// --- Sélection des parties concernées par l'IA (affiche/masque le détail outil) ---
function updateAiDetailVisibility() {
  const anyChecked =
    document.getElementById('track-ai-lyrics').checked ||
    document.getElementById('track-ai-music').checked ||
    document.getElementById('track-ai-vocals').checked;
  document.getElementById('ai-detail-block').hidden = !anyChecked;
}
['track-ai-lyrics', 'track-ai-music', 'track-ai-vocals'].forEach((id) => {
  document.getElementById(id).addEventListener('change', updateAiDetailVisibility);
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

// --- Fichier audio : vérifications immédiates, avant l'envoi ---
const MAX_UPLOAD_MB = 50; // identique à MAX_UPLOAD_MB dans server.js
// Même liste que AUDIO_TYPES_BY_EXTENSION dans server.js.
const AUDIO_EXTENSIONS = ['.wav', '.wave', '.mp3', '.m4a', '.mp4', '.aac', '.flac', '.ogg', '.aif', '.aiff'];

function fileExtension(name) {
  const match = /\.[^.]+$/.exec(name || '');
  return match ? match[0].toLowerCase() : '';
}

// Le champ n'impose plus de filtre au téléphone (l'iPhone grisait parfois
// des fichiers valides) : c'est donc ici qu'on vérifie que c'est bien de
// l'audio, avec un message clair si ce n'est pas le cas.
function isAudioFile(file) {
  return (file.type || '').startsWith('audio/') || AUDIO_EXTENSIONS.includes(fileExtension(file.name));
}

function fileSizeMb(file) {
  return Math.round((file.size / (1024 * 1024)) * 10) / 10;
}

// Dès qu'un fichier est choisi, on affiche son nom et son poids : sur
// téléphone, c'est la seule façon d'être sûr que le bon fichier a été pris,
// et de savoir tout de suite s'il est trop lourd.
document.getElementById('track-audio').addEventListener('change', () => {
  const file = document.getElementById('track-audio').files[0];
  const info = document.getElementById('track-audio-info');
  if (!file) {
    info.textContent = t('upload.hint');
    info.classList.remove('upload-info-error', 'upload-info-ok');
    return;
  }
  const size = fileSizeMb(file);
  if (!isAudioFile(file)) {
    info.textContent = t('upload.notAudio').replace('{name}', file.name);
    info.classList.add('upload-info-error');
    info.classList.remove('upload-info-ok');
    return;
  }
  if (size > MAX_UPLOAD_MB) {
    info.textContent = t('upload.tooLargeDetail').replace('{name}', file.name).replace('{size}', size).replace('{max}', MAX_UPLOAD_MB);
    info.classList.add('upload-info-error');
    info.classList.remove('upload-info-ok');
  } else {
    info.textContent = t('upload.selected').replace('{name}', file.name).replace('{size}', size);
    info.classList.add('upload-info-ok');
    info.classList.remove('upload-info-error');
  }
});

// Envoi avec suivi de progression (fetch ne sait pas donner le
// pourcentage d'envoi, XMLHttpRequest oui). Sur téléphone, un WAV peut
// mettre une minute ou plus à partir : sans pourcentage, on croit que
// rien ne se passe.
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch (err) {
        data = { error: xhr.status === 413 ? 'file_too_large' : 'generic' };
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    });
    xhr.addEventListener('error', () => resolve({ ok: false, status: 0, data: { error: 'network' } }));
    xhr.addEventListener('timeout', () => resolve({ ok: false, status: 0, data: { error: 'network' } }));
    xhr.send(formData);
  });
}

document.getElementById('track-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('track-status');
  const fileInput = document.getElementById('track-audio');
  if (!fileInput.files[0]) {
    status.textContent = t('upload.noFile');
    return;
  }
  if (!isAudioFile(fileInput.files[0])) {
    status.textContent = t('upload.notAudio').replace('{name}', fileInput.files[0].name);
    return;
  }
  if (fileSizeMb(fileInput.files[0]) > MAX_UPLOAD_MB) {
    status.textContent = t('upload.tooLarge').replace('{max}', MAX_UPLOAD_MB);
    return;
  }

  const formData = new FormData();
  formData.append('title', document.getElementById('track-title').value.trim());
  formData.append('genre', document.getElementById('track-genre').value.trim());
  formData.append('collaborators', document.getElementById('track-collaborators').value.trim());
  formData.append('spotifyUrl', document.getElementById('track-spotifyUrl').value.trim());
  formData.append('appleUrl', document.getElementById('track-appleUrl').value.trim());
  formData.append('genesis', document.getElementById('track-genesis').value.trim());
  formData.append('explicit', document.getElementById('track-explicit').checked);
  formData.append('exclusive', document.getElementById('track-exclusive').checked);
  formData.append('aiLyrics', document.getElementById('track-ai-lyrics').checked);
  formData.append('aiMusic', document.getElementById('track-ai-music').checked);
  formData.append('aiVocals', document.getElementById('track-ai-vocals').checked);
  formData.append('aiTool', document.getElementById('track-aiTool').value.trim());
  formData.append('aiCommercialRights', document.getElementById('track-ai-commercial-rights').checked);
  const releaseValue = document.getElementById('track-releaseAt').value;
  if (releaseValue) formData.append('releaseAt', String(new Date(releaseValue).getTime()));
  formData.append('audio', fileInput.files[0]);
  const coverInput = document.getElementById('track-cover');
  if (coverInput.files[0]) formData.append('cover', coverInput.files[0]);
  const albumChoice = document.getElementById('track-album').value;
  if (albumChoice === 'new' && !document.getElementById('track-album-title').value.trim()) {
    status.textContent = t('album.titleMissing');
    return;
  }
  // Ni pochette de titre ni pochette d'album : on envoie la pochette créée
  // automatiquement (celle affichée dans l'aperçu).
  if (!coverInput.files[0] && !selectedAlbumCoverUrl() && window.RisuonaCover) {
    formData.append('cover', await RisuonaCover.toFile(publishCoverOpts()));
    formData.append('coverGenerated', 'true');
  }
  formData.append('albumChoice', albumChoice);
  if (albumChoice === 'new') {
    formData.append('albumTitle', document.getElementById('track-album-title').value.trim());
    const albumCover = document.getElementById('track-album-cover').files[0];
    if (albumCover) formData.append('albumCover', albumCover);
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  status.textContent = t('upload.sending').replace('{pct}', 0);
  const { ok, data } = await uploadWithProgress('/api/tracks', formData, (pct) => {
    status.textContent = pct < 100 ? t('upload.sending').replace('{pct}', pct) : t('upload.processing');
  });
  submitBtn.disabled = false;
  if (!ok) {
    if (data.error === 'email_not_verified') refreshVerificationStatus();
    const messages = {
      email_not_verified: t('verify.blocksPublishShort'),
      terms_outdated: t('cgu.blocksPublish'),
      fan_account: t('fan.cannotPublish'),
      release_too_far: t('release.advice.too_far'),
      file_too_large: t('upload.tooLarge').replace('{max}', MAX_UPLOAD_MB),
      upload_error: t('upload.badType'),
      storage_error: t('upload.storageError'),
      network: t('upload.network'),
      missing_fields: t('upload.noFile'),
      album_title_missing: t('album.titleMissing'),
      album_not_found: t('error.generic'),
      albums_table_missing: t('album.notReady'),
    };
    status.textContent = messages[data.error] || data.message || t('error.generic');
    return;
  }
  status.textContent = '';
  document.getElementById('track-form').reset();
  trackFormDirty = false;
  document.getElementById('ai-detail-block').hidden = true;
  document.getElementById('track-release-advice').hidden = true;
  document.getElementById('track-exclusive').checked = false;
  document.getElementById('track-album-new').hidden = true;
  publishCoverSeed = window.RisuonaCover ? RisuonaCover.randomSeed() : 1;
  resetCoversPreview();
  loadMyAlbums();
  const audioInfo = document.getElementById('track-audio-info');
  audioInfo.textContent = t('upload.hint');
  audioInfo.classList.remove('upload-info-error', 'upload-info-ok');
  showPublishSuccess(data.track);
  loadMyTracks();
  loadFeed();
});

let MY_TRACKS = [];

// --- Albums / EP ---
let MY_ALBUMS = [];

function albumOptionsHtml(selectedId) {
  const sel = String(selectedId || '');
  return (
    '<option value=""' + (sel === '' ? ' selected' : '') + '>' + escapeHtml(t('album.none')) + '</option>' +
    MY_ALBUMS.map((a) => '<option value="' + a.id + '"' + (String(a.id) === sel ? ' selected' : '') + '>💿 ' + escapeHtml(a.title) + '</option>').join('') +
    '<option value="new">' + escapeHtml(t('album.new')) + '</option>'
  );
}

async function loadMyAlbums() {
  try {
    const res = await fetch('/api/me/albums');
    if (!res.ok) return;
    MY_ALBUMS = (await res.json()).albums || [];
  } catch (err) {
    MY_ALBUMS = [];
  }
  const select = document.getElementById('track-album');
  const current = select.value;
  select.innerHTML = albumOptionsHtml(current === 'new' ? '' : current);
  if (current === 'new') select.value = 'new';
}

document.getElementById('track-album').addEventListener('change', (e) => {
  document.getElementById('track-album-new').hidden = e.target.value !== 'new';
});

// Petite ligne "Extrait de l'album…" avec la pochette de l'album en miniature.
function albumLine(tr) {
  if (!tr.albumTitle) return '';
  return (
    '<div class="track-album">' +
    '<span class="track-album-icon" aria-hidden="true">💿</span>' +
    '<span>' + t('album.from').replace('{title}', escapeHtml(tr.albumTitle)) + '</span>' +
    '</div>'
  );
}

// Pochette du titre en grand + pochette de l'album en petit, dans le coin.
function coverWithAlbum(tr) {
  return (
    '<div class="cover-wrap">' +
    coverArt(tr) +
    (tr.albumCoverUrl
      ? '<img class="album-badge" src="' + escapeHtml(tr.albumCoverUrl) + '" alt="' + escapeHtml(t('album.from').replace('{title}', tr.albumTitle)) + '" title="' + escapeHtml(t('album.from').replace('{title}', tr.albumTitle)) + '">'
      : '') +
    '</div>'
  );
}

// --- Aperçu des pochettes dans le formulaire de publication ---
let trackCoverPreviewUrl = null;
let albumCoverPreviewUrl = null;

function objectUrlFor(input, previous) {
  if (previous) URL.revokeObjectURL(previous);
  const file = input.files[0];
  return file && (file.type || '').startsWith('image/') ? URL.createObjectURL(file) : null;
}

function selectedAlbumCoverUrl() {
  const choice = document.getElementById('track-album').value;
  if (choice === 'new') return albumCoverPreviewUrl;
  if (!choice) return null;
  const album = MY_ALBUMS.find((a) => String(a.id) === choice);
  return album && album.coverUrl ? album.coverUrl : null;
}

// Pochette automatique du formulaire de publication : une graine tirée au
// hasard, que le bouton "Générer un autre visuel" remplace.
let publishCoverSeed = window.RisuonaCover ? RisuonaCover.randomSeed() : 1;
function publishCoverOpts() {
  return { seed: publishCoverSeed, title: document.getElementById('track-title').value.trim(), artist: myCoverArtist() };
}

function updateCoversPreview() {
  const box = document.getElementById('covers-preview');
  const wrap = document.getElementById('covers-preview-wrap');
  const albumUrl = selectedAlbumCoverUrl();
  const auto = !trackCoverPreviewUrl && !albumUrl && !!window.RisuonaCover;
  document.getElementById('covers-auto-hint').hidden = !auto;
  document.getElementById('covers-regenerate').hidden = !auto;
  if (auto) {
    wrap.innerHTML = '<img class="cover-art" src="' + RisuonaCover.render(publishCoverOpts(), 320).toDataURL('image/jpeg', 0.85) + '" alt="">';
    box.hidden = false;
    return;
  }
  if (!trackCoverPreviewUrl && !albumUrl) {
    box.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  // Même règle que sur le site : sans pochette de titre, celle de l'album
  // s'affiche en grand (et pas de miniature en double).
  const mainUrl = trackCoverPreviewUrl || albumUrl;
  const badgeUrl = trackCoverPreviewUrl && albumUrl ? albumUrl : null;
  wrap.innerHTML =
    '<img class="cover-art" src="' + escapeHtml(mainUrl) + '" alt="">' +
    (badgeUrl ? '<img class="album-badge" src="' + escapeHtml(badgeUrl) + '" alt="">' : '');
  box.hidden = false;
}

document.getElementById('track-cover').addEventListener('change', (e) => {
  trackCoverPreviewUrl = objectUrlFor(e.target, trackCoverPreviewUrl);
  updateCoversPreview();
});
document.getElementById('track-album-cover').addEventListener('change', (e) => {
  albumCoverPreviewUrl = objectUrlFor(e.target, albumCoverPreviewUrl);
  updateCoversPreview();
});
document.getElementById('track-album').addEventListener('change', updateCoversPreview);
document.getElementById('track-title').addEventListener('input', updateCoversPreview);
document.getElementById('covers-regenerate').addEventListener('click', () => {
  publishCoverSeed = RisuonaCover.randomSeed();
  updateCoversPreview();
});
updateCoversPreview();

function resetCoversPreview() {
  if (trackCoverPreviewUrl) URL.revokeObjectURL(trackCoverPreviewUrl);
  if (albumCoverPreviewUrl) URL.revokeObjectURL(albumCoverPreviewUrl);
  trackCoverPreviewUrl = null;
  albumCoverPreviewUrl = null;
  updateCoversPreview();
}

// --- Confirmation claire après publication ---
// Avant, seul un petit "✓" apparaissait deux secondes : on pouvait le
// rater et se demander si le morceau était bien en ligne.
function showPublishSuccess(track) {
  const box = document.getElementById('publish-success');
  if (!track) {
    showToast('✓');
    return;
  }
  const title = document.getElementById('publish-success-title');
  const text = document.getElementById('publish-success-text');
  const view = document.getElementById('publish-success-view');
  const share = document.getElementById('publish-success-share');
  const trackUrl = window.location.origin + '/#/morceau/' + track.id;
  if (track.isScheduled) {
    title.textContent = t('published.scheduledTitle');
    text.textContent = t('published.scheduledText').replace('{title}', track.title).replace('{date}', formatDateTime(track.releaseAt));
    share.hidden = true; // le lien ne marcherait pas pour les autres avant la sortie
  } else {
    title.textContent = t('published.title');
    text.textContent = t('published.text').replace('{title}', track.title);
    share.hidden = false;
  }
  view.href = '#/morceau/' + track.id;
  share.onclick = () => shareUrl(trackUrl, 'nav.shareTrackText', { artist: track.artistName });
  document.getElementById('track-form').hidden = true;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('publish-success-another').addEventListener('click', () => {
  document.getElementById('publish-success').hidden = true;
  document.getElementById('track-form').hidden = false;
  document.getElementById('track-title').focus();
});

// --- Sorties programmées ---
function toLocalInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function formatDateTime(ts) {
  const localeMap = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
  return new Date(ts).toLocaleString(localeMap[CURRENT_LANG] || 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Affiche les conseils du serveur dans la petite bulle. Les textes sont
// traduits côté site (clé release.advice.<code>) ; à défaut, on garde le
// texte français envoyé par le serveur.
function renderReleaseAdvice(bubble, tips) {
  if (!tips || tips.length === 0) {
    bubble.hidden = true;
    return;
  }
  const icons = { warning: '⚠️', tip: '💡', info: 'ℹ️' };
  bubble.innerHTML = tips
    .map((tp) => {
      const key = 'release.advice.' + tp.code;
      const text = STR[key] || tp.text;
      return '<p class="advice-' + tp.level + '">' + (icons[tp.level] || '💡') + ' ' + escapeHtml(text) + '</p>';
    })
    .join('');
  bubble.hidden = false;
}

async function refreshReleaseAdvice(input, bubble, trackId) {
  const params = new URLSearchParams();
  if (input.value) params.set('releaseAt', String(new Date(input.value).getTime()));
  if (trackId) params.set('trackId', trackId);
  try {
    const res = await fetch('/api/me/release-advice?' + params.toString());
    if (!res.ok) {
      bubble.hidden = true;
      return;
    }
    const { tips } = await res.json();
    renderReleaseAdvice(bubble, tips);
  } catch (err) {
    bubble.hidden = true;
  }
}

(function setupReleaseField() {
  const input = document.getElementById('track-releaseAt');
  const bubble = document.getElementById('track-release-advice');
  // On ne peut pas choisir une date déjà passée.
  input.addEventListener('focus', () => {
    input.min = toLocalInputValue(Date.now());
    refreshReleaseAdvice(input, bubble);
  });
  input.addEventListener('change', () => refreshReleaseAdvice(input, bubble));
})();

// --- Guide de distribution : choix du service ---
document.querySelectorAll('input[name="distrib-choice"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const choice = document.querySelector('input[name="distrib-choice"]:checked').value;
    document.getElementById('distrib-answer-guide').hidden = choice === 'other';
    document.getElementById('distrib-answer-other').hidden = choice !== 'other';
  });
});

function refreshExportPanel() {
  const requestBtn = document.getElementById('request-export-btn');
  const downloadBtn = document.getElementById('download-export-btn');
  const countdown = document.getElementById('export-countdown');
  const remaining = (currentUser.exportExpiresAt || 0) - Date.now();
  if (remaining > 0) {
    requestBtn.hidden = true;
    downloadBtn.hidden = false;
    countdown.hidden = false;
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    countdown.textContent = t('export.expiresIn').replace('{time}', hours + 'h' + mins.toString().padStart(2, '0'));
  } else {
    requestBtn.hidden = false;
    downloadBtn.hidden = true;
    countdown.hidden = true;
  }
}

document.getElementById('request-export-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  await fetch('/api/me/request-export', { method: 'POST' });
  showToast(t('export.requested'));
  setTimeout(() => (btn.disabled = false), 3000);
});

// --- Suppression de compte (demande écrite, pas de bouton auto-service) ---
document.getElementById('request-deletion-link').addEventListener('click', async (e) => {
  e.preventDefault();
  const link = e.target;
  const status = document.getElementById('deletion-status');
  if (!confirm(t('deletion.confirm'))) return;
  link.style.pointerEvents = 'none';
  status.textContent = '…';
  const res = await fetch('/api/me/request-deletion', { method: 'POST' });
  link.style.pointerEvents = '';
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    status.textContent = t('error.' + data.error) || t('error.generic');
    return;
  }
  status.textContent = t('deletion.requested');
});

function applyAccountTypeUI() {
  if (!currentUser) return;
  const isFan = currentUser.accountType === 'fan';
  ['onboarding-panel', 'publish-panel', 'my-tracks-panel', 'stats-panel', 'messages-panel', 'distrib-guide-panel', 'sacem-field-wrap'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = isFan;
  });
  document.getElementById('fan-notice-panel').hidden = !isFan;
  document.getElementById('artist-notice-panel').hidden = isFan;
}

document.getElementById('upgrade-to-artist-btn').addEventListener('click', async () => {
  const res = await fetch('/api/me/upgrade-to-artist', { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();
  currentUser = data.user;
  applyAccountTypeUI();
  loadStats();
  refreshOnboarding();
  showToast('🎵');
});

document.getElementById('downgrade-to-fan-btn').addEventListener('click', async () => {
  if (!confirm(t('artist.downgradeConfirm'))) return;
  const res = await fetch('/api/me/downgrade-to-fan', { method: 'POST' });
  if (!res.ok) return;
  const data = await res.json();
  currentUser = data.user;
  applyAccountTypeUI();
  showToast('✓');
});

// Nombre de morceaux publiables avant confirmation de l'e-mail
// (doit rester identique à UNVERIFIED_TRACK_LIMIT dans server.js).
const UNVERIFIED_TRACK_LIMIT = 3;

// Relit seulement l'état de confirmation de l'e-mail, sans tout
// recharger. Utile quand l'administratrice confirme une adresse pendant
// que l'artiste a déjà le site ouvert : sans ça, l'ancien message restait
// affiché jusqu'à ce que la personne recharge la page.
async function refreshVerificationStatus() {
  if (!currentUser || currentUser.emailVerified !== false) return;
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) {
      currentUser.emailVerified = data.user.emailVerified;
      refreshOnboarding();
    }
  } catch (err) {
    /* réseau indisponible : on réessaiera plus tard */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshVerificationStatus();
});

function refreshOnboarding() {
  if (!currentUser) return;
  applyAccountTypeUI();
  refreshExportPanel();
  const banner = document.getElementById('verify-email-banner');
  banner.hidden = currentUser.emailVerified !== false;
  const publishBlock = document.getElementById('verify-blocks-publish');
  publishBlock.hidden = !(currentUser.emailVerified === false && MY_TRACKS.length >= UNVERIFIED_TRACK_LIMIT);
  document.getElementById('cgu-banner').hidden = currentUser.cguUpToDate !== false;
  if (currentUser.accountType === 'fan') return;
  const steps = [
    { done: !!currentUser.avatarUrl, key: 'onboarding.step.avatar' },
    { done: !!(currentUser.bio && currentUser.bio.trim()), key: 'onboarding.step.bio' },
    { done: !!currentUser.donationLink, key: 'onboarding.step.donation' },
    { done: !!(currentUser.soundcloudUrl || currentUser.instagramUrl || currentUser.sunoUrl || currentUser.bandcampUrl), key: 'onboarding.step.social' },
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

async function loadMessages() {
  const res = await fetch('/api/me/messages');
  if (!res.ok) return;
  const { messages } = await res.json();
  const list = document.getElementById('messages-list');
  if (messages.length === 0) {
    list.innerHTML = '<p class="empty-state">' + t('messages.empty') + '</p>';
    return;
  }
  list.innerHTML = messages
    .map(
      (m) =>
        '<div class="message-row' + (m.read ? '' : ' unread') + '" data-message-id="' + m.id + '">' +
        '<div class="msg-meta">' +
        (m.fromName ? escapeHtml(m.fromName) + ' · ' : '') +
        escapeHtml(m.fromEmail) +
        ' · ' +
        formatDate(m.createdAt) +
        (m.replied ? ' · ' + t('messages.replied') : '') +
        '</div>' +
        '<div class="msg-body">' + escapeHtml(m.body) + '</div>' +
        (m.replied
          ? ''
          : '<textarea class="msg-reply-input" placeholder="' + t('messages.replyPh') + '"></textarea>' +
            '<button type="button" class="mini-btn msg-reply-btn">' + t('messages.replyBtn') + '</button>' +
            '<span class="form-note msg-reply-status"></span>') +
        '</div>'
    )
    .join('');

  list.querySelectorAll('.message-row.unread').forEach((row) => {
    fetch('/api/me/messages/' + row.getAttribute('data-message-id') + '/read', { method: 'POST' });
  });

  list.querySelectorAll('.msg-reply-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.message-row');
      const textarea = row.querySelector('.msg-reply-input');
      const status = row.querySelector('.msg-reply-status');
      const reply = textarea.value.trim();
      if (!reply) return;
      status.textContent = '…';
      const res = await fetch('/api/me/messages/' + row.getAttribute('data-message-id') + '/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      });
      if (!res.ok) {
        status.textContent = t('error.generic');
        return;
      }
      showToast(t('messages.replySent'));
      loadMessages();
    });
  });
}

// --- Playlists privées ---
// Des listes personnelles (compte fan ou artiste), jamais visibles par
// quelqu'un d'autre que leur propriétaire. Le panneau du tableau de bord
// (playlists-panel) permet de créer/renommer/supprimer une playlist et de
// voir/retirer ses morceaux ; le bouton ➕ sur chaque carte morceau ouvre
// un petit popover pour l'y ajouter (voir plus bas).
async function loadPlaylists() {
  const panel = document.getElementById('playlists-panel');
  if (!panel) return;
  const res = await fetch('/api/me/playlists');
  if (!res.ok) return;
  const { playlists } = await res.json();
  const list = document.getElementById('playlists-list');
  if (!playlists.length) {
    list.innerHTML = '<p class="empty-state">' + t('playlists.empty') + '</p>';
    return;
  }
  list.innerHTML = playlists
    .map(
      (p) =>
        '<div class="playlist-row">' +
        '<div class="playlist-row-head">' +
        '<button type="button" class="playlist-toggle" data-playlist-id="' +
        p.id +
        '">▶ ' +
        escapeHtml(p.name) +
        ' (' +
        p.trackCount +
        ')</button>' +
        '<button type="button" class="mini-btn playlist-rename-btn" data-playlist-id="' +
        p.id +
        '" data-playlist-name="' +
        escapeHtml(p.name) +
        '" title="' +
        t('playlists.rename') +
        '">✏️</button>' +
        '<button type="button" class="mini-btn playlist-delete-btn" data-playlist-id="' +
        p.id +
        '" title="' +
        t('playlists.delete') +
        '">🗑️</button>' +
        '</div>' +
        '<div class="playlist-tracks" data-playlist-id="' +
        p.id +
        '" hidden></div>' +
        '</div>'
    )
    .join('');
}

document.getElementById('playlist-create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('playlist-name-input');
  const name = input.value.trim();
  if (!name) return;
  const res = await fetch('/api/me/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    showToast(t('error.generic'));
    return;
  }
  input.value = '';
  loadPlaylists();
});

document.addEventListener('click', async (e) => {
  const toggle = e.target.closest('.playlist-toggle');
  if (!toggle) return;
  const playlistId = toggle.getAttribute('data-playlist-id');
  const tracksBox = document.querySelector('.playlist-tracks[data-playlist-id="' + playlistId + '"]');
  if (!tracksBox.hidden) {
    tracksBox.hidden = true;
    return;
  }
  tracksBox.innerHTML = '<p class="empty-state">…</p>';
  tracksBox.hidden = false;
  const res = await fetch('/api/me/playlists/' + playlistId);
  if (!res.ok) {
    tracksBox.innerHTML = '<p class="empty-state">' + t('error.generic') + '</p>';
    return;
  }
  const { tracks } = await res.json();
  if (!tracks.length) {
    tracksBox.innerHTML = '<p class="empty-state">' + t('playlists.trackListEmpty') + '</p>';
    return;
  }
  tracksBox.innerHTML = tracks
    .map(
      (tr) =>
        '<div class="playlist-track-row">' +
        '<span>' +
        escapeHtml(tr.title) +
        ' · ' +
        escapeHtml(tr.artistName) +
        '</span>' +
        '<button type="button" class="mini-btn playlist-remove-track-btn" data-playlist-id="' +
        playlistId +
        '" data-track-id="' +
        tr.id +
        '">' +
        t('playlists.removeTrack') +
        '</button>' +
        '</div>'
    )
    .join('');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.playlist-remove-track-btn');
  if (!btn) return;
  await fetch('/api/playlists/' + btn.getAttribute('data-playlist-id') + '/tracks/' + btn.getAttribute('data-track-id'), { method: 'DELETE' });
  loadPlaylists();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.playlist-rename-btn');
  if (!btn) return;
  const current = btn.getAttribute('data-playlist-name');
  const name = window.prompt(t('playlists.renamePrompt'), current);
  if (!name || !name.trim() || name.trim() === current) return;
  const res = await fetch('/api/me/playlists/' + btn.getAttribute('data-playlist-id'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) {
    showToast(t('error.generic'));
    return;
  }
  loadPlaylists();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.playlist-delete-btn');
  if (!btn) return;
  if (!window.confirm(t('playlists.deleteConfirm'))) return;
  await fetch('/api/me/playlists/' + btn.getAttribute('data-playlist-id'), { method: 'DELETE' });
  loadPlaylists();
});

// Bouton ➕ sur une carte morceau : ouvre le popover avec la liste des
// playlists existantes (un clic ajoute directement, pas de retrait
// possible depuis ce popover, on passe par le panneau du tableau de bord
// pour ça) et un petit formulaire pour en créer une nouvelle à la volée.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.add-to-playlist-btn');
  if (!btn) return;
  if (!currentUser) {
    showToast(t('playlists.loginRequired'));
    return;
  }
  const trackId = btn.getAttribute('data-track-id');
  const popover = document.getElementById('add-to-playlist-popover');
  popover.setAttribute('data-track-id', trackId);
  const listBox = document.getElementById('add-to-playlist-list');
  listBox.innerHTML = '<p class="empty-state">…</p>';
  popover.hidden = false;
  const res = await fetch('/api/me/playlists');
  if (!res.ok) {
    listBox.innerHTML = '<p class="empty-state">' + t('error.generic') + '</p>';
    return;
  }
  const { playlists } = await res.json();
  if (!playlists.length) {
    listBox.innerHTML = '<p class="empty-state">' + t('playlists.emptyShort') + '</p>';
    return;
  }
  listBox.innerHTML = playlists
    .map((p) => '<button type="button" class="mini-btn playlist-pick-btn" data-playlist-id="' + p.id + '">' + escapeHtml(p.name) + '</button>')
    .join('');
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.playlist-pick-btn');
  if (!btn) return;
  const popover = document.getElementById('add-to-playlist-popover');
  const trackId = popover.getAttribute('data-track-id');
  btn.disabled = true;
  const res = await fetch('/api/playlists/' + btn.getAttribute('data-playlist-id') + '/tracks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId: Number(trackId) }),
  });
  if (res.ok) {
    btn.textContent = '✓ ' + btn.textContent;
    btn.classList.add('added');
  } else {
    btn.disabled = false;
  }
});

document.getElementById('add-to-playlist-new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('add-to-playlist-new-name');
  const name = input.value.trim();
  if (!name) return;
  const popover = document.getElementById('add-to-playlist-popover');
  const trackId = popover.getAttribute('data-track-id');
  const createRes = await fetch('/api/me/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!createRes.ok) {
    showToast(t('error.generic'));
    return;
  }
  const { playlist } = await createRes.json();
  await fetch('/api/playlists/' + playlist.id + '/tracks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId: Number(trackId) }),
  });
  input.value = '';
  showToast('✓');
  popover.hidden = true;
});

document.getElementById('close-add-to-playlist-popover').addEventListener('click', () => {
  document.getElementById('add-to-playlist-popover').hidden = true;
});

// --- Commentaires ---
// Nécessite un compte (contrairement aux likes). Affiché sous le morceau
// sur sa page dédiée (#/morceau/:id). L'auteur d'un commentaire peut le
// retirer, et l'artiste propriétaire du morceau peut retirer n'importe
// quel commentaire laissé sur ses propres morceaux.
async function loadComments(trackId, trackOwnerId) {
  const box = document.getElementById('track-page-comments');
  if (!box) return;
  box.setAttribute('data-track-id', trackId);
  box.setAttribute('data-track-owner-id', trackOwnerId);
  box.innerHTML = '<h3>' + t('comments.title') + '</h3><p class="empty-state">…</p>';
  const res = await fetch('/api/tracks/' + trackId + '/comments');
  const { comments } = res.ok ? await res.json() : { comments: [] };
  renderComments(box, comments, trackOwnerId);
}

function renderComments(box, comments, trackOwnerId) {
  const canModerate = currentUser && currentUser.id === trackOwnerId;
  const formHtml = currentUser
    ? '<form id="comment-form" class="comment-form">' +
      '<textarea id="comment-input" maxlength="1000" data-i18n-placeholder="comments.placeholder" placeholder="' + t('comments.placeholder') + '"></textarea>' +
      '<button type="submit" class="mini-btn" data-i18n="comments.post">' + t('comments.post') + '</button>' +
      '</form>'
    : '<p class="field-hint">' + t('comments.loginRequired') + '</p>';
  // Rappel visible pour l'artiste, pas seulement une infobulle au survol :
  // ce qu'il retire d'un commentaire sur son morceau reste consultable par
  // Risuona, qui peut le réactiver si le retrait n'était pas justifié.
  const moderationHint = canModerate ? '<p class="field-hint comments-moderation-hint">' + t('comments.moderationHint') + '</p>' : '';
  const listHtml = comments.length
    ? comments
        .map((c) => {
          const isAuthor = currentUser && currentUser.id === c.userId;
          const isArtistModerating = canModerate && !isAuthor;
          const deleteBtn =
            currentUser && (isAuthor || canModerate)
              ? '<button type="button" class="mini-btn comment-delete-btn" data-comment-id="' +
                c.id +
                '"' +
                (isArtistModerating ? ' title="' + escapeHtml(t('comments.moderationHint')) + '"' : '') +
                '>' +
                t('comments.delete') +
                '</button>'
              : '';
          return (
            '<div class="comment-row" data-comment-id="' + c.id + '">' +
            '<div class="comment-meta"><strong>' + escapeHtml(c.authorName) + '</strong> · ' + formatDate(c.createdAt) + '</div>' +
            '<div class="comment-body">' + escapeHtml(c.body) + '</div>' +
            deleteBtn +
            '</div>'
          );
        })
        .join('')
    : '<p class="empty-state">' + t('comments.empty') + '</p>';
  box.innerHTML = '<h3>' + t('comments.title') + ' (' + comments.length + ')</h3>' + formHtml + moderationHint + '<div class="comments-list">' + listHtml + '</div>';
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('#comment-form');
  if (!form) return;
  e.preventDefault();
  const box = document.getElementById('track-page-comments');
  const input = document.getElementById('comment-input');
  const body = input.value.trim();
  if (!body) return;
  const trackId = box.getAttribute('data-track-id');
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const res = await fetch('/api/tracks/' + trackId + '/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  submitBtn.disabled = false;
  if (!res.ok) {
    showToast(t('error.generic'));
    return;
  }
  input.value = '';
  loadComments(trackId, Number(box.getAttribute('data-track-owner-id')));
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.comment-delete-btn');
  if (!btn) return;
  if (!window.confirm(t('comments.deleteConfirm'))) return;
  const box = document.getElementById('track-page-comments');
  const trackId = box.getAttribute('data-track-id');
  await fetch('/api/comments/' + btn.getAttribute('data-comment-id'), { method: 'DELETE' });
  loadComments(trackId, Number(box.getAttribute('data-track-owner-id')));
});

// L'envoi direct vers Spotify/Apple Music est-il déjà branché ? Tant que
// ce n'est pas le cas, on n'affiche PAS les boutons "Distribuer" et
// "Payer" (ils ne menaient qu'à un message d'erreur) : un seul bouton
// emmène l'artiste vers le guide pas à pas.
let DISTRIBUTION_STATUS = null;
async function getDistributionStatus() {
  if (DISTRIBUTION_STATUS) return DISTRIBUTION_STATUS;
  try {
    const res = await fetch('/api/distribution/status');
    DISTRIBUTION_STATUS = await res.json();
  } catch (err) {
    DISTRIBUTION_STATUS = { configured: false, paymentRequired: false };
  }
  return DISTRIBUTION_STATUS;
}

function openDistributionGuide() {
  const panel = document.getElementById('distrib-guide-panel');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  panel.classList.remove('panel-highlight');
  void panel.offsetWidth; // relance l'animation si on reclique
  panel.classList.add('panel-highlight');
}

async function loadMyTracks() {
  const distStatus = await getDistributionStatus();
  const res = await fetch('/api/me/tracks?' + deviceQS());
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
      let distHtml = '';
      let payHtml = '';
      if (dist) {
        distHtml = '<span class="dist-status">' + t('dist.status.' + dist.status) + '</span>';
      } else if (!distStatus.configured) {
        // Pas encore d'envoi direct : on guide l'artiste pas à pas.
        distHtml = '<button type="button" class="mini-btn dist-guide-btn">' + t('dist.guideButton') + '</button>';
      } else if (distStatus.paymentRequired && !tr.distributionPaid) {
        payHtml = '<button class="mini-btn pay-dist-btn" data-pay-id="' + tr.id + '">' + t('pay.button') + '</button>';
      } else {
        distHtml = '<button class="mini-btn dist-only-btn" data-dist-id="' + tr.id + '">' + t('dist.button') + '</button>';
      }
      return (
        '<div class="my-track-row"><span class="title">' +
        escapeHtml(tr.title) +
        (tr.isScheduled
          ? '<span class="my-track-date scheduled-badge">' + t('release.scheduledOn').replace('{date}', formatDateTime(tr.releaseAt)) + '</span>'
          : '<span class="my-track-date">' + formatDate(tr.releaseAt || tr.createdAt) + ' · ' + (tr.plays === 1 ? t('track.playsOne') : t('track.playsMany').replace('{n}', tr.plays)) + '</span>') +
        '</span><div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">' +
        distHtml +
        payHtml +
        '<button class="mini-btn edit-only-btn" data-edit-id="' +
        tr.id +
        '">' +
        t('dashboard.myTracks.edit') +
        '</button>' +
        '<button class="mini-btn promo-btn" title="' + t('dashboard.myTracks.promoHint') + '" data-promo-id="' +
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
  backfillGeneratedCovers(tracks);
  list.querySelectorAll('.promo-btn').forEach((btn) => {
    btn.addEventListener('click', () => generatePromoVisual(Number(btn.getAttribute('data-promo-id'))));
  });
  list.querySelectorAll('.dist-guide-btn').forEach((btn) => {
    btn.addEventListener('click', openDistributionGuide);
  });
  list.querySelectorAll('.dist-only-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.textContent = '…';
      const res = await fetch('/api/tracks/' + btn.getAttribute('data-dist-id') + '/distribute', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showToast(
          data.error === 'not_configured'
            ? t('dist.notConfigured')
            : data.error === 'payment_required'
            ? t('dist.paymentRequired')
            : t('error.generic')
        );
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
  const localeMap = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
  return d.toLocaleDateString(localeMap[CURRENT_LANG] || 'fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// --- Pochettes automatiques ---
function coverArtistLabel(name, style) {
  return style === 'initials' && window.RisuonaCover ? RisuonaCover.initials(name) : name || '';
}

function myCoverArtist() {
  return currentUser ? coverArtistLabel(currentUser.artistName, currentUser.coverNameStyle) : '';
}

// Morceau encore sans aucune pochette (publié avant les pochettes
// automatiques) : on dessine à l'affichage la même pochette que celle qui
// lui sera attribuée (graine tirée du titre), en attendant qu'elle soit
// enregistrée depuis l'espace de l'artiste.
const FALLBACK_COVERS = {};
function fallbackCoverUrl(title, artistName) {
  if (!window.RisuonaCover) return '';
  const key = (title || '') + '|' + (artistName || '');
  if (!FALLBACK_COVERS[key]) {
    FALLBACK_COVERS[key] = RisuonaCover.render({ title, artist: artistName }, 400).toDataURL('image/jpeg', 0.85);
  }
  return FALLBACK_COVERS[key];
}

function coverArt(tr) {
  const url = tr.coverUrl || fallbackCoverUrl(tr.title, tr.artistName);
  if (url) {
    return '<img class="cover-art" src="' + escapeHtml(url) + '" alt="">';
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
  const aiParts = [];
  if (tr.aiLyrics) aiParts.push(t('ai.part.lyricsTag'));
  if (tr.aiMusic) aiParts.push(t('ai.part.musicTag'));
  if (tr.aiVocals) aiParts.push(t('ai.part.vocalsTag'));
  if (aiParts.length) {
    tags.push('<span class="tag ai">' + t('ai.tagPrefix') + ' ' + aiParts.join(', ') + (tr.aiTool ? ' · ' + escapeHtml(tr.aiTool) : '') + '</span>');
  }
  if (tr.explicit) tags.push('<span class="tag explicit">' + t('tag.explicit') + '</span>');
  if (tr.exclusive) tags.push('<span class="tag tag-exclusive">' + t('exclusive.badge') + '</span>');
  if (Date.now() - (tr.releaseAt || tr.createdAt) < 7 * 24 * 60 * 60 * 1000) tags.push('<span class="tag new">' + t('tag.new') + '</span>');
  if ((tr.plays || 0) < 10) {
    tags.push('<span class="tag tag-early" data-tooltip="' + escapeHtml(t('tag.earlyListenTooltip')) + '">' + t('tag.earlyListen') + '</span>');
  }

  const streamingLinks = [];
  if (tr.spotifyUrl) streamingLinks.push(linkPill(tr.spotifyUrl, t('link.spotify')));
  if (tr.appleUrl) streamingLinks.push(linkPill(tr.appleUrl, t('link.apple')));

  const otherLinks = [];
  if (tr.soundcloudUrl) otherLinks.push(linkPill(tr.soundcloudUrl, t('link.soundcloud')));
  if (tr.instagramUrl) otherLinks.push(linkPill(tr.instagramUrl, t('link.instagram')));
  if (tr.sunoUrl) otherLinks.push(linkPill(tr.sunoUrl, t('link.suno')));
  if (tr.bandcampUrl) otherLinks.push(linkPill(tr.bandcampUrl, t('link.bandcamp')));
  if (tr.donationLink) otherLinks.push(linkPill(tr.donationLink, t('link.donate'), true));

  return (
    '<div class="track">' +
    coverWithAlbum(tr) +
    '<div class="track-body">' +
    '<div class="meta"><h3>' +
    escapeHtml(tr.title) +
    '</h3><div class="artist"><a class="artist-name-link" href="#/artiste/' +
    tr.userId +
    '">' +
    escapeHtml(tr.artistName) +
    '</a>' +
    (tr.collaborators ? '<span class="collab"> · ' + t('track.with') + ' ' + escapeHtml(tr.collaborators) + '</span>' : '') +
    '</div>' +
    albumLine(tr) +
    '<div class="tags">' +
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
    '" data-artist-id="' +
    tr.userId +
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
    formatDate(tr.releaseAt || tr.createdAt) +
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
    '<button type="button" class="link-pill share-track-btn" aria-label="' +
    escapeHtml(t('track.shareTooltip')) +
    '" data-tooltip="' +
    escapeHtml(t('track.shareTooltip')) +
    '" data-share-url="' +
    escapeHtml(window.location.origin + '/#/morceau/' + tr.id) +
    '" data-share-artist="' +
    escapeHtml(tr.artistName) +
    '">🔗</button>' +
    '<button type="button" class="link-pill like-track-btn' +
    (tr.liked ? ' liked' : '') +
    '" data-track-id="' +
    tr.id +
    '" data-liked="' +
    (tr.liked ? 'true' : 'false') +
    '" aria-pressed="' +
    (tr.liked ? 'true' : 'false') +
    '" aria-label="' +
    escapeHtml(t('track.like')) +
    '" data-tooltip="' +
    escapeHtml(t('track.like')) +
    '">' +
    (tr.liked ? '❤️' : '🤍') +
    ' <span class="like-count">' +
    (tr.likeCount || 0) +
    '</span></button>' +
    '<a class="link-pill comment-link-btn" href="#/morceau/' +
    tr.id +
    '" aria-label="' +
    escapeHtml(t('comments.viewOnTrack')) +
    '" data-tooltip="' +
    escapeHtml(t('comments.viewOnTrack')) +
    '">💬</a>' +
    '<button type="button" class="link-pill add-to-playlist-btn" data-track-id="' +
    tr.id +
    '" aria-label="' +
    escapeHtml(t('playlists.addToTitle')) +
    '" data-tooltip="' +
    escapeHtml(t('playlists.addToTitle')) +
    '">➕</button>' +
    '<button type="button" class="link-pill report-track-btn" data-report-id="' +
    tr.id +
    '" aria-label="' +
    escapeHtml(t('track.report')) +
    '" data-tooltip="' +
    escapeHtml(t('track.report')) +
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
  const res = await fetch('/api/tracks?' + deviceQS());
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
  const aiFilter = document.getElementById('discover-ai').value;
  const hideExplicit = document.getElementById('discover-hide-explicit').checked;

  const filtered = ALL_TRACKS.filter((tr) => {
    const matchesQuery = !query || tr.title.toLowerCase().includes(query) || tr.artistName.toLowerCase().includes(query);
    const matchesGenre = !genre || tr.genre === genre;
    let matchesAi = true;
    if (aiFilter === 'no-ai') matchesAi = !tr.aiLyrics && !tr.aiMusic && !tr.aiVocals;
    else if (aiFilter === 'lyrics') matchesAi = !!tr.aiLyrics;
    else if (aiFilter === 'music') matchesAi = !!tr.aiMusic;
    else if (aiFilter === 'vocals') matchesAi = !!tr.aiVocals;
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
  // Pochette automatique (pas d'image envoyée par l'artiste, pas de
  // pochette d'album qui prendrait le dessus) : on peut en tirer une autre.
  const album = tr.albumId ? MY_ALBUMS.find((a) => a.id === tr.albumId) : null;
  const autoCover = !!window.RisuonaCover && !tr.hasOwnCover && !(album && album.coverUrl);
  let editCoverSeed = null;
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
    '<label class="edit-explicit-row"><input type="checkbox" class="edit-exclusive"' + (tr.exclusive ? ' checked' : '') + '> ' + t('exclusive.label') + '</label>' +
    '<label class="edit-explicit-row"><input type="checkbox" class="edit-explicit"' + (tr.explicit ? ' checked' : '') + '> ' + t('dashboard.addTrack.explicit') + '</label>' +
    '<label>' + t('dashboard.addTrack.aiLevel') + '</label>' +
    '<div class="radio-group">' +
    '<label class="checkbox-option"><input type="checkbox" class="edit-ai-lyrics"' + (tr.aiLyrics ? ' checked' : '') + '> ' + t('ai.part.lyrics') + '</label>' +
    '<label class="checkbox-option"><input type="checkbox" class="edit-ai-music"' + (tr.aiMusic ? ' checked' : '') + '> ' + t('ai.part.music') + '</label>' +
    '<label class="checkbox-option"><input type="checkbox" class="edit-ai-vocals"' + (tr.aiVocals ? ' checked' : '') + '> ' + t('ai.part.vocals') + '</label>' +
    '</div>' +
    '<label>' + t('dashboard.addTrack.aiTool') + '</label>' +
    '<input type="text" class="edit-aitool" value="' + escapeHtml(tr.aiTool || '') + '">' +
    '<label class="edit-explicit-row"><input type="checkbox" class="edit-ai-commercial-rights"' + (tr.aiCommercialRights ? ' checked' : '') + '> ' + t('ai.commercialRights.label') + '</label>' +
    '<label>' + t('dashboard.addTrack.cover') + '</label>' +
    '<input type="file" class="edit-cover" accept="image/*">' +
    (autoCover
      ? '<div class="edit-cover-auto"><img class="edit-cover-auto-img" src="' +
        escapeHtml(tr.coverUrl || fallbackCoverUrl(tr.title, tr.artistName)) +
        '" alt=""><button type="button" class="mini-btn edit-cover-regen">' + t('covers.regenerate') + '</button></div>' +
        '<p class="field-hint">' + t('covers.editAutoHint') + '</p>'
      : '') +
    '<label>' + t('album.label') + '</label>' +
    '<select class="edit-album">' + albumOptionsHtml(tr.albumId) + '</select>' +
    '<div class="edit-album-new album-new-block" hidden>' +
    '<label>' + t('album.titleLabel') + '</label><input type="text" class="edit-album-title" maxlength="200">' +
    '<label>' + t('album.coverLabel') + '</label><input type="file" class="edit-album-cover" accept="image/*">' +
    '</div>' +
    (tr.isScheduled
      ? '<label>' + t('release.label') + '</label>' +
        '<input type="datetime-local" class="edit-release" value="' + toLocalInputValue(tr.releaseAt) + '">' +
        '<p class="field-hint">' + t('release.publishNowHint') + '</p>' +
        '<div class="advice-bubble edit-release-advice" hidden aria-live="polite"></div>'
      : '') +
    '<div class="form-actions"><button type="button" class="btn btn-primary edit-save">' + t('dashboard.myTracks.save') + '</button>' +
    '<span class="form-note edit-status"></span></div>';
  panel.hidden = false;

  const regenBtn = panel.querySelector('.edit-cover-regen');
  if (regenBtn) {
    regenBtn.addEventListener('click', () => {
      editCoverSeed = RisuonaCover.randomSeed();
      const opts = { seed: editCoverSeed, title: panel.querySelector('.edit-title').value.trim(), artist: myCoverArtist() };
      panel.querySelector('.edit-cover-auto-img').src = RisuonaCover.render(opts, 320).toDataURL('image/jpeg', 0.85);
    });
  }

  const editAlbum = panel.querySelector('.edit-album');
  editAlbum.addEventListener('change', () => {
    panel.querySelector('.edit-album-new').hidden = editAlbum.value !== 'new';
  });

  const editRelease = panel.querySelector('.edit-release');
  if (editRelease) {
    const bubble = panel.querySelector('.edit-release-advice');
    editRelease.addEventListener('focus', () => (editRelease.min = toLocalInputValue(Date.now())));
    editRelease.addEventListener('change', () => refreshReleaseAdvice(editRelease, bubble, trackId));
  }

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
    formData.append('exclusive', panel.querySelector('.edit-exclusive').checked);
    formData.append('aiLyrics', panel.querySelector('.edit-ai-lyrics').checked);
    formData.append('aiMusic', panel.querySelector('.edit-ai-music').checked);
    formData.append('aiVocals', panel.querySelector('.edit-ai-vocals').checked);
    formData.append('aiTool', panel.querySelector('.edit-aitool').value.trim());
    formData.append('aiCommercialRights', panel.querySelector('.edit-ai-commercial-rights').checked);
    const coverFile = panel.querySelector('.edit-cover').files[0];
    if (coverFile) formData.append('cover', coverFile);
    // Pochette automatique : nouvelle pochette si l'artiste en a tiré une
    // autre, ou si le titre a changé (sinon l'ancien titre resterait écrit
    // dessus).
    const newTitle = panel.querySelector('.edit-title').value.trim();
    if (!coverFile && autoCover && (editCoverSeed !== null || (tr.coverGenerated && newTitle !== tr.title))) {
      const seed = editCoverSeed !== null ? editCoverSeed : RisuonaCover.randomSeed();
      formData.append('cover', await RisuonaCover.toFile({ seed, title: newTitle, artist: myCoverArtist() }));
      formData.append('coverGenerated', 'true');
    }
    // On n'envoie l'album que s'il a changé (évite toute erreur si l'étape
    // Supabase des albums n'a pas encore été faite).
    if (editAlbum.value !== String(tr.albumId || '')) {
      if (editAlbum.value === 'new' && !panel.querySelector('.edit-album-title').value.trim()) {
        status.textContent = t('album.titleMissing');
        return;
      }
      formData.append('albumChoice', editAlbum.value);
      if (editAlbum.value === 'new') {
        formData.append('albumTitle', panel.querySelector('.edit-album-title').value.trim());
        const albumCoverFile = panel.querySelector('.edit-album-cover').files[0];
        if (albumCoverFile) formData.append('albumCover', albumCoverFile);
      }
    }
    if (editRelease) {
      // Champ vidé = publier tout de suite.
      formData.append('releaseAt', editRelease.value ? String(new Date(editRelease.value).getTime()) : '');
    }

    status.textContent = '…';
    const res = await fetch('/api/tracks/' + trackId, { method: 'PUT', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      status.textContent =
        err.error === 'release_too_far'
          ? t('release.advice.too_far')
          : err.error === 'album_title_missing'
          ? t('album.titleMissing')
          : err.error === 'albums_table_missing'
          ? t('album.notReady')
          : err.error === 'covers_not_ready'
          ? t('covers.notReady')
          : t('error.generic');
      return;
    }
    if (editAlbum.value === 'new') loadMyAlbums();
    showToast('✓');
    panel.hidden = true;
    loadMyTracks();
    loadFeed();
  });
}

// Morceaux publiés avant les pochettes automatiques et toujours sans
// aucune image : quand l'artiste ouvre son espace, on leur enregistre leur
// pochette (la même que celle déjà affichée aux visiteurs). Une seule
// tentative par morceau et par visite ; si l'étape Supabase n'est pas
// encore faite, on s'arrête sans rien casser.
const COVER_BACKFILL_TRIED = new Set();
async function backfillGeneratedCovers(tracks) {
  if (!window.RisuonaCover || !currentUser) return;
  const todo = tracks.filter((tr) => !tr.coverUrl && !tr.hasOwnCover && !COVER_BACKFILL_TRIED.has(tr.id));
  for (const tr of todo) {
    COVER_BACKFILL_TRIED.add(tr.id);
    const formData = new FormData();
    formData.append('cover', await RisuonaCover.toFile({ title: tr.title, artist: myCoverArtist() }));
    formData.append('coverGenerated', 'true');
    const res = await fetch('/api/tracks/' + tr.id, { method: 'PUT', body: formData }).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json().catch(() => null);
    if (data && data.track) Object.assign(tr, data.track);
  }
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
  const promoCoverUrl = tr.coverUrl || fallbackCoverUrl(tr.title, tr.artistName || (currentUser && currentUser.artistName));
  if (promoCoverUrl) {
    const img = await loadImage(promoCoverUrl);
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
  ctx.fillText('Risuona', 44, SIZE - 30);

  // QR code vers la page de l'artiste sur Risuona
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

  const fileName = (tr.title || 'risuona').replace(/[^a-zA-Z0-9-_]+/g, '_') + '.png';

  // Sur téléphone : ouvre le menu de partage natif (Instagram, TikTok,
  // messages…), prêt en un clic. Sinon (ordinateur, navigateurs qui ne
  // le permettent pas), on télécharge simplement l'image.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: tr.title || 'Risuona' });
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
let ADMIN_USERS = [];
let ADMIN_TRACKS = [];
let ADMIN_ACCOUNT_TYPE_HISTORY = [];
let ADMIN_REPORTS = [];

function adminTypeLabel(u) {
  if (u.role === 'admin') return 'admin';
  return u.accountType === 'fan' ? t('admin.type.listener') : t('admin.type.artist');
}

function accountTypeLabelFor(type) {
  return type === 'fan' ? t('admin.type.listener') : t('admin.type.artist');
}

// Historique complet des bascules fan <-> artiste pour un compte donné
// (voir migration-account-type-history.sql), reconstruit en périodes
// successives : chaque bascule marque à la fois la fin de la période
// précédente et le début de la suivante.
function accountTypeHistoryHtml(userId) {
  const rows = ADMIN_ACCOUNT_TYPE_HISTORY.filter((h) => h.userId === userId).sort((a, b) => a.changedAt - b.changedAt);
  if (rows.length === 0) return '<p class="field-hint">' + t('admin.users.historyNone') + '</p>';
  const lines = rows.map((h, i) => {
    const next = rows[i + 1];
    const label = accountTypeLabelFor(h.toType);
    return next
      ? t('admin.users.historyPeriod').replace('{type}', label).replace('{start}', formatDate(h.changedAt)).replace('{end}', formatDate(next.changedAt))
      : t('admin.users.historyOngoing').replace('{type}', label).replace('{start}', formatDate(h.changedAt));
  });
  return '<ul class="admin-history-list">' + lines.map((l) => '<li>' + l + '</li>').join('') + '</ul>';
}

async function loadAdminReports() {
  const res = await fetch('/api/admin/reports');
  if (!res.ok) return;
  const { reports } = await res.json();
  ADMIN_REPORTS = reports;
  const list = document.getElementById('admin-reports-list');
  if (reports.length === 0) {
    list.innerHTML = '<p class="empty-state">' + t('admin.reports.empty') + '</p>';
  } else {
    list.innerHTML = reports
      .map(
        (r) =>
          '<div class="admin-row"><div class="who"><span>' +
          escapeHtml(r.trackTitle) + ' ' + t('admin.reports.by') + ' ' + escapeHtml(r.artistName) +
          '</span><span class="sub">' + escapeHtml(r.reason) + ' · ' + formatDate(r.createdAt) +
          '</span></div><button class="del-btn" data-resolve-id="' + r.id + '">' + t('admin.reports.resolve') + '</button></div>'
      )
      .join('');
    list.querySelectorAll('[data-resolve-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch('/api/admin/reports/' + btn.getAttribute('data-resolve-id') + '/resolve', { method: 'POST' });
        loadAdminReports();
      });
    });
  }
  renderAdminStats();
  renderAdminTodo();
}

// Commentaires retirés (par leur auteur ou par l'artiste du morceau),
// volontairement séparés des signalements de morceaux ci-dessus : une
// liste consultable pour relecture, pas une file "à traiter" en urgence.
async function loadAdminCommentsRemoved() {
  const res = await fetch('/api/admin/comments/removed');
  if (!res.ok) return;
  const { comments } = await res.json();
  const list = document.getElementById('admin-comments-list');
  if (comments.length === 0) {
    list.innerHTML = '<p class="empty-state">' + t('admin.comments.empty') + '</p>';
    return;
  }
  list.innerHTML = comments
    .map(
      (c) =>
        '<div class="admin-row"><div class="who"><span>' +
        escapeHtml(c.trackTitle) + ' ' + t('admin.reports.by') + ' ' + escapeHtml(c.artistName) +
        '</span><span class="sub">« ' + escapeHtml(c.body) + ' » — ' + escapeHtml(c.authorName) + ' · ' + formatDate(c.createdAt) +
        '</span><span class="sub">' +
        (c.deletedByArtist ? t('admin.comments.removedByArtist') : t('admin.comments.removedByAuthor')).replace('{name}', escapeHtml(c.deletedByName)) +
        ' · ' + formatDate(c.deletedAt) +
        '</span></div><button class="mini-btn" data-restore-id="' + c.id + '">' + t('admin.comments.restore') + '</button></div>'
    )
    .join('');
  list.querySelectorAll('[data-restore-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch('/api/admin/comments/' + btn.getAttribute('data-restore-id') + '/restore', { method: 'POST' });
      showToast(t('admin.comments.restored'));
      loadAdminCommentsRemoved();
    });
  });
}

function updateAdminUI() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  document.getElementById('nav-admin').hidden = !isAdmin;
  document.getElementById('admin-block').hidden = !isAdmin;
  if (isAdmin) {
    loadAdminOverview();
    renderAdminTotpPanel();
    loadWebauthnCredentials();
  }
}

// --- Double authentification (TOTP) du compte admin ---
function renderAdminTotpPanel() {
  const enabled = !!currentUser.totpEnabled;
  document.getElementById('admin-totp-status-line').textContent = enabled ? t('admin.totp.statusOn') : t('admin.totp.statusOff');
  document.getElementById('admin-totp-setup-btn').hidden = enabled;
  document.getElementById('admin-totp-setup-wrap').hidden = true;
  document.getElementById('admin-totp-disable-wrap').hidden = !enabled;
}

document.getElementById('admin-totp-setup-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const res = await fetch('/api/admin/totp/setup', { method: 'POST' });
  btn.disabled = false;
  const data = await res.json();
  if (!res.ok) {
    showToast(t('error.' + data.error) || t('error.generic'));
    return;
  }
  document.getElementById('admin-totp-secret').textContent = data.secret;
  document.getElementById('admin-totp-confirm-code').value = '';
  document.getElementById('admin-totp-setup-status').textContent = '';
  document.getElementById('admin-totp-setup-wrap').hidden = false;
});

document.getElementById('admin-totp-confirm-btn').addEventListener('click', async (e) => {
  const status = document.getElementById('admin-totp-setup-status');
  const btn = e.target;
  const code = document.getElementById('admin-totp-confirm-code').value.trim();
  btn.disabled = true;
  status.textContent = '…';
  const res = await fetch('/api/admin/totp/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  btn.disabled = false;
  const data = await res.json();
  if (!res.ok) {
    status.textContent = t('error.' + data.error) || t('error.generic');
    return;
  }
  currentUser = data.user;
  status.textContent = '';
  showToast(t('admin.totp.enabled'));
  renderAdminTotpPanel();
});

document.getElementById('admin-totp-disable-btn').addEventListener('click', async (e) => {
  const status = document.getElementById('admin-totp-disable-status');
  const btn = e.target;
  const code = document.getElementById('admin-totp-disable-code').value.trim();
  btn.disabled = true;
  status.textContent = '…';
  const res = await fetch('/api/admin/totp/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  btn.disabled = false;
  const data = await res.json();
  if (!res.ok) {
    status.textContent = t('error.' + data.error) || t('error.generic');
    return;
  }
  currentUser = data.user;
  document.getElementById('admin-totp-disable-code').value = '';
  status.textContent = '';
  showToast(t('admin.totp.disabled'));
  renderAdminTotpPanel();
});

// --- Face ID / Touch ID (WebAuthn) du compte admin ---
document.getElementById('admin-webauthn-register-btn').addEventListener('click', async () => {
  const status = document.getElementById('admin-webauthn-status');
  const btn = document.getElementById('admin-webauthn-register-btn');
  if (!window.PublicKeyCredential) {
    status.textContent = t('admin.webauthn.unsupported');
    return;
  }
  btn.disabled = true;
  status.textContent = '…';
  try {
    const optRes = await fetch('/api/admin/webauthn/register-options', { method: 'POST' });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || 'error');
    const publicKey = webauthnParseCreationOptions(options);
    const cred = await navigator.credentials.create({ publicKey });
    const verifyRes = await fetch('/api/admin/webauthn/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webauthnCredentialToJSON(cred)),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.error || 'error');
    status.textContent = t('admin.webauthn.registered');
    loadWebauthnCredentials();
  } catch (err) {
    status.textContent = t('admin.webauthn.error');
  }
  btn.disabled = false;
});

async function loadWebauthnCredentials() {
  const list = document.getElementById('admin-webauthn-list');
  if (!list) return;
  const res = await fetch('/api/admin/webauthn/credentials');
  if (!res.ok) return;
  const { credentials } = await res.json();
  if (!credentials || !credentials.length) {
    list.innerHTML = '<p class="field-hint">' + t('admin.webauthn.none') + '</p>';
    return;
  }
  list.innerHTML = credentials
    .map((c) => {
      const label = c.deviceLabel || t('admin.webauthn.deviceGeneric');
      const dateStr = escapeHtml(new Date(c.createdAt).toLocaleDateString('fr-FR'));
      return (
        '<div class="admin-row"><div class="who"><span>' + escapeHtml(label) + '</span><span class="sub">' + dateStr + '</span></div>' +
        '<button type="button" class="mini-btn" data-delete-webauthn-id="' + c.id + '">' + t('admin.webauthn.delete') + '</button>' +
        '</div>'
      );
    })
    .join('');
  list.querySelectorAll('[data-delete-webauthn-id]').forEach((delBtn) => {
    delBtn.addEventListener('click', async () => {
      delBtn.disabled = true;
      await fetch('/api/admin/webauthn/credentials/' + delBtn.getAttribute('data-delete-webauthn-id'), { method: 'DELETE' });
      loadWebauthnCredentials();
    });
  });
}

async function loadAdminOverview() {
  const res = await fetch('/api/admin/overview');
  if (!res.ok) return;
  const { users, tracks, accountTypeHistory } = await res.json();
  ADMIN_USERS = users;
  ADMIN_TRACKS = tracks;
  ADMIN_ACCOUNT_TYPE_HISTORY = accountTypeHistory || [];
  renderAdminUsers();
  renderAdminTracks();
  loadAdminAnnouncements();
  loadAdminReports(); // met aussi à jour les chiffres et "À traiter"
  loadAdminCommentsRemoved();
}

// --- Chiffres clés ---
function renderAdminStats() {
  const members = ADMIN_USERS.filter((u) => u.role !== 'admin');
  const blocks = [
    { n: members.filter((u) => u.accountType !== 'fan').length, key: 'admin.stats.artists' },
    { n: members.filter((u) => u.accountType === 'fan').length, key: 'admin.stats.listeners' },
    { n: ADMIN_TRACKS.length, key: 'admin.stats.tracks' },
    { n: ADMIN_REPORTS.length, key: 'admin.stats.reports' },
  ];
  document.getElementById('admin-stats').innerHTML = blocks
    .map((b) => '<div class="admin-stat"><div class="admin-stat-number">' + b.n + '</div><div class="admin-stat-label">' + t(b.key) + '</div></div>')
    .join('');
}

// --- À traiter : tout ce qui demande une action, au même endroit ---
function renderAdminTodo() {
  const list = document.getElementById('admin-todo-list');
  const toVerify = ADMIN_USERS.filter((u) => u.role !== 'admin' && !u.emailVerified);
  let html = '';

  if (toVerify.length) {
    html +=
      '<div class="admin-todo-section"><h4>' + t('admin.todo.emailsTitle') + ' (' + toVerify.length + ')</h4>' +
      '<p class="field-hint">' + t('admin.todo.emailsHint') + '</p>' +
      toVerify
        .map(
          (u) =>
            '<div class="admin-row"><div class="who"><span>' + escapeHtml(u.artistName) + ' · ' + adminTypeLabel(u) + '</span>' +
            '<span class="sub">' + escapeHtml(u.email) + (u.createdAt ? ' · ' + t('admin.users.joined').replace('{date}', formatDate(u.createdAt)) : '') + '</span></div>' +
            '<button class="mini-btn" data-manual-verify-id="' + u.id + '">' + t('admin.todo.confirm') + '</button></div>'
        )
        .join('') +
      '</div>';
  }

  if (ADMIN_REPORTS.length) {
    html +=
      '<div class="admin-todo-section"><h4>' + t('admin.todo.reports').replace('{n}', ADMIN_REPORTS.length) + '</h4>' +
      '<button type="button" class="mini-btn" id="admin-see-reports">' + t('admin.todo.seeReports') + '</button></div>';
  }

  list.innerHTML = html || '<p class="admin-todo-empty">' + t('admin.todo.nothing') + '</p>';

  list.querySelectorAll('[data-manual-verify-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch('/api/admin/users/' + btn.getAttribute('data-manual-verify-id') + '/manual-verify', { method: 'POST' });
      showToast(t('admin.manualVerified'));
      loadAdminOverview();
    });
  });
  const seeReports = document.getElementById('admin-see-reports');
  if (seeReports) {
    seeReports.addEventListener('click', () => document.getElementById('admin-reports-panel').scrollIntoView({ behavior: 'smooth' }));
  }
}

// --- Comptes inscrits, avec recherche ---
function renderAdminUsers() {
  const query = document.getElementById('admin-users-search').value.trim().toLowerCase();
  const users = ADMIN_USERS.filter(
    (u) => !query || (u.artistName || '').toLowerCase().includes(query) || (u.email || '').toLowerCase().includes(query)
  );
  const usersList = document.getElementById('admin-users-list');
  if (users.length === 0) {
    usersList.innerHTML = '<p class="empty-state">' + t('admin.users.none') + '</p>';
    return;
  }
  usersList.innerHTML = users
    .map((u) => {
      const exportActive = (u.exportExpiresAt || 0) > Date.now();
      return (
        '<div class="admin-row"><div class="who"><span>' + escapeHtml(u.artistName) + ' · ' + adminTypeLabel(u) +
        (u.role !== 'admin' && !u.emailVerified ? ' <span class="admin-badge">' + t('admin.users.unverified') + '</span>' : '') +
        // Confirmé manuellement depuis l'admin, mais le lien reçu par
        // e-mail n'a lui-même jamais été cliqué : distinct d'une adresse
        // réellement confirmée, pour laquelle rien ne s'affiche ici (déjà
        // en règle, comme avant).
        (u.role !== 'admin' && u.emailVerified && !u.verifiedViaLink ? ' <span class="admin-badge">' + t('admin.users.manuallyVerified') + '</span>' : '') +
        (u.identityVerified ? ' <span class="admin-badge admin-badge-verified">' + t('admin.users.identityVerified') + '</span>' : '') +
        (u.sacemMember ? ' <span class="admin-badge admin-badge-verified">' + t('admin.users.sacem').replace('{date}', u.sacemMemberSince ? formatDate(u.sacemMemberSince) : '?') + '</span>' : '') +
        '</span><span class="sub">' + escapeHtml(u.email) +
        (u.createdAt ? ' · ' + t('admin.users.joined').replace('{date}', formatDate(u.createdAt)) : '') +
        '</span></div>' +
        (u.role === 'admin'
          ? ''
          : '<button class="mini-btn" data-enable-export-id="' + u.id + '"' + (exportActive ? ' disabled' : '') + '>' +
            (exportActive ? t('admin.exportActive') : t('admin.enableExport')) + '</button>' +
            (u.emailVerified ? '' : '<button class="mini-btn" data-manual-verify-id="' + u.id + '">' + t('admin.todo.confirm') + '</button>') +
            (u.role === 'admin' ? '' : '<button class="mini-btn" data-toggle-verified-id="' + u.id + '">' + (u.identityVerified ? t('admin.users.unverify') : t('admin.users.verify')) + '</button>') +
            '<button class="mini-btn" data-history-toggle-id="' + u.id + '">' + t('admin.users.history') + '</button>' +
            '<button class="del-btn" data-user-id="' + u.id + '">' + t('admin.remove') + '</button>') +
        '</div>' +
        (u.role === 'admin' ? '' : '<div class="admin-history" data-history-panel-id="' + u.id + '" hidden>' + accountTypeHistoryHtml(u.id) + '</div>')
      );
    })
    .join('');
  usersList.querySelectorAll('[data-history-toggle-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = usersList.querySelector('[data-history-panel-id="' + btn.getAttribute('data-history-toggle-id') + '"]');
      if (panel) panel.hidden = !panel.hidden;
    });
  });
  usersList.querySelectorAll('[data-user-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.confirmRemoveUser'))) return;
      await fetch('/api/admin/users/' + btn.getAttribute('data-user-id'), { method: 'DELETE' });
      loadAdminOverview();
      loadFeed();
    });
  });
  usersList.querySelectorAll('[data-enable-export-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch('/api/admin/users/' + btn.getAttribute('data-enable-export-id') + '/enable-export', { method: 'POST' });
      showToast(t('admin.exportEnabled'));
      loadAdminOverview();
    });
  });
  usersList.querySelectorAll('[data-toggle-verified-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch('/api/admin/users/' + btn.getAttribute('data-toggle-verified-id') + '/toggle-verified', { method: 'POST' });
      loadAdminOverview();
    });
  });
  usersList.querySelectorAll('[data-manual-verify-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch('/api/admin/users/' + btn.getAttribute('data-manual-verify-id') + '/manual-verify', { method: 'POST' });
      showToast(t('admin.manualVerified'));
      loadAdminOverview();
    });
  });
}

// --- Tous les morceaux, avec recherche ---
function renderAdminTracks() {
  const query = document.getElementById('admin-tracks-search').value.trim().toLowerCase();
  const tracks = ADMIN_TRACKS.filter(
    (tr) => !query || (tr.title || '').toLowerCase().includes(query) || (tr.artistName || '').toLowerCase().includes(query)
  );
  const tracksList = document.getElementById('admin-tracks-list');
  if (tracks.length === 0) {
    tracksList.innerHTML = '<p class="empty-state">' + t('admin.tracks.none') + '</p>';
    return;
  }
  tracksList.innerHTML = tracks
    .map(
      (tr) =>
        '<div class="admin-row"><div class="who"><span>' + escapeHtml(tr.title) +
        (tr.isScheduled ? ' <span class="admin-badge">' + t('release.scheduledOn').replace('{date}', formatDateTime(tr.releaseAt)) + '</span>' : '') +
        (tr.exclusive ? ' <span class="admin-badge admin-badge-verified">' + t('exclusive.badge') + '</span>' : '') +
        (tr.spotifyUrl || tr.appleUrl ? ' <span class="admin-badge">' + t('admin.tracks.distributed') + '</span>' : '') +
        '</span><span class="sub">' + escapeHtml(tr.artistName) + '</span></div>' +
        '<button class="del-btn" data-track-id="' + tr.id + '">' + t('admin.remove') + '</button></div>'
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

// --- Annonces : bandeau en haut du site ---
let ANNOUNCEMENTS = [];
let ANNOUNCEMENTS_VIEWER = null;
let ANNOUNCEMENTS_LOADED = false;
const DISMISSED_KEY = 'resonance_dismissed_announcements';

function getDismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
  } catch (err) {
    return [];
  }
}

// Le message de bienvenue est retenu par compte (plusieurs personnes
// peuvent utiliser le même appareil) ; les annonces, par numéro.
function announcementKey(a) {
  return a.kind === 'welcome' ? 'welcome-' + ANNOUNCEMENTS_VIEWER : 'a-' + a.id;
}

function announcementText(a) {
  return a.messages[CURRENT_LANG] || a.messages.fr || '';
}

async function loadAnnouncements() {
  try {
    const res = await fetch('/api/announcements');
    const data = await res.json();
    ANNOUNCEMENTS = data.announcements || [];
    ANNOUNCEMENTS_VIEWER = data.viewerId;
  } catch (err) {
    ANNOUNCEMENTS = [];
  }
  ANNOUNCEMENTS_LOADED = true;
  renderAnnouncements();
}

function renderAnnouncements() {
  const bar = document.getElementById('announcements-bar');
  const dismissed = getDismissed();
  const visible = ANNOUNCEMENTS.filter((a) => !dismissed.includes(announcementKey(a)) && announcementText(a));
  if (visible.length === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = visible
    .map(
      (a) =>
        '<div class="announcement' + (a.kind === 'welcome' ? ' announcement-welcome' : '') + '">' +
        '<span class="announcement-icon" aria-hidden="true">' + (a.kind === 'welcome' ? '👋' : '📣') + '</span>' +
        '<p class="announcement-text">' + escapeHtml(announcementText(a)).replace(/\n/g, '<br>') + '</p>' +
        '<button type="button" class="announcement-close" data-dismiss-key="' + announcementKey(a) + '" aria-label="' + escapeHtml(t('announce.close')) + '">✕</button>' +
        '</div>'
    )
    .join('');
  bar.hidden = false;
  bar.querySelectorAll('[data-dismiss-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const list = getDismissed();
      list.push(btn.getAttribute('data-dismiss-key'));
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(list.slice(-200)));
      } catch (err) {
        /* stockage indisponible : le message reviendra au prochain chargement */
      }
      renderAnnouncements();
    });
  });
}

// --- Annonces : gestion dans l'espace admin ---
function audienceLabel(audience) {
  return t('admin.announce.aud.' + audience);
}

async function loadAdminAnnouncements() {
  const list = document.getElementById('admin-announcements-list');
  const res = await fetch('/api/admin/announcements');
  if (!res.ok) {
    list.innerHTML = '<p class="empty-state">' + t('admin.announce.tableMissing') + '</p>';
    return;
  }
  const { welcome, announcements } = await res.json();
  if (welcome) {
    document.getElementById('welcome-fr').value = welcome.messages.fr;
    document.getElementById('welcome-en').value = welcome.messages.en;
    document.getElementById('welcome-es').value = welcome.messages.es;
  }
  if (announcements.length === 0) {
    list.innerHTML = '<p class="empty-state">' + t('admin.announce.none') + '</p>';
    return;
  }
  list.innerHTML = announcements
    .map(
      (a) =>
        '<div class="admin-row"><div class="who"><span>' + escapeHtml(a.messages.fr) + '</span>' +
        '<span class="sub">' + audienceLabel(a.audience) + ' · ' + t('admin.announce.until').replace('{date}', formatDateTime(a.endsAt)) + '</span></div>' +
        '<button class="del-btn" data-announcement-id="' + a.id + '">' + t('admin.remove') + '</button></div>'
    )
    .join('');
  list.querySelectorAll('[data-announcement-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.announce.confirmRemove'))) return;
      await fetch('/api/admin/announcements/' + btn.getAttribute('data-announcement-id'), { method: 'DELETE' });
      loadAdminAnnouncements();
      loadAnnouncements();
    });
  });
}

document.getElementById('welcome-save-btn').addEventListener('click', async () => {
  const status = document.getElementById('welcome-status');
  status.textContent = '…';
  const res = await fetch('/api/admin/welcome', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageFr: document.getElementById('welcome-fr').value,
      messageEn: document.getElementById('welcome-en').value,
      messageEs: document.getElementById('welcome-es').value,
    }),
  });
  status.textContent = res.ok ? t('admin.announce.welcomeSaved') : t('admin.announce.tableMissing');
});

document.getElementById('announce-publish-btn').addEventListener('click', async () => {
  const status = document.getElementById('announce-status');
  const messageFr = document.getElementById('announce-fr').value.trim();
  if (!messageFr) {
    status.textContent = t('admin.announce.emptyFr');
    return;
  }
  status.textContent = '…';
  const res = await fetch('/api/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messageFr,
      messageEn: document.getElementById('announce-en').value,
      messageEs: document.getElementById('announce-es').value,
      audience: document.getElementById('announce-audience').value,
      durationDays: Number(document.getElementById('announce-duration').value),
    }),
  });
  if (!res.ok) {
    status.textContent = t('admin.announce.tableMissing');
    return;
  }
  ['announce-fr', 'announce-en', 'announce-es'].forEach((id) => (document.getElementById(id).value = ''));
  status.textContent = t('admin.announce.published');
  loadAdminAnnouncements();
  loadAnnouncements();
});

// --- Traduire un message (espace admin) ---
// Ouvre Google Traduction dans un nouvel onglet, avec le texte déjà
// collé : gratuit, sans compte ni clé à configurer.
const TRANSLATE_MAX_LENGTH = 4500; // au-delà, Google coupe le texte
// Phrase ajoutée en français AVANT traduction : Google la traduit avec
// le reste, dans la langue de la personne.
const TRANSLATED_NOTE_FR = "(Ce message a été traduit automatiquement depuis le français. Merci de votre indulgence si certaines tournures sont maladroites.)";

function openGoogleTranslate(text, from, to) {
  const status = document.getElementById('admin-translate-status');
  status.textContent = '';
  if (!text) {
    status.textContent = t('admin.translate.empty');
    return;
  }
  if (text.length > TRANSLATE_MAX_LENGTH) {
    status.textContent = t('admin.translate.tooLong');
    return;
  }
  const url = 'https://translate.google.com/?sl=' + from + '&tl=' + to + '&text=' + encodeURIComponent(text) + '&op=translate';
  window.open(url, '_blank', 'noopener');
}

document.getElementById('admin-translate-in-btn').addEventListener('click', () => {
  openGoogleTranslate(document.getElementById('admin-translate-in').value.trim(), 'auto', 'fr');
});
document.getElementById('admin-translate-out-btn').addEventListener('click', () => {
  let text = document.getElementById('admin-translate-out').value.trim();
  if (text && document.getElementById('admin-translate-note').checked) text += '\n\n' + TRANSLATED_NOTE_FR;
  openGoogleTranslate(text, 'fr', document.getElementById('admin-translate-lang').value);
});

document.getElementById('admin-users-search').addEventListener('input', renderAdminUsers);
document.getElementById('admin-tracks-search').addEventListener('input', renderAdminTracks);

// --- Page artiste publique ---
document.getElementById('back-to-discover').addEventListener('click', () => {
  window.location.hash = '#decouvrir';
});

document.getElementById('contact-artist-btn').addEventListener('click', () => {
  const block = document.getElementById('contact-form-block');
  block.hidden = !block.hidden;
});

document.getElementById('contact-send-btn').addEventListener('click', async () => {
  const status = document.getElementById('contact-status');
  const artistId = document.getElementById('contact-artist-btn').getAttribute('data-artist-id');
  const name = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const message = document.getElementById('contact-message').value.trim();
  if (!email || !message) {
    status.textContent = t('error.missing_fields');
    return;
  }
  status.textContent = '…';
  const res = await fetch('/api/artists/' + artistId + '/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, message }),
  });
  if (!res.ok) {
    status.textContent = t('error.generic');
    return;
  }
  status.textContent = t('contact.sent');
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-email').value = '';
  document.getElementById('contact-message').value = '';
});

async function loadArtistPage(artistId) {
  const res = await fetch('/api/artists/' + artistId + '?' + deviceQS());
  if (!res.ok) {
    window.location.hash = '#decouvrir';
    return;
  }
  const { artist, tracks, followerCount, isFollowing } = await res.json();
  document.title = artist.artistName + ' | Risuona';

  document.getElementById('artist-page-name').textContent = artist.artistName;
  document.getElementById('artist-page-verified').hidden = !artist.identityVerified;
  document.getElementById('artist-page-bio').textContent = artist.bio || '';
  document.getElementById('artist-page-bio').hidden = !artist.bio;

  document.getElementById('contact-form-block').hidden = true;
  document.getElementById('contact-artist-btn').setAttribute('data-artist-id', artistId);
  document.getElementById('contact-form-title').textContent = t('contact.formTitle').replace('{artist}', artist.artistName);

  const banner = document.getElementById('artist-page-banner');
  if (artist.bannerUrl) { banner.src = artist.bannerUrl; banner.hidden = false; } else { banner.hidden = true; }
  const avatar = document.getElementById('artist-page-avatar');
  if (artist.avatarUrl) { avatar.src = artist.avatarUrl; avatar.hidden = false; } else { avatar.hidden = true; }

  const links = [];
  if (artist.soundcloudUrl) links.push(linkPill(artist.soundcloudUrl, t('link.soundcloud')));
  if (artist.instagramUrl) links.push(linkPill(artist.instagramUrl, t('link.instagram')));
  if (artist.sunoUrl) links.push(linkPill(artist.sunoUrl, t('link.suno')));
  if (artist.bandcampUrl) links.push(linkPill(artist.bandcampUrl, t('link.bandcamp')));
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
      const res = await fetch('/api/artists/' + artist.id + '/' + action, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'terms_outdated') {
          showToast(t('cgu.blocksFollow'));
          window.location.hash = '#espace';
          return;
        }
      }
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

const DEFAULT_TITLE = document.title;

function handleRoute() {
  const hash = window.location.hash;
  const path = window.location.pathname;
  // Repli sur l'adresse "normale" (/artiste/123, /morceau/123) quand il n'y
  // a pas de # : c'est le cas d'un chargement direct de cette adresse (lien
  // partagé, moteur de recherche) plutôt que d'un clic dans le site, qui lui
  // continue d'utiliser les adresses en # comme avant. Le # reste toujours
  // prioritaire pour ne rien changer à la navigation interne existante.
  const artistMatch = hash.match(/^#\/artiste\/(\d+)$/) || (!hash && path.match(/^\/artiste\/(\d+)$/));
  const trackMatch = hash.match(/^#\/morceau\/(\d+)$/) || (!hash && path.match(/^\/morceau\/(\d+)$/));
  const pageMatch = hash.match(/^#\/page\/(roadmap|cgu|guide)$/);
  const artistSection = document.getElementById('artiste');
  const trackSection = document.getElementById('morceau');
  const readerSection = document.getElementById('page-reader');
  const mainViews = document.querySelectorAll('.main-view');
  if (pageMatch) {
    mainViews.forEach((el) => (el.hidden = true));
    artistSection.hidden = true;
    trackSection.hidden = true;
    readerSection.hidden = false;
    loadPageReader(pageMatch[1]);
    window.scrollTo(0, 0);
    return;
  }
  readerSection.hidden = true;
  const returnScroll = readerReturnScroll;
  readerReturnScroll = null;
  if (!artistMatch && !trackMatch) document.title = DEFAULT_TITLE;
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
    if (returnScroll !== null) requestAnimationFrame(() => window.scrollTo(0, returnScroll));
  }
}
window.addEventListener('hashchange', handleRoute);

// --- Pages annexes (feuille de route, CGU, guide) lues SANS quitter le site ---
// Avant, cliquer sur "Feuille de route" chargeait une toute nouvelle page :
// le lecteur était détruit et la musique s'arrêtait (et, sur iPhone, elle
// pouvait se retrouver dans un état bizarre au retour). On affiche donc
// désormais le contenu de ces pages à l'intérieur du site : la musique
// continue pendant la lecture.
const READER_PAGES = { roadmap: '/roadmap.html', cgu: '/cgu.html', guide: '/guide.html', guideSacem: '/guide-sacem.html' };
const READER_BY_PATH = { '/roadmap.html': 'roadmap', '/cgu.html': 'cgu', '/guide.html': 'guide', '/guide-sacem.html': 'guideSacem' };
let readerReturnScroll = null;
let readerOpenedInApp = false;

function closePageReader() {
  if (readerOpenedInApp) {
    readerOpenedInApp = false;
    history.back();
  } else {
    window.location.hash = '';
  }
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = new URL(link.getAttribute('href'), window.location.href);
  if (url.origin !== window.location.origin) return;
  const page = READER_BY_PATH[url.pathname];
  if (page) {
    e.preventDefault();
    if (!window.location.hash.startsWith('#/page/')) {
      readerReturnScroll = window.scrollY;
      readerOpenedInApp = true;
    }
    window.location.hash = '#/page/' + page;
  } else if (url.pathname === '/' && !url.hash && link.closest('#page-reader')) {
    // Liens "← Retour à l'accueil" et logo, à l'intérieur de la page lue.
    e.preventDefault();
    closePageReader();
  }
});

async function loadPageReader(name) {
  const reader = document.getElementById('page-reader');
  reader.innerHTML = '<section class="on-paper"><div class="wrap"><p class="empty-state">…</p></div></section>';
  try {
    const res = await fetch(READER_PAGES[name]);
    if (!res.ok) throw new Error('not_found');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const section = doc.querySelector('section');
    if (!section) throw new Error('empty');
    const styles = Array.from(doc.querySelectorAll('style')).map((st) => st.outerHTML).join('');
    reader.innerHTML = styles + section.outerHTML;
    const wrap = reader.querySelector('.wrap');
    if (wrap) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn-back';
      back.textContent = t('reader.back');
      back.addEventListener('click', closePageReader);
      wrap.prepend(back);
    }
    if (doc.title) document.title = doc.title;
  } catch (err) {
    reader.innerHTML = '<section class="on-paper"><div class="wrap"><p class="empty-state">' + t('reader.error') + '</p></div></section>';
  }
}

// Le bouton "Écouter cette page" (page CGU) porte son propre script quand
// cgu.html est ouverte directement, mais ce script ne s'exécute pas quand
// le contenu est injecté par le lecteur interne ci-dessus (innerHTML
// n'exécute pas les <script>). On gère donc aussi le clic ici, par
// délégation, pour que le bouton fonctionne dans les deux cas.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#cguListenBtn');
  if (!btn || typeof window.speechSynthesis === 'undefined') return;
  const label = btn.querySelector('.cgu-listen-label');
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (label) label.textContent = 'Écouter cette page';
    return;
  }
  const body = document.querySelector('#page-reader .legal-body');
  if (!body) return;
  const utter = new SpeechSynthesisUtterance(body.innerText);
  utter.lang = 'fr-FR';
  utter.onend = () => { if (label) label.textContent = 'Écouter cette page'; };
  window.speechSynthesis.speak(utter);
  if (label) label.textContent = 'Pause';
});

document.getElementById('back-to-discover-from-track').addEventListener('click', () => {
  window.location.hash = '';
});

async function loadTrackPage(trackId) {
  const container = document.getElementById('track-page-content');
  const moreContainer = document.getElementById('track-page-more');
  container.innerHTML = '';
  moreContainer.innerHTML = '';
  const res = await fetch('/api/tracks/' + trackId + '?' + deviceQS());
  if (!res.ok) {
    container.innerHTML = '<div class="empty-state">' + t('track.notFound') + '</div>';
    return;
  }
  const { track } = await res.json();
  container.innerHTML = renderTrackCard(track);
  loadComments(track.id, track.userId);
  // La liste de lecture de cette page doit contenir tout le catalogue
  // (pas seulement ce morceau), sinon la lecture s'arrête à la fin du
  // morceau au lieu d'enchaîner sur le suivant, et le bouton "aléatoire"
  // du lecteur dédié n'a plus le même effet ici.
  currentDiscoverQueue = ALL_TRACKS.length ? ALL_TRACKS : [track];
  document.title = track.title + ' · ' + track.artistName + ' | Risuona';

  // "Plus de cet artiste" — quelques autres morceaux, pour continuer la découverte
  const artistRes = await fetch('/api/artists/' + track.userId + '?' + deviceQS());
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
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // Une nouvelle version vient d'être installée en arrière-plan : on
      // prévient la personne au lieu de rester muet comme avant. La
      // présence de navigator.serviceWorker.controller distingue une vraie
      // mise à jour de la toute première installation (rien à annoncer).
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    }).catch(() => {});
  });

  // Dès que la nouvelle version prend la main (juste après l'installation,
  // le service worker l'active tout de suite), on recharge la page pour
  // qu'elle s'applique - en laissant au message de mise à jour un minimum
  // de temps à l'écran pour qu'il soit bien visible.
  let swReloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloading) return;
    swReloading = true;
    showUpdateBanner();
    setTimeout(() => window.location.reload(), 600);
  });
}

// --- Notifications push (nouveaux morceaux des artistes suivis) ---
// Reste totalement invisible tant que le serveur n'a pas de clés VAPID
// configurées (voir GET /api/push/vapid-public-key) : rien à retirer ici
// le jour où on les ajoute, le bouton apparaît de lui-même.
let pushUIBound = false;
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function initPushUI() {
  const panel = document.getElementById('push-panel');
  const btn = document.getElementById('push-enable-btn');
  const status = document.getElementById('push-status');
  if (!panel || !btn) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    panel.hidden = true;
    return;
  }
  let publicKey;
  try {
    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) {
      panel.hidden = true;
      return;
    }
    ({ publicKey } = await keyRes.json());
  } catch (err) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  setPushButtonState(btn, status, !!existing);

  if (pushUIBound) return;
  pushUIBound = true;
  btn.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready;
    if (btn.dataset.state === 'subscribed') {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
        } catch (err) {
          // Silencieux.
        }
        await sub.unsubscribe();
      }
      setPushButtonState(btn, status, false);
      return;
    }
    if (Notification.permission === 'denied') {
      status.textContent = t('push.denied');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      status.textContent = t('push.denied');
      return;
    }
    try {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub }),
      });
      setPushButtonState(btn, status, true);
    } catch (err) {
      status.textContent = t('push.error');
    }
  });
}

function setPushButtonState(btn, status, subscribed) {
  btn.dataset.state = subscribed ? 'subscribed' : 'unsubscribed';
  btn.textContent = subscribed ? t('push.disable') : t('push.enable');
  status.textContent = subscribed ? t('push.activeHint') : '';
}

function showUpdateBanner() {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(showToast._timer);
  el.innerHTML = '<span class="update-spinner" aria-hidden="true"></span>' + escapeHtml(t('pwa.updating'));
  el.classList.add('show');
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
// `replacements` (optionnel) : ex. { artist: "Nom" } remplace {artist} dans
// le texte traduit — même convention que {n}, {title} ailleurs dans ce fichier.
async function shareUrl(url, textKey, replacements) {
  let text = t(textKey || 'nav.shareText');
  if (replacements) {
    Object.keys(replacements).forEach((key) => {
      text = text.replace('{' + key + '}', replacements[key]);
    });
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Risuona', text, url });
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

document.getElementById('cgu-accept-btn').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  const res = await fetch('/api/me/accept-terms', { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    currentUser = data.user;
    refreshOnboarding();
    showToast('✓');
  }
  btn.disabled = false;
});

document.getElementById('share-page-btn').addEventListener('click', () => shareUrl(window.location.href));

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.share-track-btn');
  if (btn) shareUrl(btn.getAttribute('data-share-url'), 'nav.shareTrackText', { artist: btn.getAttribute('data-share-artist') });
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

// Petite étincelle (rond qui s'étend + points qui s'écartent, tout
// disparaît en fondu) au moment où on aime un morceau. Générée en JS et
// retirée du DOM après l'animation, pour ne pas alourdir le HTML de
// chaque carte morceau en permanence.
function sparkleLike(btn) {
  const wrap = document.createElement('span');
  wrap.className = 'like-spark-wrap';
  const ring = document.createElement('span');
  ring.className = 'like-spark-ring';
  wrap.appendChild(ring);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count;
    const dot = document.createElement('span');
    dot.className = 'like-spark-dot';
    dot.style.setProperty('--tx', Math.round(Math.cos(angle) * 19) + 'px');
    dot.style.setProperty('--ty', Math.round(Math.sin(angle) * 19) + 'px');
    wrap.appendChild(dot);
  }
  btn.appendChild(wrap);
  setTimeout(() => wrap.remove(), 550);
}

// "J'aime" : fonctionne pour un visiteur non connecté (identifiant
// d'appareil) comme pour un compte connecté (fan ou artiste, y compris sur
// ses propres morceaux ou ceux d'un autre artiste) — aucune restriction de
// type de compte, contrairement à d'autres actions du site.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.like-track-btn');
  if (!btn) return;
  btn.disabled = true;
  const trackId = btn.getAttribute('data-track-id');
  const alreadyLiked = btn.getAttribute('data-liked') === 'true';
  const action = alreadyLiked ? 'unlike' : 'like';
  try {
    const res = await fetch('/api/tracks/' + trackId + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
    if (!res.ok) {
      showToast(t('error.generic'));
      return;
    }
    const data = await res.json();
    document.querySelectorAll('.like-track-btn[data-track-id="' + trackId + '"]').forEach((el) => {
      el.setAttribute('data-liked', data.liked ? 'true' : 'false');
      el.setAttribute('aria-pressed', data.liked ? 'true' : 'false');
      el.classList.toggle('liked', !!data.liked);
      el.innerHTML = (data.liked ? '❤️' : '🤍') + ' <span class="like-count">' + (data.likeCount || 0) + '</span>';
    });
    // Petit effet visuel (étincelle) uniquement quand on AJOUTE un like,
    // pas quand on le retire, et seulement sur le bouton cliqué (pas ses
    // éventuels doublons ailleurs sur la page).
    if (data.liked) sparkleLike(btn);
    // Confirmation silencieuse pour les lecteurs d'écran (le cœur qui change
    // et l'étincelle ne sont pas perçus sans la vue) : n'affiche rien à
    // l'écran, contrairement au toast général du site.
    const announcer = document.getElementById('like-announcer');
    if (announcer) announcer.textContent = t(data.liked ? 'track.likedAnnounce' : 'track.unlikedAnnounce');
  } finally {
    btn.disabled = false;
  }
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

function playTrackById(id, audioUrl, title, artist, artistId, coverUrl, coverFallback, queue) {
  currentQueueRef = queue || currentDiscoverQueue;
  currentTrackId = id;
  globalAudio.src = audioUrl;
  globalAudio.play().catch(() => {});
  saveRecentListen({ id, title, artistName: artist, artistId, coverUrl });
  if (!coverUrl) coverUrl = fallbackCoverUrl(title, artist);

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
  document.body.classList.add('has-player');
  updateMediaSession(title, artist, coverUrl);
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
    btn.getAttribute('data-artist-id'),
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

// --- Raccourci clavier : barre espace = lecture/pause ---
// Ignoré quand on est en train de taper dans un champ (texte, zone de
// texte, menu déroulant), pour ne jamais interrompre une saisie.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable)) return;
  if (!currentTrackId) return;
  e.preventDefault();
  if (globalAudio.paused) globalAudio.play().catch(() => {});
  else globalAudio.pause();
  refreshPlayButtons();
});

document.getElementById('player-close').addEventListener('click', () => {
  globalAudio.pause();
  globalAudio.src = '';
  currentTrackId = null;
  playerBar.hidden = true;
  document.body.classList.remove('has-player');
  refreshPlayButtons();
});

globalAudio.addEventListener('play', () => {
  refreshPlayButtons();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
globalAudio.addEventListener('pause', () => {
  refreshPlayButtons();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});

// --- Déclarer Risuona comme un vrai lecteur de musique au téléphone ---
// (Media Session). C'est ce qui permet à iPhone et Android de :
//  - mettre la musique en pause proprement quand autre chose prend le son
//    (micro de dictée, appel, autre appli), au lieu de la couper en silence
//    pendant qu'elle continue de défiler ;
//  - afficher titre, artiste, pochette et les boutons ⏯ ⏭ ⏮ sur l'écran
//    de verrouillage et dans le centre de contrôle, pour relancer la
//    lecture sans rouvrir l'appli.
function updateMediaSession(title, artist, coverUrl) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || '',
      artist: artist || '',
      album: 'Risuona',
      artwork: [{ src: coverUrl || '/icons/icon-512.png', sizes: '512x512' }],
    });
  } catch (err) {
    /* navigateur ancien : sans conséquence */
  }
}

function playNeighbour(offset) {
  const idx = currentQueueRef.findIndex((tr) => tr.id === currentTrackId);
  const target = idx > -1 ? currentQueueRef[idx + offset] : null;
  if (!target) return;
  playTrackById(target.id, target.audioUrl, target.title, target.artistName, target.userId, target.coverUrl, (target.title || '?').trim().charAt(0).toUpperCase(), currentQueueRef);
}

if ('mediaSession' in navigator) {
  const setHandler = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (err) {
      /* action non prise en charge sur cet appareil */
    }
  };
  setHandler('play', () => globalAudio.play().catch(() => {}));
  setHandler('pause', () => globalAudio.pause());
  setHandler('nexttrack', () => playNeighbour(1));
  setHandler('previoustrack', () => {
    if (globalAudio.currentTime > 3) globalAudio.currentTime = 0;
    else playNeighbour(-1);
  });
  setHandler('seekto', (details) => {
    if (details && typeof details.seekTime === 'number') globalAudio.currentTime = details.seekTime;
  });
}

// Sur les iPhone récents, Safari signale en plus quand le son est
// "interrompu" (micro, appel...). Quand ce signal existe, on met en
// pause au bon endroit, puis on relance quand l'interruption se termine.
// Sur les appareils qui ne le proposent pas, ce bloc ne fait rien.
let pausedByInterruption = false;
let interruptedAt = null; // { trackId, time } : où en était la chanson
if (navigator.audioSession) {
  try {
    navigator.audioSession.type = 'playback';
  } catch (err) {
    /* non pris en charge */
  }
  try {
    navigator.audioSession.addEventListener('statechange', () => {
      const state = navigator.audioSession.state;
      if (state === 'interrupted') {
        if (!globalAudio.paused) {
          pausedByInterruption = true;
          interruptedAt = { trackId: currentTrackId, time: globalAudio.currentTime };
          globalAudio.pause();
        }
      } else if (pausedByInterruption) {
        pausedByInterruption = false;
        // Petit délai : laisse au téléphone le temps de rendre le son.
        setTimeout(() => {
          if (navigator.audioSession.state === 'interrupted') return;
          // Si la chanson a continué de défiler en silence, on revient
          // exactement là où elle en était au moment de l'interruption.
          if (interruptedAt && interruptedAt.trackId === currentTrackId) globalAudio.currentTime = interruptedAt.time;
          interruptedAt = null;
          globalAudio.play().catch(() => {});
        }, 800);
      }
    });
  } catch (err) {
    /* non pris en charge */
  }
}

// Retour sur une page restaurée depuis le cache du navigateur : on
// resynchronise l'affichage du lecteur avec son état réel.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) refreshPlayButtons();
});

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
    playTrackById(next.id, next.audioUrl, next.title, next.artistName, next.userId, next.coverUrl, (next.title || '?').trim().charAt(0).toUpperCase(), currentQueueRef);
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
  recent.unshift({ id: track.id, title: track.title, artistName: track.artistName, artistId: track.artistId || '', coverUrl: track.coverUrl || '' });
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
        '<div class="recent-listen-item">' +
        '<button type="button" class="recent-listen-play" data-track-id="' + r.id + '">' +
        (r.coverUrl || fallbackCoverUrl(r.title, r.artistName)
          ? '<img class="recent-listen-cover" src="' + escapeHtml(r.coverUrl || fallbackCoverUrl(r.title, r.artistName)) + '" alt="">'
          : '<div class="recent-listen-cover-fallback">' + escapeHtml((r.title || '?').trim().charAt(0).toUpperCase()) + '</div>') +
        '<div class="recent-listen-title">' + escapeHtml(r.title) + '</div>' +
        '</button>' +
        (r.artistId
          ? '<a class="recent-listen-artist artist-name-link" href="#/artiste/' + r.artistId + '">' + escapeHtml(r.artistName) + '</a>'
          : '<div class="recent-listen-artist">' + escapeHtml(r.artistName) + '</div>') +
        '</div>'
    )
    .join('');
}

document.getElementById('recent-listens-strip').addEventListener('click', (e) => {
  const btn = e.target.closest('.recent-listen-play');
  if (!btn) return;
  const id = Number(btn.getAttribute('data-track-id'));
  const track = ALL_TRACKS.find((t) => t.id === id);
  if (track) {
    playTrackById(track.id, track.audioUrl, track.title, track.artistName, track.userId, track.coverUrl, (track.title || '?').trim().charAt(0).toUpperCase(), currentDiscoverQueue);
  } else {
    // Le morceau n'est plus dans le fil actuellement chargé (site
    // rechargé) : on va chercher ses infos avant de le lancer.
    fetch('/api/tracks/' + id)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.track) {
          playTrackById(data.track.id, data.track.audioUrl, data.track.title, data.track.artistName, data.track.userId, data.track.coverUrl, (data.track.title || '?').trim().charAt(0).toUpperCase(), [data.track]);
        }
      });
  }
});

document.getElementById('shuffle-play-btn').addEventListener('click', () => {
  if (ALL_TRACKS.length === 0) return;
  const pick = ALL_TRACKS[Math.floor(Math.random() * ALL_TRACKS.length)];
  playTrackById(pick.id, pick.audioUrl, pick.title, pick.artistName, pick.userId, pick.coverUrl, (pick.title || '?').trim().charAt(0).toUpperCase(), ALL_TRACKS);
});

document.getElementById('artist-shuffle-play-btn').addEventListener('click', () => {
  if (currentArtistQueue.length === 0) return;
  const pick = currentArtistQueue[Math.floor(Math.random() * currentArtistQueue.length)];
  playTrackById(pick.id, pick.audioUrl, pick.title, pick.artistName, pick.userId, pick.coverUrl, (pick.title || '?').trim().charAt(0).toUpperCase(), currentArtistQueue);
});

// --- Init ---
(async function init() {
  // Confirmation d'e-mail : le lien envoyé par e-mail revient sur
  // #espace?verified=1 (ou 0 en cas d'échec) — on le détecte avant de
  // nettoyer l'ancre, puis on informe la personne une fois chargé.
  const verifiedMatch = window.location.hash.match(/[?&]verified=(\d)/);
  const verifiedResult = verifiedMatch ? verifiedMatch[1] : null;

  // Lien "mot de passe oublié" reçu par e-mail : revient sur
  // #espace?resetToken=... — on affiche directement le formulaire de
  // nouveau mot de passe, même si un ancien compte est encore connecté
  // dans ce navigateur (updateAuthUI() masque normalement auth-block
  // pour une personne connectée, donc on le force ici explicitement).
  const resetTokenMatch = window.location.hash.match(/[?&]resetToken=([^&]+)/);
  if (resetTokenMatch) {
    RESET_PASSWORD_TOKEN = decodeURIComponent(resetTokenMatch[1]);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Si l'adresse garde une ancienne ancre (#decouvrir, etc.) sans être une
  // vraie page artiste, on revient en haut plutôt que de suivre le saut
  // automatique du navigateur vers cette section.
  if (window.location.hash && !window.location.hash.match(/^#\/artiste\/\d+$/) && !window.location.hash.match(/^#\/morceau\/\d+$/) && !window.location.hash.match(/^#\/page\/(roadmap|cgu|guide)$/)) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  await loadLang(CURRENT_LANG);
  await refreshMe();
  if (RESET_PASSWORD_TOKEN) {
    document.getElementById('auth-block').hidden = false;
    document.getElementById('dashboard-block').hidden = true;
    document.getElementById('login-form-wrap').hidden = true;
    document.getElementById('signup-form-wrap').hidden = true;
    document.getElementById('forgot-password-wrap').hidden = true;
    document.getElementById('reset-password-wrap').hidden = false;
  }
  await loadFeed();
  renderRecentListens();
  handleRoute();
  window.scrollTo(0, 0);
  if (verifiedResult === '1') showToast(t('verify.success'));
  else if (verifiedResult === '0') showToast(t('verify.failed'));
})();
