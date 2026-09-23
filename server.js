require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const supabase = require('./supabaseClient');
const crypto = require('crypto');
const labelgrid = require('./labelgrid');
const stripeClient = require('./stripeClient');
const soundcloudClient = require('./soundcloudClient');
const resendClient = require('./resendClient');
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-.env';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

// --- Config upload (audio, pochettes, avatars, bannières) ---
// Les fichiers sont stockés sur Supabase Storage (bucket "media"),
// permanent — contrairement à un dossier local sur Render, qui peut être
// effacé à chaque redéploiement.
const STORAGE_BUCKET = 'media';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 Mo par fichier
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'cover' || file.fieldname === 'avatar' || file.fieldname === 'banner') {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Ce champ attend une image.'));
      }
      return cb(null, true);
    }
    if (!file.mimetype.startsWith('audio/')) {
      return cb(new Error('Seuls les fichiers audio sont acceptés.'));
    }
    cb(null, true);
  },
});

async function uploadToStorage(file) {
  const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(safe, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(safe);
  return data.publicUrl;
}

function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = '/' + STORAGE_BUCKET + '/';
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

async function removeFromStorage(url) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  await supabase.storage.from(STORAGE_BUCKET).remove([path]);
}

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: true,
    },
  })
);

// Comptes exemptés des deux limites ci-dessous (les tiennes) — utile
// pour ne jamais te bloquer toi-même en pleine session de travail,
// pendant que la protection reste stricte pour tout le monde d'autre.
const RATE_LIMIT_EXEMPT_EMAILS = (process.env.RATE_LIMIT_EXEMPT_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
function isExemptFromRateLimit(req) {
  const email = req.body && req.body.email ? req.body.email.toLowerCase() : '';
  return RATE_LIMIT_EXEMPT_EMAILS.includes(email);
}

// Limite les tentatives de connexion/inscription en rafale (protection
// contre les essais automatisés de mots de passe) — 8 essais par
// demi-heure et par adresse IP, tous comptes confondus.
const authLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
  skip: isExemptFromRateLimit,
});

// Deuxième protection, cette fois basée sur le COMPTE visé (son
// e-mail) plutôt que sur l'origine de la tentative (son adresse IP).
// Indispensable en plus de authLimiter : sans ça, quelqu'un pourrait
// contourner la limite par IP simplement en changeant de réseau
// (Wi-Fi, données mobiles...) tout en continuant de viser le même
// compte. Avec les deux limites actives, le compte ciblé reste
// protégé quel que soit le réseau utilisé pour l'attaquer.
const loginEmailLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body && req.body.email ? req.body.email.toLowerCase() : 'unknown'),
  message: { error: 'too_many_attempts' },
  skip: isExemptFromRateLimit,
});

// Limite plus large pour les écoutes/signalements publics — évite qu'un
// script gonfle artificiellement les statistiques d'écoute ou inonde
// les signalements, sans gêner de vrais visiteurs.
const publicActionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_authenticated' });
  const { data: user } = await supabase.from('users').select('role').eq('id', req.session.userId).single();
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    artistName: u.artist_name,
    email: u.email,
    emailVerified: u.email_verified === true || !resendClient.isConfigured(),
    exportExpiresAt: u.export_expires_at || null,
    bio: u.bio,
    donationLink: u.donation_link,
    spotifyUrl: u.spotify_url,
    appleUrl: u.apple_url,
    soundcloudUrl: u.soundcloud_url,
    instagramUrl: u.instagram_url,
    sunoUrl: u.suno_url || '',
    avatarUrl: u.avatar_url || '',
    bannerUrl: u.banner_url || '',
    role: u.role,
    accountType: u.account_type || 'artist',
    followingIds: u.following_ids || [],
  };
}

// Comme publicUser, mais sans l'e-mail — pour tout ce qu'un visiteur
// non connecté peut voir (page artiste, "Découvrir"...). L'e-mail ne
// doit apparaître que pour la personne elle-même (son propre compte)
// ou pour l'administratrice.
function publicArtist(u) {
  const full = publicUser(u);
  if (!full) return null;
  const { email, ...rest } = full;
  return rest;
}

