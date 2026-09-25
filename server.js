require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// Indispensable derrière Render (et la plupart des hébergeurs) : le
// HTTPS est géré par leur proxy, pas directement par notre serveur.
// Sans ce réglage, Express ne reconnaît pas la connexion comme
// sécurisée, et les cookies "secure" (voir plus bas) ne s'enregistrent
// jamais vraiment — ce qui casse silencieusement toutes les connexions.
app.set('trust proxy', 1);

// --- Config upload (audio, pochettes, avatars, bannières) ---
// Les fichiers sont stockés sur Supabase Storage (bucket "media"),
// permanent — contrairement à un dossier local sur Render, qui peut être
// effacé à chaque redéploiement.
const STORAGE_BUCKET = 'media';
// 50 Mo : c'est la taille maximale qu'accepte le stockage gratuit de
// Supabase. Au-delà, l'envoi échouait plus loin avec un message obscur.
const MAX_UPLOAD_MB = 50;

// Les téléphones (surtout l'iPhone, depuis l'app Fichiers ou un cloud)
// envoient parfois un .wav avec un type "inconnu" au lieu de "audio/wav".
// On reconnaît donc aussi les fichiers audio à leur extension, et on leur
// redonne le bon type pour qu'ils se lisent correctement ensuite.
const AUDIO_TYPES_BY_EXTENSION = {
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4', // certaines applis exportent l'audio seul en .mp4
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
};

function audioTypeFromName(name) {
  return AUDIO_TYPES_BY_EXTENSION[path.extname(name || '').toLowerCase()] || null;
}

// Neutralise les caractères spéciaux de ILIKE (% et _, jokers SQL) avant de
// les passer dans une recherche par e-mail. Sans ça, un e-mail contenant un
// "%" ferait correspondre plusieurs comptes à la fois au lieu d'un seul
// (ex. "%" seul correspond à n'importe quel e-mail) — un comportement qui
// n'a rien à voir avec une simple recherche insensible à la casse. On garde
// ILIKE plutôt que de passer à une comparaison stricte, car les e-mails ne
// sont pas normalisés en minuscules à l'inscription (des comptes existants
// ont leur casse d'origine).
function escapeLikePattern(str) {
  return String(str || '').replace(/[\\%_]/g, '\\$&');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'cover' || file.fieldname === 'albumCover' || file.fieldname === 'avatar' || file.fieldname === 'banner') {
      if (!file.mimetype.startsWith('image/')) {
        return cb(new Error('Ce champ attend une image.'));
      }
      return cb(null, true);
    }
    if (!file.mimetype.startsWith('audio/') && !audioTypeFromName(file.originalname)) {
      return cb(new Error('Seuls les fichiers audio sont acceptés.'));
    }
    cb(null, true);
  },
});

async function uploadToStorage(file) {
  const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const contentType = file.mimetype.startsWith('audio/') || file.mimetype.startsWith('image/') ? file.mimetype : audioTypeFromName(file.originalname) || file.mimetype;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(safe, file.buffer, { contentType });
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
// En-têtes de sécurité HTTP standards (anti-clickjacking, anti-sniffing MIME,
// etc.). La politique de sécurité de contenu (CSP) est désactivée pour l'instant
// afin de ne rien casser (polices Google, Stripe, Supabase, images en data:),
// elle pourra être affinée plus tard si besoin.
app.use(helmet({ contentSecurityPolicy: false }));
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
// Évite d'envoyer une alerte "tentatives suspectes" à chaque requête
// bloquée (ça spammerait) — une seule alerte par compte toutes les 30
// minutes maximum.
const lastSuspiciousAlert = new Map();
function shouldAlertSuspiciousLogin(email) {
  const last = lastSuspiciousAlert.get(email);
  if (last && Date.now() - last < 30 * 60 * 1000) return false;
  lastSuspiciousAlert.set(email, Date.now());
  return true;
}

const loginEmailLimiter = rateLimit({
  windowMs: 30 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body && req.body.email ? req.body.email.toLowerCase() : 'unknown'),
  // PAS d'exemption ici (volontairement) : exempter un e-mail de la
  // limite "par compte" revenait à laisser ce compte-là — le tien, donc
  // le compte admin — sans aucune protection contre les essais de mots
  // de passe en rafale. Tu restes exemptée de la limite par IP.
  handler: (req, res, next, options) => {
    const email = req.body && req.body.email ? req.body.email.toLowerCase() : '';
    if (email && shouldAlertSuspiciousLogin(email)) {
      resendClient.notifySuspiciousLogin(email);
    }
    res.status(429).json({ error: 'too_many_attempts' });
  },
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
    bandcampUrl: u.bandcamp_url || '',
    avatarUrl: u.avatar_url || '',
    bannerUrl: u.banner_url || '',
    role: u.role,
    accountType: u.account_type || 'artist',
    followingIds: u.following_ids || [],
    cguVersion: CGU_VERSION,
    cguUpToDate: isCguUpToDate(u),
    identityVerified: u.identity_verified === true,
    // Nom affiché sur les pochettes créées automatiquement : 'full' (nom
    // complet) ou 'initials' (ex. « M.D. » pour Marine Dax).
    coverNameStyle: u.cover_name_style === 'initials' ? 'initials' : 'full',
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
  // Pochette créée automatiquement + album avec sa propre pochette : c'est
  // celle de l'album qui prime (la pochette automatique n'est qu'un repli).
  const ownCover = t.cover_generated && t._album && t._album.cover_url ? '' : t.cover_url || '';
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
    // Pas de pochette propre mais un album avec pochette : c'est celle de
    // l'album qui devient l'image principale (comme sur Spotify).
    coverUrl: ownCover || (t._album && t._album.cover_url) || '',
    hasOwnCover: !!t.cover_url && !t.cover_generated,
    coverGenerated: !!t.cover_generated,
    collaborators: t.collaborators || '',
    genesis: t.genesis || '',
    explicit: !!t.explicit,
    exclusive: !!t.exclusive,
    spotifyUrl: t.spotify_url || '',
    appleUrl: t.apple_url || '',
    plays: t.plays || 0,
    distribution: t.distribution,
    createdAt: Number(t.created_at),
    releaseAt: t.release_at ? Number(t.release_at) : null,
    isScheduled: !!(t.release_at && Number(t.release_at) > Date.now()),
    distributionPaid: !!t.distribution_paid,
    albumId: t.album_id || null,
    albumTitle: t._album ? t._album.title : '',
    // Miniature d'album dans le coin : seulement si le titre a SA pochette,
    // sinon on afficherait deux fois la même image.
    albumCoverUrl: ownCover && t._album ? t._album.cover_url || '' : '',
    likeCount: t._likeCount || 0,
    liked: !!t._liked,
    artistName,
  };
}

