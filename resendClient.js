// Client pour Resend (envoi d'e-mails) — sert à prévenir l'administratrice
// par e-mail à chaque nouvelle inscription d'artiste. Reste inactif tant
// que RESEND_API_KEY n'est pas renseigné dans .env — même principe que
// labelgrid.js, stripeClient.js et soundcloudClient.js.

const API_KEY = process.env.RESEND_API_KEY;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
// Adresse d'expéditeur de test fournie par Resend, fonctionne sans nom
// de domaine à toi. Le jour où tu as un domaine, remplace-la par une
// adresse "contact@tondomaine.fr" (à vérifier dans Resend au préalable).
const FROM_ADDRESS = process.env.RESEND_FROM || 'Risuona <onboarding@resend.dev>';

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
        subject: 'Nouvel artiste inscrit sur Risuona',
        text: 'Un nouvel artiste vient de créer un compte sur Risuona :\n\nNom d\'artiste : ' + artistName + '\nE-mail : ' + email,
      }),
    });
  } catch (err) {
    // Silencieux : un e-mail de notification qui échoue ne doit jamais
    // empêcher une inscription de réussir.
  }
}

// Envoie le lien de confirmation d'adresse e-mail à un artiste qui
// vient de s'inscrire (ou qui en redemande un). Si Resend n'est pas
// configuré, on ne peut pas vérifier les adresses — dans ce cas
// l'appelant doit traiter le compte comme automatiquement "vérifié"
// plutôt que de bloquer indéfiniment quelqu'un sans solution.
async function sendVerificationEmail(email, artistName, token, siteUrl) {
  if (!isConfigured()) return;
  const verifyUrl = siteUrl + '/api/verify-email?token=' + token;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: email,
        subject: 'Confirme ton adresse e-mail sur Risuona',
        text:
          'Salut ' + artistName + ' !\n\nPour confirmer que cette adresse e-mail t\'appartient bien, clique sur ce lien :\n' +
          verifyUrl +
          '\n\nSi tu n\'es pas à l\'origine de cette inscription, ignore simplement ce message.',
      }),
    });
  } catch (err) {
    // Silencieux, même logique que pour la notification admin.
  }
}

module.exports = { isConfigured, notifyNewSignup, sendVerificationEmail, notifyExportRequest, notifyNewMessage, sendReplyToVisitor, notifySuspiciousLogin };

async function notifySuspiciousLogin(email) {
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
        to: email,
        subject: 'Plusieurs tentatives de connexion sur ton compte Risuona',
        text:
          'Plusieurs tentatives de connexion ratées ont eu lieu sur ton compte Risuona, ce qui a temporairement bloqué les connexions pendant 30 minutes.\n\n' +
          'Si c\'était bien toi (mot de passe oublié, faute de frappe), pas d\'inquiétude, tu pourras réessayer une fois ce délai passé.\n\n' +
          'Si ce n\'était pas toi, ton mot de passe n\'a pas été compromis (aucune tentative n\'a réussi), mais tu peux le changer par précaution une fois reconnectée.',
      }),
    });
  } catch (err) {
    // Silencieux.
  }
}

async function notifyNewMessage(artistEmail, artistName, visitorName, visitorEmail, messageBody) {
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
        to: artistEmail,
        subject: 'Nouveau message sur ta page Risuona',
        text:
          (visitorName ? visitorName : 'Quelqu\'un') + ' t\'a écrit sur Risuona :\n\n"' + messageBody + '"\n\n' +
          'Connecte-toi sur Risuona, dans "Mon espace" → "Mes messages", pour lire et répondre directement depuis le site (ta réponse partira sans jamais révéler ton adresse e-mail à cette personne).',
      }),
    });
  } catch (err) {
    // Silencieux.
  }
}

async function sendReplyToVisitor(visitorEmail, artistName, replyBody) {
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
        to: visitorEmail,
        subject: artistName + ' t\'a répondu sur Risuona',
        text:
          artistName + ' t\'a répondu sur Risuona :\n\n"' + replyBody + '"\n\n' +
          'Ce message t\'a été transmis par Risuona, pour préserver la vie privée de l\'artiste.',
      }),
    });
  } catch (err) {
    // Silencieux.
  }
}

async function notifyExportRequest(artistName, email) {
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
        subject: 'Demande d\'export de données sur Risuona',
        text:
          artistName + ' (' + email + ') a demandé à récupérer ses données sur Risuona.\n\n' +
          'Va dans Administration → Artistes inscrits pour activer une fenêtre de téléchargement de 48h pour ce compte.',
      }),
    });
  } catch (err) {
    // Silencieux.
  }
}