function mapTrack(t, artistName) {
  return {
    id: t.id,
    userId: t.user_id,
    title: t.title,
    genre: t.genre,
    aiLyrics: !!t.ai_lyrics,
    aiMusic: !!t.ai_music,
    aiVocals: !!t.ai_vocals,
    aiTool: t.ai_tool,
    audioUrl: t.audio_url,
    coverUrl: t.cover_url || '',
    collaborators: t.collaborators || '',
    genesis: t.genesis || '',
    explicit: !!t.explicit,
    spotifyUrl: t.spotify_url || '',
    appleUrl: t.apple_url || '',
    plays: t.plays || 0,
    distribution: t.distribution,
    createdAt: Number(t.created_at),
    artistName,
  };
}

// --- Auth ---
app.post('/api/signup', authLimiter, async (req, res) => {
  const { artistName, email, password, acceptedTerms, accountType } = req.body;
  if (!artistName || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (!acceptedTerms) return res.status(400).json({ error: 'terms_not_accepted' });

  const { data: existing } = await supabase.from('users').select('id').ilike('email', email).maybeSingle();
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'artist';
  const verificationToken = crypto.randomBytes(24).toString('hex');

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      artist_name: artistName,
      email,
      password_hash: passwordHash,
      role,
      account_type: accountType === 'fan' ? 'fan' : 'artist',
      email_verified: false,
      verification_token: verificationToken,
      created_at: Date.now(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  req.session.userId = user.id;
  if (role === 'artist') {
    resendClient.notifyNewSignup(artistName, email);
    const siteUrl = req.headers.origin || 'https://' + req.headers.host;
    resendClient.sendVerificationEmail(email, artistName, verificationToken, siteUrl);
  }
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/login', authLimiter, loginEmailLimiter, async (req, res) => {
  const { email, password } = req.body;
  const { data: user } = await supabase.from('users').select('*').ilike('email', email || '').maybeSingle();
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Un compte "juste fan" peut décider à tout moment de devenir un
// compte artiste complet — jamais l'inverse (pour éviter de perdre
// l'accès à des morceaux déjà publiés par erreur).
app.post('/api/me/upgrade-to-artist', requireAuth, async (req, res) => {
  await supabase.from('users').update({ account_type: 'artist' }).eq('id', req.session.userId);
  const { data: user } = await supabase.from('users').select('*').eq('id', req.session.userId).single();
  res.json({ ok: true, user: publicUser(user) });
});

// Lien cliqué depuis l'e-mail de confirmation.
app.get('/api/verify-email', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/#espace?verified=0');
  const { data: user } = await supabase.from('users').select('id').eq('verification_token', token).maybeSingle();
  if (!user) return res.redirect('/#espace?verified=0');
  await supabase.from('users').update({ email_verified: true, verification_token: null }).eq('id', user.id);
  res.redirect('/#espace?verified=1');
});

app.post('/api/resend-verification', requireAuth, authLimiter, async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.session.userId).maybeSingle();
  if (!user || user.email_verified) return res.json({ ok: true });
  const token = user.verification_token || crypto.randomBytes(24).toString('hex');
  if (!user.verification_token) await supabase.from('users').update({ verification_token: token }).eq('id', user.id);
  const siteUrl = req.headers.origin || 'https://' + req.headers.host;
  resendClient.sendVerificationEmail(user.email, user.artist_name, token, siteUrl);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const { data: user } = await supabase.from('users').select('*').eq('id', req.session.userId).maybeSingle();
  res.json({ user: publicUser(user) });
});

app.put(
  '/api/me',
  requireAuth,
  upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'banner', maxCount: 1 }]),
  async (req, res) => {
    const { data: current } = await supabase.from('users').select('avatar_url, banner_url').eq('id', req.session.userId).single();

    const fields = {
      artist_name: req.body.artistName,
      bio: req.body.bio,
      donation_link: req.body.donationLink,
      spotify_url: req.body.spotifyUrl,
      apple_url: req.body.appleUrl,
      soundcloud_url: req.body.soundcloudUrl,
      instagram_url: req.body.instagramUrl,
      suno_url: req.body.sunoUrl,
    };
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

    const avatarFile = req.files && req.files.avatar && req.files.avatar[0];
    if (avatarFile) {
      fields.avatar_url = await uploadToStorage(avatarFile);
      if (current && current.avatar_url) removeFromStorage(current.avatar_url);
    }
    const bannerFile = req.files && req.files.banner && req.files.banner[0];
    if (bannerFile) {
      fields.banner_url = await uploadToStorage(bannerFile);
      if (current && current.banner_url) removeFromStorage(current.banner_url);
    }

    const { data: user, error } = await supabase.from('users').update(fields).eq('id', req.session.userId).select().single();
    if (error) return res.status(500).json({ error: 'server_error', message: error.message });
    res.json({ ok: true, user: publicUser(user) });
  }
);

