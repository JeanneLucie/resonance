require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { readDb, writeDb, nextId } = require('./db');
const labelgrid = require('./labelgrid');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-.env';

// --- Config upload audio ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 25 Mo par fichier
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('audio/')) {
      return cb(new Error('Seuls les fichiers audio sont acceptés.'));
    }
    cb(null, true);
  },
});

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 jours
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  const db = readDb();
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

// --- Auth ---
app.post('/api/signup', async (req, res) => {
  const { artistName, email, password } = req.body;
  if (!artistName || !email || !password) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }
  const db = readDb();
  const exists = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'email_taken' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  // Le compte dont l'e-mail correspond à ADMIN_EMAIL (défini dans .env)
  // devient automatiquement administrateur, une seule fois à la création.
  const role = ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'artist';
  const user = {
    id: nextId(db.users),
    artistName,
    email,
    passwordHash,
    role,
    bio: '',
    donationLink: '',
    spotifyUrl: '',
    appleUrl: '',
    soundcloudUrl: '',
    instagramUrl: '',
    createdAt: Date.now(),
  };
  db.users.push(user);
  writeDb(db);
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDb();
  const user = db.users.find((u) => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const db = readDb();
  const user = db.users.find((u) => u.id === req.session.userId);
  res.json({ user: user ? publicUser(user) : null });
});

app.put('/api/me', requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'not_found' });
  const fields = ['artistName', 'bio', 'donationLink', 'spotifyUrl', 'appleUrl', 'soundcloudUrl', 'instagramUrl'];
  fields.forEach((f) => {
    if (typeof req.body[f] === 'string') user[f] = req.body[f];
  });
  writeDb(db);
  res.json({ ok: true, user: publicUser(user) });
});

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

// --- Morceaux ---
app.get('/api/tracks', (req, res) => {
  const db = readDb();
  const tracks = db.tracks
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((t) => {
      const artist = db.users.find((u) => u.id === t.userId);
      return {
        ...t,
        artistName: artist ? artist.artistName : 'Artiste supprimé',
        donationLink: artist ? artist.donationLink : '',
        spotifyUrl: artist ? artist.spotifyUrl : '',
        appleUrl: artist ? artist.appleUrl : '',
        soundcloudUrl: artist ? artist.soundcloudUrl : '',
        instagramUrl: artist ? artist.instagramUrl : '',
      };
    });
  res.json({ tracks });
});

app.get('/api/me/tracks', requireAuth, (req, res) => {
  const db = readDb();
  const tracks = db.tracks
    .filter((t) => t.userId === req.session.userId)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ tracks });
});

app.post('/api/tracks', requireAuth, upload.single('audio'), (req, res) => {
  const { title, genre, aiLevel, aiTool } = req.body;
  if (!title || !req.file) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const validLevels = ['none', 'assisted', 'generated'];
  const db = readDb();
  const track = {
    id: nextId(db.tracks),
    userId: req.session.userId,
    title,
    genre: genre || '',
    aiLevel: validLevels.includes(aiLevel) ? aiLevel : 'none',
    aiTool: aiTool ? String(aiTool).slice(0, 60) : '',
    audioUrl: '/uploads/' + req.file.filename,
    createdAt: Date.now(),
  };
  db.tracks.push(track);
  writeDb(db);
  res.json({ ok: true, track });
});

app.delete('/api/tracks/:id', requireAuth, (req, res) => {
  const db = readDb();
  const idx = db.tracks.findIndex((t) => t.id === Number(req.params.id) && t.userId === req.session.userId);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const [removed] = db.tracks.splice(idx, 1);
  writeDb(db);
  const filePath = path.join(uploadsDir, path.basename(removed.audioUrl));
  fs.unlink(filePath, () => {});
  res.json({ ok: true });
});

// --- Pages artiste publiques + suivi ---
app.get('/api/artists/:id', (req, res) => {
  const db = readDb();
  const artist = db.users.find((u) => u.id === Number(req.params.id));
  if (!artist) return res.status(404).json({ error: 'not_found' });
  const tracks = db.tracks
    .filter((t) => t.userId === artist.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((t) => ({ ...t, artistName: artist.artistName }));
  const followerCount = db.users.filter((u) => (u.followingIds || []).includes(artist.id)).length;
  const isFollowing = req.session.userId
    ? !!(db.users.find((u) => u.id === req.session.userId) || {}).followingIds?.includes(artist.id)
    : false;
  res.json({ artist: publicUser(artist), tracks, followerCount, isFollowing });
});

app.post('/api/artists/:id/follow', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.session.userId) return res.status(400).json({ error: 'cannot_follow_self' });
  const db = readDb();
  const me = db.users.find((u) => u.id === req.session.userId);
  const target = db.users.find((u) => u.id === targetId);
  if (!me || !target) return res.status(404).json({ error: 'not_found' });
  me.followingIds = me.followingIds || [];
  if (!me.followingIds.includes(targetId)) me.followingIds.push(targetId);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/artists/:id/unfollow', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  const db = readDb();
  const me = db.users.find((u) => u.id === req.session.userId);
  if (!me) return res.status(404).json({ error: 'not_found' });
  me.followingIds = (me.followingIds || []).filter((id) => id !== targetId);
  writeDb(db);
  res.json({ ok: true });
});

