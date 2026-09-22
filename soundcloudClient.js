// Client pour l'API SoundCloud — permet à un artiste de connecter son
// propre compte SoundCloud existant à Résonance, pour publier en
// parallèle sans ressaisir. Reste inactif tant que SOUNDCLOUD_CLIENT_ID
// et SOUNDCLOUD_CLIENT_SECRET ne sont pas renseignés dans .env — même
// principe que labelgrid.js et stripeClient.js.
//
// IMPORTANT : l'accès à cette API n'est pas libre chez SoundCloud (il
// faut leur en faire la demande et attendre une validation manuelle,
// parfois longue). Ce fichier ne fait que préparer le terrain — la
// vraie logique de connexion (échange OAuth avec PKCE) est à compléter
// une fois l'accès obtenu, en vérifiant leur documentation à ce
// moment-là, car leur API a déjà changé plusieurs fois par le passé.
//
// À PRÉVOIR dans le vrai parcours de connexion : un artiste peut soit
// déjà avoir un compte SoundCloud (le connecter directement via leur
// page d'autorisation), soit ne pas en avoir du tout — dans ce
// deuxième cas, il faudra le rediriger d'abord vers la création d'un
// compte SoundCloud (gratuit) avant de pouvoir le connecter, plutôt
// que de le laisser bloqué sans explication.

const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;
const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET;

function isConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

module.exports = { isConfigured };