// --- Morceaux ---
app.get('/api/tracks', async (req, res) => {
  const { data: tracks } = await supabase.from('tracks').select('*').order('created_at', { ascending: false }).limit(200);
  const userIds = [...new Set((tracks || []).map((t) => t.user_id))];
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, artist_name, donation_link, spotify_url, apple_url, soundcloud_url, instagram_url, suno_url').in('id', userIds)
    : { data: [] };
  const byId = Object.fromEntries((users || []).map((u) => [u.id, u]));

  const enriched = (tracks || []).map((t) => {
    const u = byId[t.user_id];
    return {
      ...mapTrack(t, u ? u.artist_name : 'Artiste supprimé'),
      donationLink: u ? u.donation_link : '',
      soundcloudUrl: u ? u.soundcloud_url : '',
      instagramUrl: u ? u.instagram_url : '',
      sunoUrl: u ? u.suno_url : '',
    };
  });
  res.json({ tracks: enriched });
});

app.get('/api/me/tracks', requireAuth, async (req, res) => {
  const { data: me } = await supabase.from('users').select('artist_name').eq('id', req.session.userId).single();
  const { data: tracks } = await supabase
    .from('tracks')
    .select('*')
    .eq('user_id', req.session.userId)
    .order('created_at', { ascending: false });
  res.json({ tracks: (tracks || []).map((t) => mapTrack(t, me ? me.artist_name : '')) });
});

app.post('/api/tracks', requireAuth, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
  const { title, genre, aiLyrics, aiMusic, aiVocals, aiTool, collaborators, genesis, explicit, spotifyUrl, appleUrl } = req.body;
  const audioFile = req.files && req.files.audio && req.files.audio[0];
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  if (!title || !audioFile) return res.status(400).json({ error: 'missing_fields' });

  const { data: meAccount } = await supabase.from('users').select('account_type').eq('id', req.session.userId).single();
  if (meAccount && meAccount.account_type === 'fan') {
    return res.status(403).json({ error: 'fan_account' });
  }

  // Un premier morceau est autorisé sans confirmation d'e-mail (pour ne
  // pas bloquer la découverte du site), mais le suivant exige que
  // l'adresse ait bien été confirmée — évite qu'un compte créé avec
  // une adresse qui n'appartient pas vraiment à la personne publie en
  // continu.
  if (resendClient.isConfigured()) {
    const { data: me } = await supabase.from('users').select('email_verified').eq('id', req.session.userId).single();
    const { count: existingCount } = await supabase
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.session.userId);
    if (!me.email_verified && (existingCount || 0) >= 1) {
      return res.status(403).json({ error: 'email_not_verified' });
    }
  }

  const audioUrl = await uploadToStorage(audioFile);
  const coverUrl = coverFile ? await uploadToStorage(coverFile) : '';

  const { data: track, error } = await supabase
    .from('tracks')
    .insert({
      user_id: req.session.userId,
      title,
      genre: genre || '',
      ai_lyrics: aiLyrics === 'true' || aiLyrics === true,
      ai_music: aiMusic === 'true' || aiMusic === true,
      ai_vocals: aiVocals === 'true' || aiVocals === true,
      ai_tool: aiTool || '',
      audio_url: audioUrl,
      cover_url: coverUrl,
      collaborators: collaborators || '',
      genesis: genesis || '',
      explicit: explicit === 'true' || explicit === true,
      spotify_url: spotifyUrl || '',
      apple_url: appleUrl || '',
      created_at: Date.now(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  res.json({ ok: true, track: mapTrack(track) });
});

app.put('/api/tracks/:id', requireAuth, upload.fields([{ name: 'cover', maxCount: 1 }]), async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).eq('user_id', req.session.userId).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });

  const fields = {};
  if (req.body.title !== undefined) fields.title = req.body.title;
  if (req.body.genre !== undefined) fields.genre = req.body.genre;
  if (req.body.aiLyrics !== undefined) fields.ai_lyrics = req.body.aiLyrics === 'true' || req.body.aiLyrics === true;
  if (req.body.aiMusic !== undefined) fields.ai_music = req.body.aiMusic === 'true' || req.body.aiMusic === true;
  if (req.body.aiVocals !== undefined) fields.ai_vocals = req.body.aiVocals === 'true' || req.body.aiVocals === true;
  if (req.body.aiTool !== undefined) fields.ai_tool = req.body.aiTool;
  if (req.body.collaborators !== undefined) fields.collaborators = req.body.collaborators;
  if (req.body.genesis !== undefined) fields.genesis = req.body.genesis;
  if (req.body.explicit !== undefined) fields.explicit = req.body.explicit === 'true' || req.body.explicit === true;
  if (req.body.spotifyUrl !== undefined) fields.spotify_url = req.body.spotifyUrl;
  if (req.body.appleUrl !== undefined) fields.apple_url = req.body.appleUrl;

  const coverFile = req.files && req.files.cover && req.files.cover[0];
  if (coverFile) {
    fields.cover_url = await uploadToStorage(coverFile);
    if (track.cover_url) removeFromStorage(track.cover_url);
  }

  const { data: updated, error } = await supabase.from('tracks').update(fields).eq('id', track.id).select().single();
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  res.json({ ok: true, track: mapTrack(updated) });
});

