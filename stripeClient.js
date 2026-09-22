// Client pour Stripe (paiements) — permet de faire payer un artiste pour
// débloquer la distribution automatique vers Spotify/Apple Music (le
// coût réel de LabelGrid, reporté sur celui qui en profite).
//
// Reste inactif tant que STRIPE_SECRET_KEY n'est pas renseigné dans
// .env — exactement le même principe que labelgrid.js.

const API_KEY = process.env.STRIPE_SECRET_KEY;
const DISTRIBUTION_FEE_CENTS = Number(process.env.DISTRIBUTION_FEE_CENTS) || 500; // 5,00 € par défaut

let stripe = null;
if (API_KEY) {
  // Chargé seulement si une clé existe, pour ne jamais planter en son absence.
  stripe = require('stripe')(API_KEY);
}

function isConfigured() {
  return !!stripe;
}

async function createDistributionCheckout({ trackId, trackTitle, successUrl, cancelUrl }) {
  if (!stripe) throw new Error('Stripe non configuré.');
  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: 'Distribution Spotify/Apple Music — ' + trackTitle },
          unit_amount: DISTRIBUTION_FEE_CENTS,
        },
        quantity: 1,
      },
    ],
    metadata: { trackId: String(trackId) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

module.exports = { isConfigured, createDistributionCheckout, DISTRIBUTION_FEE_CENTS };
