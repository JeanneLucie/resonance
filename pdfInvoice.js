// Modèle de facture PDF — SQUELETTE réutilisable, pas encore branché
// nulle part. À anticiper avant l'activation réelle de Stripe, pour la
// conservation comptable (10 ans). Approuvé dans le principe, mais les
// détails exacts (champs légaux à faire figurer, déclencheur de
// génération, numérotation) restent à préciser par Cindy — ce fichier ne
// les invente pas, il pose juste la mécanique de génération du PDF à
// partir de données déjà prêtes.
//
// TODO (à préciser avant la mise en service réelle) :
//  - Coordonnées légales de l'émettrice (Risuona) à faire figurer sur
//    chaque facture : nom/raison sociale, adresse, numéro SIRET, mention
//    de TVA (auto-entreprise "TVA non applicable, art. 293 B du CGI" ou
//    taux applicable si le statut change).
//  - Règle de numérotation des factures (doit être continue et
//    chronologique, sans trou, par obligation comptable).
//  - Déclencheur : génération à quel moment précis (webhook Stripe de
//    paiement réussi ? action manuelle admin ?) et où le PDF est stocké
//    ensuite pour la conservation 10 ans (Supabase Storage vraisemblable,
//    à confirmer).
//  - Mentions obligatoires propres à Risuona selon le service facturé
//    (distribution, abonnement...), une fois ces offres définies.
//
// En attendant ces précisions, generateInvoicePdf() prend des données
// déjà toutes prêtes (rien n'est déduit ni inventé ici) et rend un PDF
// simple et lisible.

const PDFDocument = require('pdfkit');

/**
 * @param {Object} invoice
 * @param {string} invoice.invoiceNumber - Numéro de facture (déjà attribué par l'appelant).
 * @param {string|Date} invoice.date - Date d'émission.
 * @param {{name: string, address?: string, extra?: string}} invoice.seller - Coordonnées de l'émettrice (Risuona).
 * @param {{name: string, email?: string, address?: string}} invoice.buyer - Coordonnées de la personne facturée.
 * @param {Array<{description: string, amount: number}>} invoice.lines - Lignes de facturation (montants en euros).
 * @param {number} invoice.total - Montant total (euros).
 * @param {string} [invoice.notes] - Mentions complémentaires (légales ou autres).
 * @returns {Promise<Buffer>} Le PDF généré, prêt à être envoyé ou stocké.
 */
function generateInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dateStr = invoice.date instanceof Date ? invoice.date.toLocaleDateString('fr-FR') : String(invoice.date || '');

      doc.fontSize(20).text('Facture', { align: 'right' });
      doc.fontSize(10).fillColor('#666').text('N° ' + (invoice.invoiceNumber || ''), { align: 'right' });
      doc.text(dateStr, { align: 'right' });
      doc.moveDown(2);

      doc.fillColor('#000').fontSize(11);
      doc.text(invoice.seller && invoice.seller.name ? invoice.seller.name : 'Risuona');
      if (invoice.seller && invoice.seller.address) doc.text(invoice.seller.address);
      if (invoice.seller && invoice.seller.extra) doc.fontSize(9).fillColor('#666').text(invoice.seller.extra).fillColor('#000').fontSize(11);
      doc.moveDown();

      doc.text('Facturé à :');
      doc.text(invoice.buyer && invoice.buyer.name ? invoice.buyer.name : '');
      if (invoice.buyer && invoice.buyer.email) doc.text(invoice.buyer.email);
      if (invoice.buyer && invoice.buyer.address) doc.text(invoice.buyer.address);
      doc.moveDown(2);

      // Tableau des lignes (très simple, sans TVA détaillée tant que le
      // statut fiscal exact n'est pas confirmé — voir TODO en tête de fichier).
      const tableTop = doc.y;
      doc.font('Helvetica-Bold');
      doc.text('Description', 50, tableTop);
      doc.text('Montant', 450, tableTop, { width: 90, align: 'right' });
      doc.font('Helvetica');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.5);

      (invoice.lines || []).forEach((line) => {
        const y = doc.y;
        doc.text(line.description || '', 50, y, { width: 380 });
        doc.text(formatEuros(line.amount), 450, y, { width: 90, align: 'right' });
        doc.moveDown(0.5);
      });

      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('Total : ' + formatEuros(invoice.total), { align: 'right' });
      doc.font('Helvetica');

      if (invoice.notes) {
        doc.moveDown(2).fontSize(9).fillColor('#666').text(invoice.notes);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function formatEuros(amount) {
  return Number(amount || 0).toFixed(2).replace('.', ',') + ' €';
}

module.exports = { generateInvoicePdf };
