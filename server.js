require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const supabase = require('./supabaseClient');
const labelgrid = require('./labelgrid');
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
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 jours
  })
);

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
    followingIds: u.following_ids || [],
  };
}

function mapTrack(t, artistName) {
  return {
    id: t.id,
    userId: t.user_id,
    title: t.title,
    genre: t.genre,
    aiLevel: t.ai_level,
    aiTool: t.ai_tool,
    audioUrl: t.audio_url,
    coverUrl: t.cover_url || '',
    collaborators: t.collaborators || '',
    genesis: t.genesis || '',
    explicit: !!t.explicit,
    distribution: t.distribution,
    createdAt: Number(t.created_at),
    artistName,
  };
}

// --- Auth ---
app.post('/api/signup', async (req, res) => {
  const { artistName, email, password } = req.body;
  if (!artistName || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

  const { data: existing } = await supabase.from('users').select('id').ilike('email', email).maybeSingle();
  if (existing) return res.status(409).json({ error: 'email_taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'artist';

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      artist_name: artistName,
      email,
      password_hash: passwordHash,
      role,
      created_at: Date.now(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
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
      spotifyUrl: u ? u.spotify_url : '',
      appleUrl: u ? u.apple_url : '',
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
  const { title, genre, aiLevel, aiTool, collaborators, genesis, explicit } = req.body;
  const audioFile = req.files && req.files.audio && req.files.audio[0];
  const coverFile = req.files && req.files.cover && req.files.cover[0];
  if (!title || !audioFile) return res.status(400).json({ error: 'missing_fields' });

  const audioUrl = await uploadToStorage(audioFile);
  const coverUrl = coverFile ? await uploadToStorage(coverFile) : '';

  const { data: track, error } = await supabase
    .from('tracks')
    .insert({
      user_id: req.session.userId,
      title,
      genre: genre || '',
      ai_level: aiLevel || 'none',
      ai_tool: aiTool || '',
      audio_url: audioUrl,
      cover_url: coverUrl,
      collaborators: collaborators || '',
      genesis: genesis || '',
      explicit: explicit === 'true' || explicit === true,
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
  if (req.body.aiLevel !== undefined) fields.ai_level = req.body.aiLevel;
  if (req.body.aiTool !== undefined) fields.ai_tool = req.body.aiTool;
  if (req.body.collaborators !== undefined) fields.collaborators = req.body.collaborators;
  if (req.body.genesis !== undefined) fields.genesis = req.body.genesis;
  if (req.body.explicit !== undefined) fields.explicit = req.body.explicit === 'true' || req.body.explicit === true;

  const coverFile = req.files && req.files.cover && req.files.cover[0];
  if (coverFile) {
    fields.cover_url = await uploadToStorage(coverFile);
    if (track.cover_url) removeFromStorage(track.cover_url);
  }

  const { data: updated, error } = await supabase.from('tracks').update(fields).eq('id', track.id).select().single();
  if (error) return res.status(500).json({ error: 'server_error', message: error.message });
  res.json({ ok: true, track: mapTrack(updated) });
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
    artist: publicUser(artist),
    tracks: (tracks || []).map((t) => ({
      ...mapTrack(t, artist.artist_name),
      donationLink: artist.donation_link,
      spotifyUrl: artist.spotify_url,
      appleUrl: artist.apple_url,
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