// Enregistre une écoute réelle (déclenchée côté client après quelques
// secondes de lecture, pas juste un clic) — accessible sans compte,
// puisque n'importe quel visiteur peut écouter.
app.post('/api/tracks/:id/register-play', publicActionLimiter, async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('plays').eq('id', req.params.id).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  await supabase.from('tracks').update({ plays: (track.plays || 0) + 1 }).eq('id', req.params.id);
  res.json({ ok: true });
});

// --- Signalement d'un morceau (accessible à n'importe quel visiteur) ---
app.post('/api/tracks/:id/report', publicActionLimiter, async (req, res) => {
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'missing_reason' });
  const { data: track } = await supabase.from('tracks').select('id, title, user_id').eq('id', req.params.id).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  const { error } = await supabase.from('reports').insert({
    track_id: track.id,
    reason: reason.trim(),
    resolved: false,
    created_at: Date.now(),
  });
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  res.json({ ok: true });
});

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  const { data: reports } = await supabase.from('reports').select('*').eq('resolved', false).order('created_at', { ascending: false });
  const trackIds = [...new Set((reports || []).map((r) => r.track_id))];
  const { data: tracks } = trackIds.length ? await supabase.from('tracks').select('id, title, user_id').in('id', trackIds) : { data: [] };
  const userIds = [...new Set((tracks || []).map((t) => t.user_id))];
  const { data: users } = userIds.length ? await supabase.from('users').select('id, artist_name').in('id', userIds) : { data: [] };
  const trackById = Object.fromEntries((tracks || []).map((t) => [t.id, t]));
  const userById = Object.fromEntries((users || []).map((u) => [u.id, u]));

  res.json({
    reports: (reports || []).map((r) => {
      const track = trackById[r.track_id];
      const artist = track ? userById[track.user_id] : null;
      return {
        id: r.id,
        trackId: r.track_id,
        trackTitle: track ? track.title : 'Morceau supprimé',
        artistName: artist ? artist.artist_name : '',
        reason: r.reason,
        createdAt: r.created_at,
      };
    }),
  });
});

