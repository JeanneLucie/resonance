// --- Pochettes générées automatiquement ---
// Quand un artiste publie sans image, on dessine une pochette dans le style
// validé par Cindy :
//  - fond des aperçus v5/v6 : base sombre + halos de couleur + vignettage ;
//  - option A : des traits colorés qui traversent le fond (ici des traits
//    droits et bien marqués, plus affirmés que dans l'aperçu v6) ;
//  - en bas, UN SEUL bloc centré : badge « R », fine ligne dorée, titre et
//    nom d'artiste (impossible de recadrer Risuona sans couper le titre).
//
// Tout est tiré d'une "graine" (un nombre) : même graine = même pochette.
// Le bouton "Générer un autre visuel" tire simplement une nouvelle graine.
(function (global) {
  const BASES = ['#1B1626', '#141F1C', '#221319', '#131A28', '#1C1626'];
  const ORB_COLORS = [
    ['#F2A65A', '#E0654F'], ['#5FC7B8', '#3E9E92'], ['#B892E8', '#7C5FC4'],
    ['#6FA3E0', '#4A72C4'], ['#E884A8', '#C6497B'], ['#8FD16C', '#5AA83E'], ['#F2C15A', '#D68C2E'],
  ];

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

  // Graine par défaut tirée du titre (comme dans les aperçus).
  function seedFromText(s) {
    let h = 5381;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Mode « initiales » : "Marine Dax" -> "M.D." ; un nom d'un seul mot
  // ("Luxcine") reste entier, comme validé dans l'aperçu v5.
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return parts.map((p) => p.charAt(0).toUpperCase() + '.').join('');
    return String(name || '').trim();
  }

  // Réduit la police jusqu'à ce que le texte tienne, puis coupe avec "…".
  function fitLine(ctx, text, maxWidth, size, minSize, weight, family) {
    let s = size;
    ctx.font = weight + ' ' + s + 'px ' + family;
    while (ctx.measureText(text).width > maxWidth && s > minSize) {
      s -= 1;
      ctx.font = weight + ' ' + s + 'px ' + family;
    }
    let out = text;
    if (ctx.measureText(out).width > maxWidth) {
      while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
      out = out.trimEnd() + '…';
    }
    return out;
  }

  function drawBackground(ctx, size, rand, pairs) {
    ctx.fillStyle = BASES[Math.floor(rand() * BASES.length)];
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    pairs.forEach((pair) => {
      const cx = size * (0.15 + rand() * 0.7);
      const cy = size * (0.15 + rand() * 0.7);
      const r = size * (0.45 + rand() * 0.25);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, pair[0] + 'CC');
      grad.addColorStop(0.55, pair[1] + '66');
      grad.addColorStop(1, pair[1] + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // Traits droits qui traversent toute l'image, en une ou deux directions
  // (quand il y en a deux, ils se croisent). Couleurs prises dans les halos
  // du morceau pour rester cohérent.
  function drawLines(ctx, size, rand, pairs) {
    const diag = size * 1.5;
    const families = rand() < 0.7 ? 2 : 1;
    const baseAngle = (rand() - 0.5) * Math.PI * 0.9;
    for (let f = 0; f < families; f++) {
      const angle = baseAngle + f * (Math.PI / 3 + rand() * Math.PI / 4);
      const n = 4 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const offset = (rand() - 0.5) * size * 1.1;
        // Épaisseur plafonnée : pas de bande trop grosse qui écrase l'image.
        const width = size * Math.min(0.008 + Math.pow(rand(), 2) * 0.08, 0.045);
        const pair = pairs[Math.floor(rand() * pairs.length)];
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.rotate(angle + (rand() - 0.5) * 0.12);
        ctx.globalAlpha = 0.5 + rand() * 0.4;
        ctx.globalCompositeOperation = rand() < 0.5 ? 'screen' : 'source-over';
        ctx.fillStyle = rand() < 0.6 ? pair[0] : pair[1];
        ctx.fillRect(-diag / 2, offset - width / 2, diag, width);
        ctx.restore();
      }
    }

    // Quelques lignes très fines dans une troisième direction, différente
    // des deux autres : elles croisent le motif et le rendent unique.
    const fineAngle = baseAngle - (Math.PI * 0.19 + rand() * Math.PI * 0.12);
    const fineCount = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < fineCount; i++) {
      const offset = (rand() - 0.5) * size * 1.2;
      const width = size * (0.0015 + rand() * 0.003);
      const pair = pairs[Math.floor(rand() * pairs.length)];
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(fineAngle + (rand() - 0.5) * 0.08);
      ctx.globalAlpha = 0.6 + rand() * 0.35;
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = rand() < 0.35 ? '#F3EFE6' : pair[0];
      ctx.fillRect(-diag / 2, offset - width / 2, diag, width);
      ctx.restore();
    }
  }

  function drawVignette(ctx, size) {
    const vign = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.72);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, size, size);
    // Léger assombrissement du bas, pour que le titre reste lisible
    // même quand un trait épais passe derrière.
    const bottom = ctx.createLinearGradient(0, size * 0.58, 0, size);
    bottom.addColorStop(0, 'rgba(0,0,0,0)');
    bottom.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, size * 0.58, size, size * 0.42);
  }

  function drawLogo(ctx, cx, cy, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = r * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.12;
    ctx.strokeStyle = '#E8964A';
    ctx.stroke();
    ctx.shadowBlur = r * 0.25;
    ctx.fillStyle = '#F3EFE6';
    ctx.font = '700 ' + Math.round(r * 1.35) + 'px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', cx, cy + r * 0.06);
    ctx.restore();
  }

  // Dessine la pochette sur un contexte 2D carré de côté `size`.
  // opts : { seed, title, artist }  (artist = texte déjà prêt à afficher)
  function draw(ctx, size, opts) {
    const title = String(opts.title || '').trim() || '—';
    const seed = opts.seed != null ? opts.seed : seedFromText(title);
    const rand = makeRandom(seed);
    const pairs = [];
    const pool = ORB_COLORS.slice();
    for (let i = 0; i < 3; i++) pairs.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);

    drawBackground(ctx, size, rand, pairs);
    drawLines(ctx, size, rand, pairs);
    drawVignette(ctx, size);

    // Bloc du bas, centré (mise en page de l'aperçu v5).
    const logoR = size * 0.045;
    const artistY = size * 0.9;
    const titleY = artistY - size * 0.06;
    const lineY = titleY - size * 0.058;
    const logoY = lineY - logoR - size * 0.02;
    const maxW = size * 0.84;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawLogo(ctx, size / 2, logoY, logoR);

    ctx.save();
    ctx.strokeStyle = 'rgba(232,150,74,0.85)';
    ctx.lineWidth = size * 0.004;
    ctx.beginPath();
    ctx.moveTo(size / 2 - size * 0.06, lineY);
    ctx.lineTo(size / 2 + size * 0.06, lineY);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = size * 0.025;
    ctx.shadowOffsetY = size * 0.006;
    ctx.fillStyle = '#F8F5EE';
    const t = fitLine(ctx, title, maxW, Math.round(size * 0.066), Math.round(size * 0.045), '700', 'Georgia, serif');
    ctx.fillText(t, size / 2, titleY);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    const a = fitLine(ctx, String(opts.artist || '').trim(), maxW, Math.round(size * 0.034), Math.round(size * 0.026), '400', '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif');
    ctx.fillText(a, size / 2, artistY);
    ctx.restore();
  }

  function render(opts, size) {
    size = size || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext('2d'), size, opts);
    return canvas;
  }

  // Fichier JPEG prêt à être envoyé comme pochette.
  async function toFile(opts) {
    const canvas = render(opts, 1080);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return new File([blob], 'pochette-risuona.jpg', { type: 'image/jpeg' });
  }

  global.RisuonaCover = { draw, render, toFile, initials, randomSeed, seedFromText };
})(window);