// --- "J'aime" (likes) ---
// Un visiteur sans compte peut aimer un morceau (identifiant d'appareil
// envoyé par le client, voir getDeviceId() dans app.js) ; un compte connecté
// utilise son id à la place, sans restriction de type de compte (fan ou
// artiste, y compris sur ses propres morceaux). Les deux se rejoignent à la
// connexion/inscription (voir mergeDeviceLikes) : les likes faits avant de
// se connecter ne sont pas perdus.
function likeIdentity(req) {
  if (req.session.userId) return { userId: req.session.userId, deviceId: null };
  const deviceId = String((req.body && req.body.deviceId) || req.query.deviceId || '').slice(0, 100);
  if (!deviceId) return null;
  return { userId: null, deviceId };
}

// Ajoute à chaque morceau son nombre de likes et si LA PERSONNE QUI REGARDE
// (viewer, pas l'artiste) l'a aimé — en une seule requête, comme
// attachAlbums. Le volume de likes reste faible pour l'instant : si ça
// devient un vrai souci de performance plus tard, ce sera à revoir avec un
// comptage fait côté base plutôt qu'en récupérant chaque ligne.
async function attachLikes(rows, viewerUserId, viewerDeviceId) {
  const list = (rows || []).filter(Boolean);
  const ids = [...new Set(list.map((t) => t.id))];
  if (!ids.length) return list;
  const { data: likes, error } = await supabase.from('likes').select('track_id, user_id, device_id').in('track_id', ids);
  if (error) return list; // table pas encore créée : le site continue sans les likes
  const byTrack = {};
  (likes || []).forEach((l) => {
    if (!byTrack[l.track_id]) byTrack[l.track_id] = { count: 0, liked: false };
    byTrack[l.track_id].count += 1;
    if ((viewerUserId && l.user_id === viewerUserId) || (!viewerUserId && viewerDeviceId && l.device_id === viewerDeviceId)) {
      byTrack[l.track_id].liked = true;
    }
  });
  list.forEach((t) => {
    const info = byTrack[t.id];
    t._likeCount = info ? info.count : 0;
    t._liked = info ? info.liked : false;
  });
  return list;
}

function viewerIdentity(req) {
  return { userId: req.session.userId || null, deviceId: String(req.query.deviceId || '').slice(0, 100) || null };
}

// Rattache à un compte les likes faits avant la connexion/inscription sous
// un identifiant d'appareil — sans dupliquer si le compte avait déjà aimé
// le même morceau par ailleurs.
async function mergeDeviceLikes(userId, deviceId) {
  if (!deviceId) return;
  const { data: deviceLikes } = await supabase.from('likes').select('id, track_id').eq('device_id', deviceId).is('user_id', null);
  if (!deviceLikes || !deviceLikes.length) return;
  const { data: userLikes } = await supabase.from('likes').select('track_id').eq('user_id', userId);
  const already = new Set((userLikes || []).map((l) => l.track_id));
  for (const like of deviceLikes) {
    if (already.has(like.track_id)) {
      await supabase.from('likes').delete().eq('id', like.id);
    } else {
      await supabase.from('likes').update({ user_id: userId, device_id: null }).eq('id', like.id);
    }
  }
}

app.post('/api/tracks/:id/like', publicActionLimiter, async (req, res) => {
  const identity = likeIdentity(req);
  if (!identity) return res.status(400).json({ error: 'missing_identity' });
  const trackId = Number(req.params.id);
  const { data: track } = await supabase.from('tracks').select('id').eq('id', trackId).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  const filter = identity.userId ? { track_id: trackId, user_id: identity.userId } : { track_id: trackId, device_id: identity.deviceId };
  const { data: existing } = await supabase.from('likes').select('id').match(filter).maybeSingle();
  if (!existing) {
    const { error } = await supabase.from('likes').insert({ track_id: trackId, user_id: identity.userId, device_id: identity.deviceId, created_at: Date.now() });
    if (error) return res.status(500).json({ error: 'likes_table_missing' });
  }
  const { count } = await supabase.from('likes').select('id', { count: 'exact', head: true }).eq('track_id', trackId);
  res.json({ ok: true, liked: true, likeCount: count || 0 });
});

app.post('/api/tracks/:id/unlike', publicActionLimiter, async (req, res) => {
  const identity = likeIdentity(req);
  if (!identity) return res.status(400).json({ error: 'missing_identity' });
  const trackId = Number(req.params.id);
  const filter = identity.userId ? { track_id: trackId, user_id: identity.userId } : { track_id: trackId, device_id: identity.deviceId };
  await supabase.from('likes').delete().match(filter);
  const { count } = await supabase.from('likes').select('id', { count: 'exact', head: true }).eq('track_id', trackId);
  res.json({ ok: true, liked: false, likeCount: count || 0 });
});

// --- Albums / EP ---
// Un album appartient à un artiste (titre + pochette). Un morceau peut en
// faire partie (tracks.album_id) : sa propre pochette reste l'image
// principale, celle de l'album s'affiche en plus petit à côté.

