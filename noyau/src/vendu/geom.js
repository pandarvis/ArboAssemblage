// Géométrie du dessin : transformations SVG, lecture des tracés, polygones.
// Les courbes et les arcs sont aplatis en segments. Chaque point est [x, y, noeud] :
// noeud vaut 1 pour un vrai nœud Inkscape, 0 pour un point intermédiaire de courbe.

export const IDENT = [1, 0, 0, 1, 0, 0];

/** Composition : applique d'abord c, puis p (convention SVG [a b c d e f]). */
export function mul(p, c) {
  return [
    p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}
export const appliquer = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const appliquerVecteur = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
export const echelle = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

export function inverser(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) throw new Error('transformation non inversible');
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const NOMBRE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const NOMBRES = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
export const nombres = s => (String(s ?? '').match(NOMBRES) || []).map(Number);

export function lireTransformation(str) {
  let m = IDENT;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r;
  while ((r = re.exec(str))) {
    const a = nombres(r[2]);
    let t = IDENT;
    switch (r[1]) {
      case 'matrix': if (a.length === 6) t = a; break;
      case 'translate': t = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const g = (a[0] || 0) * Math.PI / 180, c = Math.cos(g), s = Math.sin(g);
        t = [c, s, -s, c, 0, 0];
        if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': t = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}

/** Lit l'attribut d d'un <path>. Renvoie [{ pts, closed }], une entrée par sous-tracé. tol : flèche maximale des courbes. */
export function lireTrace(d, tol = 0.02) {
  const s = String(d ?? '');
  const n = s.length;
  const sous = [];
  let i = 0, cmd = '', cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let cx = null, cy = null, qx = null, qy = null;   // derniers points de contrôle, pour S et T

  const blancs = () => { while (i < n && ' ,\n\r\t'.includes(s[i])) i++; };
  const nombre = () => {
    blancs();
    NOMBRE.lastIndex = i;
    const r = NOMBRE.exec(s);
    if (!r) throw new Error(`tracé illisible près de « ${s.slice(i, i + 16)} »`);
    i = NOMBRE.lastIndex;
    return +r[0];
  };
  const drapeau = () => {
    blancs();
    const c = s[i];
    if (c !== '0' && c !== '1') throw new Error('arc illisible');
    i++;
    return c === '1';
  };
  const debut = (px, py) => { cur = { pts: [[px, py, 1]], closed: false }; sous.push(cur); };
  const vers = (px, py, noeud) => { if (!cur || cur.closed) debut(x, y); cur.pts.push([px, py, noeud]); };

  function cubique(x0, y0, x1, y1, x2, y2, x3, y3) {
    const L = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
    const k = Math.min(128, Math.max(1, Math.ceil(Math.sqrt(L / tol))));
    for (let j = 1; j <= k; j++) {
      const t = j / k, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      vers(a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3, j === k ? 1 : 0);
    }
  }

  function arc(x1, y1, rx, ry, phiDeg, grand, sens, x2, y2) {
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) { vers(x2, y2, 1); return; }
    const phi = phiDeg * Math.PI / 180, cph = Math.cos(phi), sph = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cph * dx + sph * dy, y1p = -sph * dx + cph * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const r = Math.sqrt(lam); rx *= r; ry *= r; }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num / den));
    if (grand === sens) co = -co;
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const ccx = cph * cxp - sph * cyp + (x1 + x2) / 2, ccy = sph * cxp + cph * cyp + (y1 + y2) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sens && dt > 0) dt -= 2 * Math.PI;
    else if (sens && dt < 0) dt += 2 * Math.PI;
    const pas = Math.sqrt(8 * tol / Math.max(rx, ry));
    const k = Math.min(256, Math.max(2, Math.ceil(Math.abs(dt) / pas)));
    for (let j = 1; j <= k; j++) {
      if (j === k) { vers(x2, y2, 1); break; }
      const t = t1 + dt * j / k, ct = Math.cos(t), st = Math.sin(t);
      vers(cph * rx * ct - sph * ry * st + ccx, sph * rx * ct + cph * ry * st + ccy, 0);
    }
  }

  for (;;) {
    blancs();
    if (i >= n) break;
    const c = s[i];
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) { cmd = c; i++; }
    else if (!cmd) throw new Error('tracé sans commande de départ');
    const rel = cmd >= 'a';
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'Z':
        if (cur) cur.closed = true;
        x = sx; y = sy; cx = cy = qx = qy = null; cmd = '';
        break;
      case 'M': {
        const px = nombre() + ox, py = nombre() + oy;
        x = sx = px; y = sy = py; debut(x, y);
        cmd = rel ? 'l' : 'L'; cx = cy = qx = qy = null;
        break;
      }
      case 'L': { const px = nombre() + ox, py = nombre() + oy; vers(px, py, 1); x = px; y = py; cx = cy = qx = qy = null; break; }
      case 'H': { const px = nombre() + ox; vers(px, y, 1); x = px; cx = cy = qx = qy = null; break; }
      case 'V': { const py = nombre() + oy; vers(x, py, 1); y = py; cx = cy = qx = qy = null; break; }
      case 'C': case 'S': {
        let x1, y1;
        if (cmd.toUpperCase() === 'C') { x1 = nombre() + ox; y1 = nombre() + oy; }
        else { x1 = cx === null ? x : 2 * x - cx; y1 = cy === null ? y : 2 * y - cy; }
        const x2 = nombre() + ox, y2 = nombre() + oy, px = nombre() + ox, py = nombre() + oy;
        cubique(x, y, x1, y1, x2, y2, px, py);
        x = px; y = py; cx = x2; cy = y2; qx = qy = null;
        break;
      }
      case 'Q': case 'T': {
        let x1, y1;
        if (cmd.toUpperCase() === 'Q') { x1 = nombre() + ox; y1 = nombre() + oy; }
        else { x1 = qx === null ? x : 2 * x - qx; y1 = qy === null ? y : 2 * y - qy; }
        const px = nombre() + ox, py = nombre() + oy;
        cubique(x, y, x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), px + 2 / 3 * (x1 - px), py + 2 / 3 * (y1 - py), px, py);
        x = px; y = py; qx = x1; qy = y1; cx = cy = null;
        break;
      }
      case 'A': {
        const rx = Math.abs(nombre()), ry = Math.abs(nombre()), rot = nombre(), grand = drapeau(), sens = drapeau();
        const px = nombre() + ox, py = nombre() + oy;
        arc(x, y, rx, ry, rot, grand, sens, px, py);
        x = px; y = py; cx = cy = qx = qy = null;
        break;
      }
      default: throw new Error(`commande de tracé inconnue « ${cmd} »`);
    }
  }

  // Sous un millième d'unité, deux points sont le même nœud : Inkscape écrit des coordonnées relatives arrondies,
  // et un tracé qui revient sur son départ ou un segment de 3e-6 ne sont que des restes d'écriture.
  const EPS = 1e-3;
  const egaux = (a, b) => Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
  for (const sp of sous) {
    const p = [];
    for (const q of sp.pts) {
      const dernier = p[p.length - 1];
      if (!dernier || !egaux(dernier, q)) p.push(q);
      else if (q[2]) dernier[2] = 1;
    }
    if (p.length > 2 && egaux(p[0], p[p.length - 1])) { p.pop(); sp.closed = true; }   // revenu exactement au départ
    sp.pts = p;
  }
  return sous.filter(sp => sp.pts.length >= 2);
}