app.post('/api/admin/reports/:id/resolve', requireAdmin, async (req, res) => {
  await supabase.from('reports').update({ resolved: true }).eq('id', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/tracks/:id', requireAuth, async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).eq('user_id', req.session.userId).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  await supabase.from('tracks').delete().eq('id', track.id);
  removeFromStorage(track.audio_url);
  if (track.cover_url) removeFromStorage(track.cover_url);
  res.json({ ok: true });
});

// --- Pages artiste publiques + suivi ---
app.get('/api/tracks/:id', async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  const { data: artist } = await supabase.from('users').select('*').eq('id', track.user_id).maybeSingle();
  if (!artist) return res.status(404).json({ error: 'not_found' });

  res.json({
    track: {
      ...mapTrack(track, artist.artist_name),
      donationLink: artist.donation_link,
      soundcloudUrl: artist.soundcloud_url,
      instagramUrl: artist.instagram_url,
      sunoUrl: artist.suno_url,
    },
  });
});

app.get('/api/artists/:id', async (req, res) => {
  const artistId = Number(req.params.id);
  const { data: artist } = await supabase.from('users').select('*').eq('id', artistId).maybeSingle();
  if (!artist) return res.status(404).json({ error: 'not_found' });

  const { data: tracks } = await supabase
    .from('tracks')
    .select('*')
    .eq('user_id', artistId)
    .order('created_at', { ascending: false });

  const { data: allUsers } = await supabase.from('users').select('id, following_ids');
  const followerCount = (allUsers || []).filter((u) => (u.following_ids || []).includes(artistId)).length;
  const me = req.session.userId ? (allUsers || []).find((u) => u.id === req.session.userId) : null;
  const isFollowing = !!(me && (me.following_ids || []).includes(artistId));

  res.json({
    artist: publicArtist(artist),
    tracks: (tracks || []).map((t) => ({
      ...mapTrack(t, artist.artist_name),
      donationLink: artist.donation_link,
      soundcloudUrl: artist.soundcloud_url,
      instagramUrl: artist.instagram_url,
      sunoUrl: artist.suno_url,
    })),
    followerCount,
    isFollowing,
  });
});

app.post('/api/artists/:id/follow', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.session.userId) return res.status(400).json({ error: 'cannot_follow_self' });
  const { data: me } = await supabase.from('users').select('following_ids').eq('id', req.session.userId).single();
  const followingIds = me.following_ids || [];
  if (!followingIds.includes(targetId)) followingIds.push(targetId);
  await supabase.from('users').update({ following_ids: followingIds }).eq('id', req.session.userId);
  res.json({ ok: true });
});

app.post('/api/artists/:id/unfollow', requireAuth, async (req, res) => {
  const targetId = Number(req.params.id);
  const { data: me } = await supabase.from('users').select('following_ids').eq('id', req.session.userId).single();
  const followingIds = (me.following_ids || []).filter((id) => id !== targetId);
  await supabase.from('users').update({ following_ids: followingIds }).eq('id', req.session.userId);
  res.json({ ok: true });
});

// --- Distribution externe (Spotify, Apple Music…) via LabelGrid ---
app.get('/api/distribution/status', (req, res) => {
  res.json({ configured: labelgrid.isConfigured() });
});

app.post('/api/tracks/:id/distribute', requireAuth, async (req, res) => {
  if (!labelgrid.isConfigured()) return res.status(503).json({ error: 'not_configured' });
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).eq('user_id', req.session.userId).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  const { data: artist } = await supabase.from('users').select('artist_name').eq('id', req.session.userId).single();

  try {
    const lgArtist = await labelgrid.ensureArtist({ name: artist.artist_name });
    const release = await labelgrid.createRelease({
      title: track.title,
      artistId: lgArtist.id,
      releaseDate: new Date().toISOString().slice(0, 10),
    });
    await labelgrid.uploadTrackAudio({
      releaseId: release.id,
      title: track.title,
      audioUrl: track.audio_url,
    });
    await labelgrid.submitForDistribution(release.id);

    const distribution = { status: 'submitted', releaseId: release.id, submittedAt: Date.now() };
    await supabase.from('tracks').update({ distribution }).eq('id', track.id);
    res.json({ ok: true, distribution });
  } catch (err) {
    res.status(502).json({ error: 'labelgrid_error', message: err.message });
  }
});