// Ajoute à chaque morceau les infos de son album (t._album), en une seule
// requête. Si la table n'existe pas encore, les morceaux restent tels quels.
async function attachAlbums(rows) {
  const list = (rows || []).filter(Boolean);
  const ids = [...new Set(list.map((t) => t.album_id).filter(Boolean))];
  if (!ids.length) return list;
  const { data: albums, error } = await supabase.from('albums').select('id, title, cover_url').in('id', ids);
  if (error) return list;
  const byId = Object.fromEntries((albums || []).map((a) => [a.id, a]));
  list.forEach((t) => {
    if (t.album_id) t._album = byId[t.album_id] || null;
  });
  return list;
}

// Lit le choix d'album envoyé par le formulaire :
//  - absent        => on ne touche à rien ({ unchanged: true })
//  - vide          => titre seul, sans album ({ albumId: null })
//  - "new"         => crée l'album (titre obligatoire, pochette facultative)
//  - un numéro     => album existant, qui doit appartenir à cet artiste
async function resolveAlbumChoice(req, userId) {
  const choice = req.body.albumChoice;
  if (choice === undefined) return { unchanged: true };
  if (!choice) return { albumId: null };
  if (choice === 'new') {
    const title = String(req.body.albumTitle || '').trim().slice(0, 200);
    if (!title) return { error: 'album_title_missing' };
    const coverFile = req.files && req.files.albumCover && req.files.albumCover[0];
    let coverUrl = '';
    try {
      if (coverFile) coverUrl = await uploadToStorage(coverFile);
    } catch (err) {
      return { error: 'storage_error' };
    }
    const { data, error } = await supabase
      .from('albums')
      .insert({ user_id: userId, title, cover_url: coverUrl, created_at: Date.now() })
      .select()
      .single();
    if (error) return { error: 'albums_table_missing' };
    return { albumId: data.id };
  }
  const { data: album } = await supabase.from('albums').select('id').eq('id', Number(choice)).eq('user_id', userId).maybeSingle();
  if (!album) return { error: 'album_not_found' };
  return { albumId: album.id };
}

app.get('/api/me/albums', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('albums')
    .select('id, title, cover_url')
    .eq('user_id', req.session.userId)
    .order('created_at', { ascending: false });
  if (error) return res.json({ albums: [] });
  res.json({ albums: (data || []).map((a) => ({ id: a.id, title: a.title, coverUrl: a.cover_url || '' })) });
});

// Nombre de morceaux qu'un artiste peut publier avant d'avoir confirmé
// son adresse e-mail (le même chiffre est utilisé côté site, dans app.js).
const UNVERIFIED_TRACK_LIMIT = 3;

// --- Sorties programmées ---
const DAY_MS = 24 * 60 * 60 * 1000;

// Transforme ce qu'envoie le formulaire (date ISO ou timestamp) en
// timestamp. Vide, invalide ou déjà passé => publication immédiate (null).
// Limité à un an d'avance pour éviter les fautes de frappe (2062...).
function parseReleaseAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const ms = /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(ms) || ms <= Date.now()) return null;
  if (ms > Date.now() + 365 * DAY_MS) return 'too_far';
  return ms;
}

// Filtre Supabase : ne montre au public que ce qui est déjà sorti.
function onlyReleased(query) {
  return query.or('release_at.is.null,release_at.lte.' + Date.now());
}

function isFridayInParis(ms) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Europe/Paris' }).format(new Date(ms)) === 'Fri';
}

// Conseils affichés dans la bulle au moment de choisir une date. Ce ne
// sont QUE des conseils : rien n'est jamais bloqué.
async function releaseAdvice(userId, releaseAt, excludeTrackId) {
  const target = releaseAt || Date.now();
  const { data: mine } = await supabase.from('tracks').select('id, created_at, release_at').eq('user_id', userId);
  const dates = (mine || [])
    .filter((t) => String(t.id) !== String(excludeTrackId || ''))
    .map((t) => Number(t.release_at || t.created_at));
  const tips = [];

  const sameMonth = dates.filter((d) => Math.abs(d - target) <= 15 * DAY_MS).length;
  if (sameMonth >= 2) {
    tips.push({ code: 'crowded', level: 'warning', text: "Ça fait beaucoup de sorties sur le même mois. Ton public risque de ne pas tout écouter : garde quelques titres en réserve pour les semaines suivantes." });
  } else if (dates.some((d) => Math.abs(d - target) < 14 * DAY_MS)) {
    tips.push({ code: 'spacing', level: 'tip', text: "Tu as déjà une sortie à moins de 2 semaines de cette date. Espacer tes titres de 3 à 6 semaines laisse à chacun le temps d'être découvert et partagé." });
  }

  if (releaseAt && releaseAt - Date.now() < 7 * DAY_MS) {
    tips.push({ code: 'short_notice', level: 'tip', text: "Si tu peux, prévois 1 à 3 semaines avant la sortie pour l'annoncer (pochette, extrait, date). Et si tu sors aussi ce titre sur Spotify, il faut au moins 7 jours d'avance pour le proposer à leurs playlists éditoriales." });
  }

  if (!releaseAt && tips.length === 0) {
    tips.push({ code: 'can_schedule', level: 'info', text: "Astuce : tu peux aussi programmer la sortie à une date précise, pour avoir le temps de l'annoncer avant." });
  }

  if (releaseAt && !isFridayInParis(releaseAt)) {
    tips.push({ code: 'friday', level: 'info', text: "Petit repère : dans la musique, les nouveautés sortent traditionnellement le vendredi. Ce n'est pas une obligation sur Risuona." });
  }
  return tips;
}

// La bulle de conseils peut interroger cette route dès que l'artiste
// change la date dans le formulaire, avant même de valider.
app.get('/api/me/release-advice', requireAuth, async (req, res) => {
  const releaseAt = parseReleaseAt(req.query.releaseAt);
  if (releaseAt === 'too_far') return res.json({ tips: [{ code: 'too_far', level: 'warning', text: "Les sorties se programment jusqu'à un an à l'avance maximum." }] });
  res.json({ tips: await releaseAdvice(req.session.userId, releaseAt, req.query.trackId) });
});