// --- Distribution externe (Spotify, Apple Music…) via LabelGrid ---
app.get('/api/distribution/status', (req, res) => {
  res.json({ configured: labelgrid.isConfigured() });
});

app.post('/api/tracks/:id/distribute', requireAuth, async (req, res) => {
  if (!labelgrid.isConfigured()) {
    return res.status(503).json({ error: 'not_configured' });
  }
  const db = readDb();
  const track = db.tracks.find((t) => t.id === Number(req.params.id) && t.userId === req.session.userId);
  if (!track) return res.status(404).json({ error: 'not_found' });
  const artist = db.users.find((u) => u.id === req.session.userId);

  try {
    const lgArtist = await labelgrid.ensureArtist({ name: artist.artistName });
    const release = await labelgrid.createRelease({
      title: track.title,
      artistId: lgArtist.id,
      releaseDate: new Date().toISOString().slice(0, 10),
    });
    await labelgrid.uploadTrackAudio({
      releaseId: release.id,
      title: track.title,
      audioFilePath: path.join(uploadsDir, path.basename(track.audioUrl)),
    });
    await labelgrid.submitForDistribution(release.id);

    track.distribution = { status: 'submitted', releaseId: release.id, submittedAt: Date.now() };
    writeDb(db);
    res.json({ ok: true, distribution: track.distribution });
  } catch (err) {
    res.status(502).json({ error: 'labelgrid_error', message: err.message });
  }
});

// Reçoit les mises à jour de statut envoyées par LabelGrid (à activer une
// fois le webhook enregistré côté LabelGrid avec l'URL de ce endpoint).
app.post('/api/webhooks/labelgrid', (req, res) => {
  // TODO : vérifier la signature du payload une fois le secret de webhook
  // généré côté LabelGrid (voir leur doc "Webhooks" pour le nom exact de l'en-tête).
  const { releaseId, status } = req.body || {};
  if (releaseId && status) {
    const db = readDb();
    const track = db.tracks.find((t) => t.distribution && t.distribution.releaseId === releaseId);
    if (track) {
      track.distribution.status = status;
      track.distribution.updatedAt = Date.now();
      writeDb(db);
    }
  }
  res.json({ received: true });
});

// --- Administration ---
// Ces routes ne sont accessibles qu'à un compte dont le rôle est "admin".
// Aucune action dans l'application ne permet à un compte de devenir admin :
// ce rôle n'est attribué qu'à la création du tout premier compte dont
// l'e-mail correspond à ADMIN_EMAIL dans le fichier .env du serveur —
// une valeur que seule la personne qui héberge le serveur connaît et
// peut définir. Voir README.md, section "Compte administrateur".

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const db = readDb();
  const users = db.users.map(publicUser);
  const tracks = db.tracks
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((t) => {
      const artist = db.users.find((u) => u.id === t.userId);
      return { ...t, artistName: artist ? artist.artistName : 'Artiste supprimé', artistEmail: artist ? artist.email : '' };
    });
  res.json({ users, tracks });
});

app.delete('/api/admin/tracks/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const idx = db.tracks.findIndex((t) => t.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const [removed] = db.tracks.splice(idx, 1);
  writeDb(db);
  const filePath = path.join(uploadsDir, path.basename(removed.audioUrl));
  fs.unlink(filePath, () => {});
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const db = readDb();
  const targetId = Number(req.params.id);
  if (targetId === req.session.userId) {
    return res.status(400).json({ error: 'cannot_delete_self' });
  }
  const idx = db.users.findIndex((u) => u.id === targetId);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  db.users.splice(idx, 1);
  const removedTracks = db.tracks.filter((t) => t.userId === targetId);
  db.tracks = db.tracks.filter((t) => t.userId !== targetId);
  writeDb(db);
  removedTracks.forEach((t) => fs.unlink(path.join(uploadsDir, path.basename(t.audioUrl)), () => {}));
  res.json({ ok: true });
});

// Gestion des erreurs multer (fichier trop lourd, mauvais type…)
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: 'upload_error', message: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Résonance écoute sur http://localhost:${PORT}`);
});
