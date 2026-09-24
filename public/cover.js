// --- Pochettes générées automatiquement ---
// Quand un artiste publie sans image, on dessine une pochette dans le style
// validé : un fond de lignes colorées qui traversent l'image, et en bas UN
// SEUL bloc qui réunit le logo Risuona, le titre et le nom de l'artiste
// (impossible de recadrer l'image sans perdre l'identité du morceau).
//
// Tout est tiré d'une "graine" (un nombre) : même graine = même pochette.
// Le bouton "Générer un autre visuel" tire simplement une nouvelle graine.
(function (global) {
  const INK = '#1E1A2E';
  const INK_SOFT = '#2A2540';
  const TEXT = '#EDE7D9';
  const TEXT_DIM = '#B8B0A0';
  const BRASS = '#D98F3D';
  // Couleurs du site + quelques voisines pour varier les pochettes.
  const PALETTE = ['#D98F3D', '#4FA69B', '#8C6FB0', '#E0B25A', '#C8604A', '#5E8FC4', '#6FBF8E'];

  // Petit générateur pseudo-aléatoire reproductible (mulberry32).
  function makeRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    return Math.floor(Math.random() * 2147483647);
  }

  // "Jeanne Lucie" -> "J.L." ; "DJ Nova-Sol" -> "D.N.S."
  function initials(name) {
    return String(name || '')
      .trim()
      .split(/[\s\-_.]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + '.')
      .join('');
  }

  // Réduit la police jusqu'à ce que le texte tienne, puis coupe avec "…".
  function fitLine(ctx, text, maxWidth, size, minSize, weight, family) {
    let s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    while (ctx.measureText(text).width > maxWidth && s > minSize) {
      s -= 2;
      ctx.font = weight + ' ' + s + 'px ' + family;
    }
    let out = text;
    if (ctx.measureText(out).width > maxWidth) {
      while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
      out = out.trimEnd() + '…';
    }
    return out;
  }

  function drawLines(ctx, size, rand) {
    // 2 ou 3 couleurs par pochette, choisies dans la palette.
    const pool = PALETTE.slice();
    const colors = [];
    const count = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) colors.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);

    // Fond sombre légèrement teinté par la première couleur.
    const bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, INK);
    bg.addColorStop(1, INK_SOFT);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // Deux "familles" de lignes, chacune avec sa direction : elles se
    // croisent, ce qui donne le motif traversant.
    const diag = size * 1.5;
    const families = 1 + (rand() < 0.7 ? 1 : 0);
    const baseAngle = (rand() - 0.5) * Math.PI * 0.9;
    for (let f = 0; f < families; f++) {
      const angle = baseAngle + f * (Math.PI / 3 + rand() * Math.PI / 4);
      const n = 4 + Math.floor(rand() * 5);
      for (let i = 0; i < n; i++) {
        const offset = (rand() - 0.5) * size * 1.1;
        const width = size * (0.008 + Math.pow(rand(), 2) * 0.09);
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.rotate(angle + (rand() - 0.5) * 0.12);
        ctx.globalAlpha = 0.55 + rand() * 0.4;
        ctx.globalCompositeOperation = rand() < 0.5 ? 'screen' : 'source-over';
        ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
        ctx.fillRect(-diag / 2, offset - width / 2, diag, width);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return colors;
  }

  function drawLogo(ctx, cx, cy, r) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.09;
    ctx.strokeStyle = BRASS;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = TEXT;
    ctx.font = '600 ' + Math.round(r * 1.1) + 'px Fraunces, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', cx, cy + r * 0.06);
  }

  // Dessine la pochette sur un contexte 2D carré de côté `size`.
  // opts : { seed, title, artist }
  function draw(ctx, size, opts) {
    const rand = makeRandom(opts.seed || 1);
    const colors = drawLines(ctx, size, rand);

    // Le bloc d'identité, en bas, sur toute la largeur.
    const blockH = Math.round(size * 0.24);
    const blockY = size - blockH;
    ctx.fillStyle = INK;
    ctx.fillRect(0, blockY, size, blockH);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, blockY, size, Math.max(2, Math.round(size * 0.006)));

    const pad = size * 0.06;
    const logoR = blockH * 0.27;
    drawLogo(ctx, pad + logoR, blockY + blockH / 2, logoR);

    const textX = pad + logoR * 2 + size * 0.045;
    const textW = size - textX - pad;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const title = String(opts.title || '').trim() || '—';
    ctx.fillStyle = TEXT;
    const t = fitLine(ctx, title, textW, Math.round(size * 0.075), Math.round(size * 0.056), '600', 'Fraunces, serif');
    ctx.fillText(t, textX, blockY + blockH * 0.5);

    const artist = String(opts.artist || '').trim();
    ctx.fillStyle = TEXT_DIM;
    const a = fitLine(ctx, artist, textW, Math.round(size * 0.042), Math.round(size * 0.03), '400', '"IBM Plex Sans", sans-serif');
    ctx.fillText(a, textX, blockY + blockH * 0.5 + size * 0.062);
  }

  // Attend les polices du site, dessine et renvoie un canvas prêt.
  async function render(opts, size) {
    size = size || 1080;
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load('600 40px Fraunces'),
          document.fonts.load('400 20px "IBM Plex Sans"'),
        ]);
      } catch (e) {
        // Police indisponible : le navigateur prendra la police de secours.
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext('2d'), size, opts);
    return canvas;
  }

  // Fichier JPEG prêt à être envoyé comme pochette.
  async function toFile(opts) {
    const canvas = await render(opts, 1080);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return new File([blob], 'pochette-risuona.jpg', { type: 'image/jpeg' });
  }

  global.RisuonaCover = { draw, render, toFile, initials, randomSeed };
})(window);