// --- CGU (conditions d'utilisation) ---
// À changer à chaque nouvelle version des CGU (texte modifié dans
// public/cgu.html) : ça déclenche le bandeau de ré-acceptation pour tous
// les comptes qui ont accepté une version antérieure.
const CGU_VERSION = '2';

// Enregistre une acceptation des CGU : une ligne de plus dans le registre
// (jamais écrasée, c'est la preuve juridique) + mise à jour de la recopie
// rapide sur le compte. Tolérant si l'étape Supabase n'est pas encore
// faite (le registre n'existe pas encore) : le site continue de marcher,
// simplement sans cette protection en attendant.
async function recordCguAcceptance(user) {
  const now = Date.now();
  await supabase.from('cgu_acceptances').insert({
    user_id: user.id,
    version: CGU_VERSION,
    artist_name: user.artist_name,
    email: user.email,
    account_type: user.account_type || 'artist',
    accepted_at: now,
  });
  await supabase.from('users').update({ cgu_accepted_version: CGU_VERSION, cgu_accepted_at: now }).eq('id', user.id);
}

// Un compte est à jour s'il a accepté la version courante — ou si l'étape
// Supabase n'est pas encore faite (cgu_accepted_version alors undefined,
// pas null) : on ne bloque personne tant que le registre n'existe pas.
function isCguUpToDate(user) {
  return user.cgu_accepted_version === CGU_VERSION || user.cgu_accepted_version === undefined;
}

async function requireCguUpToDate(req, res, next) {
  const { data: user } = await supabase.from('users').select('id, artist_name, email, account_type, cgu_accepted_version').eq('id', req.session.userId).maybeSingle();
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (!isCguUpToDate(user)) return res.status(403).json({ error: 'terms_outdated' });
  next();
}