app.post('/api/webhooks/labelgrid', async (req, res) => {
  const { releaseId, status } = req.body || {};
  if (releaseId && status) {
    const { data: track } = await supabase.from('tracks').select('id, distribution').contains('distribution', { releaseId }).maybeSingle();
    if (track) {
      await supabase
        .from('tracks')
        .update({ distribution: { ...track.distribution, status, updatedAt: Date.now() } })
        .eq('id', track.id);
    }
  }
  res.json({ received: true });
});

// --- Paiement (Stripe) pour débloquer la distribution — reste inactif
// tant qu'aucune clé Stripe n'est renseignée dans .env. Sert à couvrir
// le coût réel de LabelGrid une fois reporté sur les artistes.
app.get('/api/payments/status', (req, res) => {
  res.json({ configured: stripeClient.isConfigured(), feeCents: stripeClient.DISTRIBUTION_FEE_CENTS });
});

// --- Connexion SoundCloud (en sommeil, voir soundcloudClient.js) ---
app.get('/api/soundcloud/status', (req, res) => {
  res.json({ configured: soundcloudClient.isConfigured() });
});
app.get('/api/soundcloud/connect', requireAuth, (req, res) => {
  if (!soundcloudClient.isConfigured()) return res.status(503).json({ error: 'not_configured' });
  // TODO une fois l'accès obtenu : rediriger vers l'URL d'autorisation
  // OAuth de SoundCloud (voir leur documentation développeur à ce
  // moment-là pour le flux exact).
  res.status(501).json({ error: 'not_implemented' });
});

app.post('/api/tracks/:id/pay-distribution', requireAuth, async (req, res) => {
  if (!stripeClient.isConfigured()) return res.status(503).json({ error: 'not_configured' });
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).eq('user_id', req.session.userId).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });

  try {
    const origin = req.headers.origin || 'https://' + req.headers.host;
    const session = await stripeClient.createDistributionCheckout({
      trackId: track.id,
      trackTitle: track.title,
      successUrl: origin + '/#espace?payment=success',
      cancelUrl: origin + '/#espace?payment=cancelled',
    });
    res.json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    res.status(502).json({ error: 'payment_error', message: err.message });
  }
});

// Reçoit la confirmation de paiement de Stripe. NOTE : pour une vraie mise
// en production, il faut vérifier la signature du webhook avec le secret
// fourni par Stripe (voir leur documentation "Webhooks") avant de faire
// confiance à ce contenu — laissé simple ici tant que ce n'est pas activé.
app.post('/api/webhooks/stripe', async (req, res) => {
  const event = req.body;
  if (event && event.type === 'checkout.session.completed') {
    const trackId = event.data && event.data.object && event.data.object.metadata && event.data.object.metadata.trackId;
    if (trackId) {
      await supabase.from('tracks').update({ distribution_paid: true }).eq('id', Number(trackId));
    }
  }
  res.json({ received: true });
});

// --- Administration ---
app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  const { data: users } = await supabase.from('users').select('*');
  const { data: tracks } = await supabase.from('tracks').select('*').order('created_at', { ascending: false });
  const byId = Object.fromEntries((users || []).map((u) => [u.id, u]));
  res.json({
    users: (users || []).map(publicUser),
    tracks: (tracks || []).map((t) => {
      const artist = byId[t.user_id];
      return { ...mapTrack(t, artist ? artist.artist_name : 'Artiste supprimé'), artistEmail: artist ? artist.email : '' };
    }),
  });
});

// --- Export des données personnelles (droit RGPD) ---
// L'artiste demande, l'administratrice active une fenêtre limitée
// pendant laquelle le téléchargement devient possible — reste
// cohérent avec la promesse déjà faite dans les CGU ("écris-nous pour
// demander tes données"), juste automatisé plutôt que manuel.
const EXPORT_WINDOW_HOURS = 48;

app.post('/api/me/request-export', requireAuth, async (req, res) => {
  const { data: me } = await supabase.from('users').select('artist_name, email').eq('id', req.session.userId).maybeSingle();
  if (!me) return res.status(404).json({ error: 'not_found' });
  await resendClient.notifyExportRequest(me.artist_name, me.email);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/enable-export', requireAdmin, async (req, res) => {
  const expiresAt = Date.now() + EXPORT_WINDOW_HOURS * 60 * 60 * 1000;
  await supabase.from('users').update({ export_expires_at: expiresAt }).eq('id', req.params.id);
  res.json({ ok: true, expiresAt });
});

