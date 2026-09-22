// Client pour Resend (envoi d'e-mails) — sert à prévenir l'administratrice
// par e-mail à chaque nouvelle inscription d'artiste. Reste inactif tant
// que RESEND_API_KEY n'est pas renseigné dans .env — même principe que
// labelgrid.js, stripeClient.js et soundcloudClient.js.

const API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
// Adresse d'expéditeur de test fournie par Resend, fonctionne sans nom
// de domaine à toi. Le jour où tu as un domaine, remplace-la par une
// adresse "contact@tondomaine.fr" (à vérifier dans Resend au préalable).
const FROM_ADDRESS = process.env.RESEND_FROM || 'Résonance <onboarding@resend.dev>';

function isConfigured() {
  return !!(API_KEY && ADMIN_EMAIL);
}

async function notifyNewSignup(artistName, email) {
  if (!isConfigured()) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: ADMIN_EMAIL,
        subject: 'Nouvel artiste inscrit sur Résonance',
        text: 'Un nouvel artiste vient de créer un compte sur Résonance :\n\nNom d\'artiste : ' + artistName + '\nE-mail : ' + email,
      }),
    });
  } catch (err) {
    // Silencieux : un e-mail de notification qui échoue ne doit jamais
    // empêcher une inscription de réussir.
  }
}

module.exports = { isConfigured, notifyNewSignup };