// --- Auth ---
app.post('/api/signup', authLimiter, async (req, res) => {
  const { artistName, email, password, acceptedTerms, accountType, deviceId } = req.body;
  if (!artistName || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (!acceptedTerms) return res.status(400).json({ error: 'terms_not_accepted' });

  const { data: existing } = await supabase.from('users').select('id').ilike('email', escapeLikePattern(email)).maybeSingle();
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
  await recordCguAcceptance(user);
  req.session.userId = user.id;
  await mergeDeviceLikes(user.id, deviceId);
  if (role === 'artist') {
    resendClient.notifyNewSignup(artistName, email);
    const siteUrl = req.headers.origin || 'https://' + req.headers.host;
    resendClient.sendVerificationEmail(email, artistName, verificationToken, siteUrl);
  }
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/login', authLimiter, loginEmailLimiter, async (req, res) => {
  const { email, password, deviceId } = req.body;
  const { data: user } = await supabase.from('users').select('*').ilike('email', escapeLikePattern(email || '')).maybeSingle();
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.userId = user.id;
  await mergeDeviceLikes(user.id, deviceId);
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
  await supabase.from('users').update({ email_verified: true, verified_via_link: true, verification_token: null }).eq('id', user.id);
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

// --- Mot de passe oublié (utilisateurs) ---
// Toujours répondre ok:true, que l'adresse existe ou non, pour ne jamais
// révéler à quelqu'un si un e-mail donné est inscrit sur Risuona.
app.post('/api/forgot-password', authLimiter, loginEmailLimiter, async (req, res) => {
  const email = (req.body && req.body.email) || '';
  const { data: user } = await supabase.from('users').select('id, artist_name, email').ilike('email', escapeLikePattern(email)).maybeSingle();
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = Date.now() + 60 * 60 * 1000; // 1h
    await supabase.from('users').update({ reset_token: token, reset_token_expires: expires }).eq('id', user.id);
    const siteUrl = req.headers.origin || 'https://' + req.headers.host;
    resendClient.sendPasswordResetEmail(user.email, user.artist_name, token, siteUrl);
  }
  res.json({ ok: true });
});

app.post('/api/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });
  const { data: user } = await supabase.from('users').select('id, reset_token_expires').eq('reset_token', token).maybeSingle();
  if (!user || !user.reset_token_expires || Number(user.reset_token_expires) < Date.now()) {
    return res.status(400).json({ error: 'invalid_or_expired_token' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await supabase.from('users').update({ password_hash: passwordHash, reset_token: null, reset_token_expires: null }).eq('id', user.id);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const { data: user } = await supabase.from('users').select('*').eq('id', req.session.userId).maybeSingle();
  res.json({ user: publicUser(user) });
});

// Clic sur "J'accepte" dans le bandeau de ré-acceptation des CGU.
app.post('/api/me/accept-terms', requireAuth, async (req, res) => {
  const { data: user } = await supabase.from('users').select('id, artist_name, email, account_type').eq('id', req.session.userId).maybeSingle();
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  await recordCguAcceptance(user);
  const { data: updated } = await supabase.from('users').select('*').eq('id', req.session.userId).single();
  res.json({ ok: true, user: publicUser(updated) });
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
      bandcamp_url: req.body.bandcampUrl,
    };
    if (req.body.coverNameStyle === 'full' || req.body.coverNameStyle === 'initials') {
      fields.cover_name_style = req.body.coverNameStyle;
    }
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
  const { data: tracks } = await onlyReleased(supabase.from('tracks').select('*')).order('created_at', { ascending: false }).limit(200);
  await attachAlbums(tracks);
  const viewer = viewerIdentity(req);
  await attachLikes(tracks, viewer.userId, viewer.deviceId);
  const userIds = [...new Set((tracks || []).map((t) => t.user_id))];
  const { data: users } = userIds.length
    ? await supabase.from('users').select('id, artist_name, donation_link, spotify_url, apple_url, soundcloud_url, instagram_url, suno_url, bandcamp_url').in('id', userIds)
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
      bandcampUrl: u ? u.bandcamp_url : '',
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
  await attachAlbums(tracks);
  await attachLikes(tracks, req.session.userId, null);
  res.json({ tracks: (tracks || []).map((t) => mapTrack(t, me ? me.artist_name : '')) });
});

app.post('/api/tracks', requireAuth, requireCguUpToDate, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }, { name: 'albumCover', maxCount: 1 }]), async (req, res) => {
  const { title, genre, aiLyrics, aiMusic, aiVocals, aiTool, collaborators, genesis, explicit, exclusive, spotifyUrl, appleUrl } = req.body;
  const releaseAt = parseReleaseAt(req.body.releaseAt);
  if (releaseAt === 'too_far') return res.status(400).json({ error: 'release_too_far' });
  const audioFile = req.files && req.files.audio && req.files.audio[0];
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  if (!title || !audioFile) return res.status(400).json({ error: 'missing_fields' });

  const { data: meAccount } = await supabase.from('users').select('account_type').eq('id', req.session.userId).single();
  if (meAccount && meAccount.account_type === 'fan') {
    return res.status(403).json({ error: 'fan_account' });
  }

  // Les 3 premiers morceaux sont autorisés sans confirmation d'e-mail
  // (pour ne pas bloquer la découverte du site) ; les suivants exigent
  // que l'adresse ait bien été confirmée, ce qui évite qu'un compte créé
  // avec une adresse qui n'appartient pas à la personne publie en continu.
  if (resendClient.isConfigured()) {
    const { data: me } = await supabase.from('users').select('email_verified').eq('id', req.session.userId).single();
    const { count: existingCount } = await supabase
      .from('tracks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.session.userId);
    if (!me.email_verified && (existingCount || 0) >= UNVERIFIED_TRACK_LIMIT) {
      return res.status(403).json({ error: 'email_not_verified' });
    }
  }

  let audioUrl;
  let coverUrl = '';
  try {
    audioUrl = await uploadToStorage(audioFile);
    if (coverFile) coverUrl = await uploadToStorage(coverFile);
  } catch (err) {
    const tooBig = /size|exceed|large/i.test((err && err.message) || '');
    return res.status(tooBig ? 400 : 500).json({ error: tooBig ? 'file_too_large' : 'storage_error' });
  }

  const album = await resolveAlbumChoice(req, req.session.userId);
  if (album.error) return res.status(400).json({ error: album.error });

  const row = {
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
    // "Exclusivité Risuona" : l'artiste déclare que ce titre n'est publié
    // nulle part ailleurs. C'est une simple déclaration de sa part (comme
    // pour l'IA), pas une vérification technique.
    exclusive: exclusive === 'true' || exclusive === true,
    spotify_url: spotifyUrl || '',
    apple_url: appleUrl || '',
    release_at: releaseAt,
    // album_id n'est envoyé que s'il y a un album : ainsi, publier un
    // single marche même si l'étape Supabase des albums n'est pas faite.
    ...(album.albumId ? { album_id: album.albumId } : {}),
    // Pochette créée automatiquement par le site (l'artiste n'a pas envoyé
    // d'image) : on le note pour pouvoir la régénérer sans jamais écraser
    // une vraie pochette. Envoyé seulement si c'est le cas, comme album_id.
    ...(coverUrl && req.body.coverGenerated === 'true' ? { cover_generated: true } : {}),
    // created_at reste la date d'upload réelle : c'est elle qui sert de
    // preuve d'antériorité (CGU), même si la sortie publique est plus tard.
    created_at: Date.now(),
  };
  let { data: track, error } = await supabase.from('tracks').insert(row).select().single();
  // Étape Supabase des pochettes automatiques pas encore faite : on publie
  // quand même, simplement sans la mention "pochette générée".
  if (error && row.cover_generated && /cover_generated/.test(error.message || '')) {
    delete row.cover_generated;
    ({ data: track, error } = await supabase.from('tracks').insert(row).select().single());
  }

  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  const advice = await releaseAdvice(req.session.userId, releaseAt, track.id);
  await attachAlbums([track]);
  res.json({ ok: true, track: mapTrack(track), advice });
});

app.put('/api/tracks/:id', requireAuth, upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'albumCover', maxCount: 1 }]), async (req, res) => {
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
  if (req.body.exclusive !== undefined) fields.exclusive = req.body.exclusive === 'true' || req.body.exclusive === true;
  if (req.body.spotifyUrl !== undefined) fields.spotify_url = req.body.spotifyUrl;
  if (req.body.appleUrl !== undefined) fields.apple_url = req.body.appleUrl;
  if (req.body.releaseAt !== undefined) {
    // Vide = "publier maintenant". Un titre déjà sorti ne peut pas être
    // "re-caché" en le reprogrammant (ses écoutes et liens partagés restent).
    const alreadyOut = !track.release_at || Number(track.release_at) <= Date.now();
    const releaseAt = parseReleaseAt(req.body.releaseAt);
    if (releaseAt === 'too_far') return res.status(400).json({ error: 'release_too_far' });
    if (alreadyOut && releaseAt) return res.status(400).json({ error: 'already_released' });
    fields.release_at = releaseAt;
  }

  const album = await resolveAlbumChoice(req, req.session.userId);
  if (album.error) return res.status(400).json({ error: album.error });
  if (!album.unchanged) fields.album_id = album.albumId;

  const coverFile = req.files && req.files.cover && req.files.cover[0];
  if (coverFile) {
    const generated = req.body.coverGenerated === 'true';
    // Une pochette automatique ne remplace jamais une vraie pochette
    // envoyée par l'artiste.
    if (generated && track.cover_url && !track.cover_generated) {
      return res.status(409).json({ error: 'own_cover' });
    }
    // Étape Supabase des pochettes automatiques pas encore faite.
    if (generated && !('cover_generated' in track)) {
      return res.status(409).json({ error: 'covers_not_ready' });
    }
    fields.cover_url = await uploadToStorage(coverFile);
    if (track.cover_url) removeFromStorage(track.cover_url);
    if (generated) fields.cover_generated = true;
    else if (track.cover_generated) fields.cover_generated = false;
  }

  const { data: updated, error } = await supabase.from('tracks').update(fields).eq('id', track.id).select().single();
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  await attachAlbums([updated]);
  res.json({ ok: true, track: mapTrack(updated) });
});