app.get('/api/me/export', requireAuth, async (req, res) => {
  const { data: me } = await supabase.from('users').select('*').eq('id', req.session.userId).maybeSingle();
  if (!me || !me.export_expires_at || me.export_expires_at < Date.now()) {
    return res.status(403).json({ error: 'export_not_available' });
  }
  const { data: tracks } = await supabase.from('tracks').select('*').eq('user_id', req.session.userId);
  const exportData = {
    profil: publicUser(me),
    morceaux: (tracks || []).map((t) => mapTrack(t, me.artist_name)),
    genereLe: new Date().toISOString(),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="resonance-mes-donnees.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(exportData, null, 2));
});

// --- Messagerie discrète (un visiteur écrit à un artiste sans jamais
// voir son adresse e-mail réelle ; l'artiste répond depuis le site,
// jamais depuis sa messagerie personnelle, pour la même raison) ---
app.post('/api/artists/:id/message', publicActionLimiter, async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!email || !message || !message.trim()) return res.status(400).json({ error: 'missing_fields' });
  const artistId = Number(req.params.id);
  const { data: artist } = await supabase.from('users').select('id, artist_name, email').eq('id', artistId).maybeSingle();
  if (!artist) return res.status(404).json({ error: 'not_found' });

  const { error } = await supabase.from('messages').insert({
    to_user_id: artistId,
    from_name: (name || '').trim(),
    from_email: email.trim(),
    body: message.trim(),
    read: false,
    replied: false,
    created_at: Date.now(),
  });
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });

  resendClient.notifyNewMessage(artist.email, artist.artist_name, (name || '').trim(), email.trim(), message.trim());
  res.json({ ok: true });
});

app.get('/api/me/messages', requireAuth, async (req, res) => {
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('to_user_id', req.session.userId)
    .order('created_at', { ascending: false });
  res.json({
    messages: (messages || []).map((m) => ({
      id: m.id,
      fromName: m.from_name || '',
      fromEmail: m.from_email,
      body: m.body,
      read: !!m.read,
      replied: !!m.replied,
      createdAt: m.created_at,
    })),
  });
});

app.post('/api/me/messages/:id/read', requireAuth, async (req, res) => {
  await supabase.from('messages').update({ read: true }).eq('id', req.params.id).eq('to_user_id', req.session.userId);
  res.json({ ok: true });
});

app.post('/api/me/messages/:id/reply', requireAuth, async (req, res) => {
  const { reply } = req.body || {};
  if (!reply || !reply.trim()) return res.status(400).json({ error: 'missing_reply' });
  const { data: message } = await supabase.from('messages').select('*').eq('id', req.params.id).eq('to_user_id', req.session.userId).maybeSingle();
  if (!message) return res.status(404).json({ error: 'not_found' });
  const { data: me } = await supabase.from('users').select('artist_name').eq('id', req.session.userId).single();

  await resendClient.sendReplyToVisitor(message.from_email, me.artist_name, reply.trim());
  await supabase.from('messages').update({ replied: true, read: true }).eq('id', message.id);
  res.json({ ok: true });
});

app.delete('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  await supabase.from('tracks').delete().eq('id', track.id);
  removeFromStorage(track.audio_url);
  if (track.cover_url) removeFromStorage(track.cover_url);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.session.userId) return res.status(400).json({ error: 'cannot_delete_self' });
  const { data: tracks } = await supabase.from('tracks').select('*').eq('user_id', targetId);
  await supabase.from('users').delete().eq('id', targetId);
  (tracks || []).forEach((t) => {
    removeFromStorage(t.audio_url);
    if (t.cover_url) removeFromStorage(t.cover_url);
  });
  res.json({ ok: true });
});

// Gestion des erreurs multer (fichier trop lourd, mauvais type…)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: 'upload_error', message: err.message });
  next();
});

app.listen(PORT, () => {
  console.log(`Résonance écoute sur http://localhost:${PORT}`);
});