/** Toute forme SVG (path, rect, circle, ellipse, polygon, polyline, line) en sous-tracés. */
export function formeEnSousTraces(el, tol = 0.02) {
  const a = el.attrs;
  const f = k => parseFloat(a[k]) || 0;
  switch (el.name) {
    case 'path': return lireTrace(a.d, tol);
    case 'rect': {
      const x = f('x'), y = f('y'), w = f('width'), h = f('height');
      let rx = a.rx != null ? f('rx') : f('ry');
      let ry = a.ry != null ? f('ry') : rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (rx > 0 && ry > 0) {
        return lireTrace(`M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} `
          + `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} `
          + `V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`, tol);
      }
      return lireTrace(`M${x},${y} H${x + w} V${y + h} H${x} Z`, tol);
    }
    case 'circle': case 'ellipse': {
      const cx = f('cx'), cy = f('cy');
      const rx = el.name === 'circle' ? f('r') : f('rx'), ry = el.name === 'circle' ? f('r') : f('ry');
      if (!(rx > 0 && ry > 0)) return [];
      return lireTrace(`M${cx + rx},${cy} A${rx},${ry} 0 1 1 ${cx - rx},${cy} A${rx},${ry} 0 1 1 ${cx + rx},${cy} Z`, tol);
    }
    case 'polygon': case 'polyline': {
      const v = nombres(a.points);
      const pts = [];
      for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1], 1]);
      return pts.length < 2 ? [] : [{ pts, closed: el.name === 'polygon' }];
    }
    case 'line': return [{ pts: [[f('x1'), f('y1'), 1], [f('x2'), f('y2'), 1]], closed: false }];
  }
  return [];
}