// Enregistre une écoute réelle (déclenchée côté client après quelques
// secondes de lecture, pas juste un clic) — accessible sans compte,
// puisque n'importe quel visiteur peut écouter.
app.post('/api/tracks/:id/register-play', publicActionLimiter, async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('plays, release_at').eq('id', req.params.id).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  if (track.release_at && Number(track.release_at) > Date.now()) return res.json({ ok: true });
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

// --- Référencement : pages artiste/morceau avec de vraies adresses ---
// Avant ce bloc, les pages artiste/morceau n'existaient qu'en
// "https://risuona.../#/artiste/123" : tout ce qui suit un # n'est jamais
// envoyé au serveur, donc Google ne voyait littéralement rien à indexer à
// cette adresse (juste la page d'accueil, toujours la même). Ici, on sert de
// vraies adresses ("/artiste/123") avec un titre, une description et une
// image propres à chaque artiste/morceau — lisibles par un moteur de
// recherche sans exécuter de JavaScript — puis on renvoie exactement la même
// page que d'habitude (index.html), qui prend le relais côté navigateur
// (voir le repli sur window.location.pathname dans app.js) pour l'affichage
// interactif habituel. Rien ne change pour un visiteur qui clique dans le
// site : la navigation interne continue d'utiliser les adresses en #.
const INDEX_HTML_PATH = path.join(__dirname, 'public', 'index.html');

function escapeHtmlAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Remplace title/description/og:*/twitter:card dans index.html par des
// valeurs propres à une page donnée. Se base sur la structure exacte du
// fichier (une seule balise <title>, une seule meta description, etc.) :
// si jamais l'un de ces éléments manque, la ligne correspondante est
// simplement laissée telle quelle plutôt que de faire planter la réponse.
function renderIndexWithMeta({ title, description, url, image }) {
  let html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const t = escapeHtmlAttr(title);
  const d = escapeHtmlAttr(description);
  const u = escapeHtmlAttr(url);
  const i = escapeHtmlAttr(image);
  html = html.replace(/<title>.*?<\/title>/, '<title>' + t + '</title>');
  html = html.replace(/<meta name="description" content=".*?">/, '<meta name="description" content="' + d + '">');
  html = html.replace(/<meta property="og:title" content=".*?">/, '<meta property="og:title" content="' + t + '">');
  html = html.replace(/<meta property="og:description" content=".*?">/, '<meta property="og:description" content="' + d + '">');
  html = html.replace(/<meta property="og:url" content=".*?">/, '<meta property="og:url" content="' + u + '">');
  if (image) html = html.replace(/<meta property="og:image" content=".*?">/, '<meta property="og:image" content="' + i + '">');
  html = html.replace(/<meta name="twitter:card" content=".*?">/, '<meta name="twitter:card" content="summary_large_image">');
  return html;
}

app.get('/artiste/:id', async (req, res, next) => {
  const { data: artist } = await supabase.from('users').select('artist_name, bio, avatar_url').eq('id', req.params.id).maybeSingle();
  if (!artist) return next(); // pas d'artiste : page normale, app.js affichera "introuvable"
  const siteUrl = req.protocol + '://' + req.get('host');
  res.send(
    renderIndexWithMeta({
      title: artist.artist_name + ' | Risuona',
      description: (artist.bio && artist.bio.trim()) || 'Découvre ' + artist.artist_name + ' sur Risuona, plateforme indépendante pour artistes musicaux.',
      url: siteUrl + '/artiste/' + req.params.id,
      image: artist.avatar_url || siteUrl + '/icons/icon-512.png',
    })
  );
});

app.get('/morceau/:id', async (req, res, next) => {
  const { data: track } = await supabase.from('tracks').select('title, cover_url, user_id, release_at').eq('id', req.params.id).maybeSingle();
  if (!track) return next();
  if (track.release_at && Number(track.release_at) > Date.now()) return next(); // pas encore sorti : pas d'indexation anticipée
  const { data: artist } = await supabase.from('users').select('artist_name').eq('id', track.user_id).maybeSingle();
  const siteUrl = req.protocol + '://' + req.get('host');
  res.send(
    renderIndexWithMeta({
      title: track.title + ' · ' + (artist ? artist.artist_name : '') + ' | Risuona',
      description: 'Écoute "' + track.title + '" par ' + (artist ? artist.artist_name : 'un artiste Risuona') + ', en écoute libre sur Risuona.',
      url: siteUrl + '/morceau/' + req.params.id,
      image: track.cover_url || siteUrl + '/icons/icon-512.png',
    })
  );
});

// Plan de site généré à la volée : liste désormais chaque artiste et chaque
// morceau déjà sorti (avant, ce fichier était fixe et ne listait que la page
// d'accueil). Remplace le fichier statique public/sitemap.xml.
app.get('/sitemap.xml', async (req, res) => {
  const siteUrl = req.protocol + '://' + req.get('host');
  const { data: users } = await supabase.from('users').select('id').eq('account_type', 'artist');
  const { data: tracks } = await onlyReleased(supabase.from('tracks').select('id, created_at'));
  const urls = [
    '  <url><loc>' + siteUrl + '/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>',
    ...((users || []).map((u) => '  <url><loc>' + siteUrl + '/artiste/' + u.id + '</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>')),
    ...((tracks || []).map((t) => '  <url><loc>' + siteUrl + '/morceau/' + t.id + '</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>')),
  ];
  res.setHeader('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>');
});

// --- Pages artiste publiques + suivi ---
app.get('/api/tracks/:id', async (req, res) => {
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  const notYetOut = track.release_at && Number(track.release_at) > Date.now();
  if (notYetOut && track.user_id !== req.session.userId) return res.status(404).json({ error: 'not_found' });
  const { data: artist } = await supabase.from('users').select('*').eq('id', track.user_id).maybeSingle();
  if (!artist) return res.status(404).json({ error: 'not_found' });
  await attachAlbums([track]);
  const viewer = viewerIdentity(req);
  await attachLikes([track], viewer.userId, viewer.deviceId);

  res.json({
    track: {
      ...mapTrack(track, artist.artist_name),
      donationLink: artist.donation_link,
      soundcloudUrl: artist.soundcloud_url,
      instagramUrl: artist.instagram_url,
      sunoUrl: artist.suno_url,
      bandcampUrl: artist.bandcamp_url,
    },
  });
});

app.get('/api/artists/:id', async (req, res) => {
  const artistId = Number(req.params.id);
  const { data: artist } = await supabase.from('users').select('*').eq('id', artistId).maybeSingle();
  if (!artist) return res.status(404).json({ error: 'not_found' });

  const isOwner = req.session.userId === artistId;
  let tracksQuery = supabase.from('tracks').select('*').eq('user_id', artistId);
  if (!isOwner) tracksQuery = onlyReleased(tracksQuery);
  const { data: tracks } = await tracksQuery.order('created_at', { ascending: false });
  await attachAlbums(tracks);
  const viewer = viewerIdentity(req);
  await attachLikes(tracks, viewer.userId, viewer.deviceId);

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
      bandcampUrl: artist.bandcamp_url,
    })),
    followerCount,
    isFollowing,
  });
});

