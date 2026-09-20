// Client pour l'API publique de LabelGrid (distribution vers Spotify,
// Apple Music, etc.). Authentification confirmée par leur documentation :
// un jeton Bearer généré depuis LabelGrid (Profil → API Tokens), envoyé
// dans l'en-tête Authorization de chaque requête.
//
// IMPORTANT : les noms de routes ci-dessous (/api/public/releases, etc.)
// suivent le découpage annoncé publiquement par LabelGrid (releases,
// tracks, artists, webhooks...), mais le détail exact de chaque route et
// des champs attendus n'est visible que dans leur référence interactive
// (api.labelgrid.com/docs/api), accessible une fois connectée. Dès que
// Cindy a son compte + accès sandbox, on ajuste ces chemins et payloads
// pour qu'ils correspondent exactement à la doc réelle.

const BASE_URL = process.env.LABELGRID_BASE_URL || 'https://api.labelgrid.com';
const API_TOKEN = process.env.LABELGRID_API_TOKEN;

async function lgRequest(method, path, body) {
  if (!API_TOKEN) {
    throw new Error('LABELGRID_API_TOKEN manquant dans .env — connecte le compte LabelGrid pour activer la distribution.');
  }
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Erreur LabelGrid (' + res.status + ')');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// --- Catégories documentées par LabelGrid ---
// Chemins à confirmer/ajuster avec api.labelgrid.com/docs/api une fois l'accès obtenu.

async function ensureArtist({ name }) {
  // Doit correspondre à un artiste déjà existant côté LabelGrid, ou en créer un.
  return lgRequest('POST', '/api/public/artists', { name });
}

async function createRelease({ title, artistId, releaseDate }) {
  return lgRequest('POST', '/api/public/releases', { title, artistId, releaseDate });
}

async function uploadTrackAudio({ releaseId, title, audioFilePath }) {
  // NOTE : l'upload de fichier passe probablement par multipart/form-data
  // plutôt que du JSON — à ajuster une fois la référence exacte consultée.
  return lgRequest('POST', '/api/public/releases/' + releaseId + '/tracks', { title, audioFilePath });
}

async function submitForDistribution(releaseId) {
  return lgRequest('POST', '/api/public/releases/' + releaseId + '/submit', {});
}

async function getReleaseStatus(releaseId) {
  return lgRequest('GET', '/api/public/releases/' + releaseId, undefined);
}

module.exports = {
  isConfigured: () => !!API_TOKEN,
  ensureArtist,
  createRelease,
  uploadTrackAudio,
  submitForDistribution,
  getReleaseStatus,
};