// ---------- polygones

export function aire(r) {
  let a = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

export function perimetre(r) {
  let p = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) p += Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
  return p;
}

export function boite(anneaux) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of anneaux) for (const p of r) {
    if (p[0] < a) a = p[0];
    if (p[1] < b) b = p[1];
    if (p[0] > c) c = p[0];
    if (p[1] > d) d = p[1];
  }
  return [a, b, c, d];
}

export function dansAnneau(x, y, r) {
  let dedans = false;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** L'anneau a est-il à l'intérieur de l'anneau b ? Ses nœuds votent : un nœud posé sur le bord de b ne décide pas seul. */
export function anneauDans(a, b) {
  const pas = Math.max(1, Math.floor(a.length / 24));
  let dedans = 0, dehors = 0;
  for (let i = 0; i < a.length; i += pas) {
    if (dansAnneau(a[i][0], a[i][1], b)) dedans++;
    else dehors++;
  }
  return dedans > dehors;
}

/** Règle pair-impair sur tous les anneaux d'une pièce : un point dans un trou est dehors. */
export function dansAnneaux(x, y, anneaux) {
  let dedans = false;
  for (const r of anneaux) if (dansAnneau(x, y, r)) dedans = !dedans;
  return dedans;
}

const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const EPS = 1e-10;

/** Croisement franc de [a b] et [c d] (un simple contact ne compte pas). Renvoie le point, ou null. */
export function croisement(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  if (!((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS))) return null;
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (!((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return null;
  const t = o1 / (o1 - o2);
  return [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t];
}

function boitesAretes(r) {
  const n = r.length, bb = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    bb[i * 4] = Math.min(p[0], q[0]); bb[i * 4 + 1] = Math.min(p[1], q[1]);
    bb[i * 4 + 2] = Math.max(p[0], q[0]); bb[i * 4 + 3] = Math.max(p[1], q[1]);
  }
  return bb;
}

/** Croisements d'un contour fermé avec lui-même : { pt, boucle }, boucle étant l'aire de la plus petite des deux parts découpées. */
export function autoCroisements(r, max = 5) {
  const n = r.length, res = [], bb = boitesAretes(r);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (bb[i * 4 + 2] < bb[j * 4] || bb[j * 4 + 2] < bb[i * 4] || bb[i * 4 + 3] < bb[j * 4 + 1] || bb[j * 4 + 3] < bb[i * 4 + 1]) continue;
      const pt = croisement(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n]);
      if (!pt) continue;
      const une = Math.abs(aire([pt, ...r.slice(i + 1, j + 1)]));
      const autre = Math.abs(aire([pt, ...r.slice(j + 1), ...r.slice(0, i + 1)]));
      res.push({ pt, boucle: Math.min(une, autre) });
      if (res.length >= max) return res;
    }
  }
  return res;
}

/** Points où deux contours fermés se croisent. */
export function croisementsEntre(r1, r2, max = 5) {
  const res = [], b1 = boitesAretes(r1), b2 = boitesAretes(r2);
  for (let i = 0; i < r1.length; i++) {
    for (let j = 0; j < r2.length; j++) {
      if (b1[i * 4 + 2] < b2[j * 4] || b2[j * 4 + 2] < b1[i * 4] || b1[i * 4 + 3] < b2[j * 4 + 1] || b2[j * 4 + 3] < b1[i * 4 + 1]) continue;
      const pt = croisement(r1[i], r1[(i + 1) % r1.length], r2[j], r2[(j + 1) % r2.length]);
      if (pt) { res.push(pt); if (res.length >= max) return res; }
    }
  }
  return res;
}

/** Un point franchement à l'intérieur de la pièce (le milieu du plus large passage horizontal). */
export function pointInterieur(anneaux, bb = boite(anneaux)) {
  let meilleur = null, largeur = -1;
  for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const y = bb[1] + (bb[3] - bb[1]) * f;
    const xs = [];
    for (const r of anneaux) {
      for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) {
        const yi = r[i][1], yj = r[j][1];
        if ((yi > y) !== (yj > y)) xs.push((r[j][0] - r[i][0]) * (y - yi) / (yj - yi) + r[i][0]);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] > largeur) { largeur = xs[k + 1] - xs[k]; meilleur = [(xs[k] + xs[k + 1]) / 2, y]; }
    }
  }
  return meilleur ?? [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
}