app.post('/api/artists/:id/follow', requireAuth, requireCguUpToDate, async (req, res) => {
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
  // configured : l'envoi direct vers Spotify/Apple est-il branché ?
  // paymentRequired : faut-il payer avant (Stripe activé) ?
  res.json({ configured: labelgrid.isConfigured(), paymentRequired: stripeClient.isConfigured() });
});

app.post('/api/tracks/:id/distribute', requireAuth, async (req, res) => {
  if (!labelgrid.isConfigured()) return res.status(503).json({ error: 'not_configured' });
  const { data: track } = await supabase.from('tracks').select('*').eq('id', req.params.id).eq('user_id', req.session.userId).maybeSingle();
  if (!track) return res.status(404).json({ error: 'not_found' });
  // Sans ce contrôle, le bouton "Distribuer" marchait même sans avoir payé.
  if (stripeClient.isConfigured() && !track.distribution_paid) return res.status(402).json({ error: 'payment_required' });
  const { data: artist } = await supabase.from('users').select('artist_name').eq('id', req.session.userId).single();

  try {
    const lgArtist = await labelgrid.ensureArtist({ name: artist.artist_name });
    const release = await labelgrid.createRelease({
      title: track.title,
      artistId: lgArtist.id,
      releaseDate: new Date(track.release_at && Number(track.release_at) > Date.now() ? Number(track.release_at) : Date.now()).toISOString().slice(0, 10),
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
    users: (users || [])
      .map((u) => ({ ...publicUser(u), createdAt: Number(u.created_at) || null }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
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

// Solution de secours tant que Resend n'a pas de nom de domaine vérifié
// (leur adresse de test ne peut envoyer qu'à l'adresse du compte
// Resend lui-même) : permet de confirmer manuellement un artiste dont
// on est sûre qu'il possède vraiment son adresse e-mail.
app.post('/api/admin/users/:id/manual-verify', requireAdmin, async (req, res) => {
  const { data: user } = await supabase.from('users').select('verification_token').eq('id', req.params.id).maybeSingle();
  // On garde (ou on crée) un jeton de vérification : il servira au renvoi
  // automatique du vrai e-mail de confirmation 3 jours après cette
  // validation manuelle, si le compte n'a toujours pas cliqué le vrai lien.
  const token = (user && user.verification_token) || crypto.randomBytes(24).toString('hex');
  await supabase
    .from('users')
    .update({ email_verified: true, manual_verified_at: Date.now(), verification_token: token, reverify_email_sent_at: null })
    .eq('id', req.params.id);
  res.json({ ok: true });
});

// Badge "Compte vérifié" (identité réelle confirmée à la main par
// l'administratrice, par exemple via un lien vers un profil officiel déjà
// connu sous ce nom) — bascule simple, pas de demande ni de document stocké.
app.post('/api/admin/users/:id/toggle-verified', requireAdmin, async (req, res) => {
  const { data: user } = await supabase.from('users').select('identity_verified').eq('id', req.params.id).maybeSingle();
  if (!user) return res.status(404).json({ error: 'not_found' });
  await supabase.from('users').update({ identity_verified: !user.identity_verified }).eq('id', req.params.id);
  res.json({ ok: true, identityVerified: !user.identity_verified });
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
  res.setHeader('Content-Disposition', 'attachment; filename="risuona-mes-donnees.json"');
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

// --- Annonces temporaires et message de bienvenue ---
// Une seule table "announcements" :
//  - kind 'announcement' : bandeau temporaire, visible jusqu'à ends_at,
//    pour un public choisi (tout le monde, membres, artistes, comptes
//    d'écoute, ou visiteurs non connectés) ;
//  - kind 'welcome' : une seule ligne, le message de bienvenue montré à
//    chaque nouveau compte pendant ses premiers jours.
// Chaque personne peut fermer un message ; ce choix est gardé sur son
// appareil (côté site), rien n'est stocké ici.
const ANNOUNCEMENT_AUDIENCES = ['all', 'members', 'artists', 'listeners', 'visitors'];
const ANNOUNCEMENT_DURATIONS = [1, 3, 7, 14, 30];
const WELCOME_DAYS = 30;
const ANNOUNCEMENT_MAX_LENGTH = 1000;

function mapAnnouncement(a) {
  return {
    id: a.id,
    kind: a.kind,
    audience: a.audience,
    messages: { fr: a.message_fr || '', en: a.message_en || '', es: a.message_es || '' },
    endsAt: a.ends_at ? Number(a.ends_at) : null,
    createdAt: Number(a.created_at),
  };
}

function cleanMessage(value) {
  return String(value || '').trim().slice(0, ANNOUNCEMENT_MAX_LENGTH);
}

// Ce que la personne qui regarde le site doit voir.
app.get('/api/announcements', async (req, res) => {
  const now = Date.now();
  const { data: rows, error } = await supabase.from('announcements').select('*');
  if (error) return res.json({ announcements: [], viewerId: null }); // table pas encore créée
  let viewer = null;
  if (req.session.userId) {
    const { data } = await supabase.from('users').select('id, role, account_type, created_at').eq('id', req.session.userId).maybeSingle();
    viewer = data || null;
  }
  const isMember = !!viewer;
  const isAdminViewer = isMember && viewer.role === 'admin';
  const isArtist = isMember && !isAdminViewer && viewer.account_type !== 'fan';
  const isListener = isMember && !isAdminViewer && viewer.account_type === 'fan';

  const visible = (rows || []).filter((a) => {
    if (a.kind === 'welcome') {
      return isMember && !isAdminViewer && !!a.message_fr && now - Number(viewer.created_at) < WELCOME_DAYS * DAY_MS;
    }
    if (a.ends_at && Number(a.ends_at) <= now) return false;
    if (a.audience === 'all') return true;
    if (a.audience === 'members') return isMember;
    if (a.audience === 'artists') return isArtist || isAdminViewer; // l'admin voit tout, pour vérifier
    if (a.audience === 'listeners') return isListener || isAdminViewer;
    if (a.audience === 'visitors') return !isMember;
    return false;
  });
  visible.sort((a, b) => (a.kind === 'welcome' ? -1 : 0) - (b.kind === 'welcome' ? -1 : 0) || Number(b.created_at) - Number(a.created_at));
  res.json({ announcements: visible.map(mapAnnouncement), viewerId: viewer ? viewer.id : null });
});

app.get('/api/admin/announcements', requireAdmin, async (req, res) => {
  const { data: rows, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'announcements_table_missing' });
  const now = Date.now();
  const welcome = (rows || []).find((a) => a.kind === 'welcome');
  const active = (rows || []).filter((a) => a.kind === 'announcement' && (!a.ends_at || Number(a.ends_at) > now));
  res.json({ welcome: welcome ? mapAnnouncement(welcome) : null, announcements: active.map(mapAnnouncement) });
});

app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
  const messageFr = cleanMessage(req.body.messageFr);
  const audience = ANNOUNCEMENT_AUDIENCES.includes(req.body.audience) ? req.body.audience : 'all';
  const days = ANNOUNCEMENT_DURATIONS.includes(Number(req.body.durationDays)) ? Number(req.body.durationDays) : 7;
  if (!messageFr) return res.status(400).json({ error: 'missing_fields' });
  const now = Date.now();
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      kind: 'announcement',
      audience,
      message_fr: messageFr,
      message_en: cleanMessage(req.body.messageEn),
      message_es: cleanMessage(req.body.messageEs),
      ends_at: now + days * DAY_MS,
      created_at: now,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  res.json({ ok: true, announcement: mapAnnouncement(data) });
});

app.delete('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  await supabase.from('announcements').delete().eq('id', req.params.id).eq('kind', 'announcement');
  res.json({ ok: true });
});

// Enregistre (ou désactive, si le texte français est vide) le message de bienvenue.
app.put('/api/admin/welcome', requireAdmin, async (req, res) => {
  const fields = {
    message_fr: cleanMessage(req.body.messageFr),
    message_en: cleanMessage(req.body.messageEn),
    message_es: cleanMessage(req.body.messageEs),
  };
  const { data: existing, error: readError } = await supabase.from('announcements').select('id').eq('kind', 'welcome').maybeSingle();
  if (readError) return res.status(500).json({ error: 'announcements_table_missing' });
  let error;
  if (existing) {
    ({ error } = await supabase.from('announcements').update(fields).eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('announcements').insert({ ...fields, kind: 'welcome', audience: 'members', created_at: Date.now() }));
  }
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  res.json({ ok: true });
});

// Gestion des erreurs multer (fichier trop lourd, mauvais type…)
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'file_too_large' });
  if (err) return res.status(400).json({ error: 'upload_error', message: err.message });
  next();
});

// --- Renvoi automatique de vérification après une validation manuelle ---
// La validation manuelle admin (manual-verify) débloque tout de suite le
// compte, mais on veut quand même une preuve que l'adresse appartient
// vraiment à la personne (utile en cas de litige : CGU, vol de morceau).
// 3 jours après une validation manuelle, si le vrai lien n'a toujours pas
// été cliqué, on renvoie le vrai e-mail de vérification — une seule fois
// par validation manuelle (reverify_email_sent_at évite les renvois en
// boucle à chaque passage de cette vérification périodique).
const REVERIFY_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
const REVERIFY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // toutes les 6h
async function checkPendingReverifications() {
  if (!resendClient.isConfigured()) return;
  const threshold = Date.now() - REVERIFY_DELAY_MS;
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, artist_name, verification_token')
    .eq('verified_via_link', false)
    .is('reverify_email_sent_at', null)
    .not('manual_verified_at', 'is', null)
    .lte('manual_verified_at', threshold);
  if (error || !users || !users.length) return;
  const siteUrl = process.env.SITE_URL || 'https://risuonamusic.com';
  for (const user of users) {
    const token = user.verification_token || crypto.randomBytes(24).toString('hex');
    if (!user.verification_token) await supabase.from('users').update({ verification_token: token }).eq('id', user.id);
    resendClient.sendVerificationEmail(user.email, user.artist_name, token, siteUrl);
    await supabase.from('users').update({ reverify_email_sent_at: Date.now() }).eq('id', user.id);
  }
}
setInterval(checkPendingReverifications, REVERIFY_CHECK_INTERVAL_MS);
checkPendingReverifications();

app.listen(PORT, () => {
  console.log(`Risuona écoute sur http://localhost:${PORT}`);
});
