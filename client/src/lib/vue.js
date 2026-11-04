// Le cadrage du motif à l'écran : ce qu'il faut pour zoomer au doigt sans se perdre.
// Tout est en unités du dessin (millimètres) ; l'écran n'intervient que par son rapport pixels/mm.

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 400;

/** Le cadrage de départ : le motif entier, centré, avec un peu d'air autour. */
export function cadrer(taille, ecran, air = 0.92) {
  const [l, h] = taille;
  if (!(l > 0) || !(h > 0) || !(ecran.largeur > 0) || !(ecran.hauteur > 0)) return { x: 0, y: 0, k: 1 };
  const k = Math.min(ecran.largeur / l, ecran.hauteur / h) * air;
  return { k, x: (ecran.largeur - l * k) / 2, y: (ecran.hauteur - h * k) / 2 };
}

/** Déplacer : la vue suit le doigt, au pixel près. */
export const deplacer = (vue, dx, dy) => ({ ...vue, x: vue.x + dx, y: vue.y + dy });

/**
 * Zoomer autour d'un point de l'écran : ce qui est sous le doigt y reste.
 * `facteur` vient de l'écartement des deux doigts, ou de la molette.
 */
export function zoomer(vue, facteur, centre) {
  const k = Math.max(ZOOM_MIN, Math.min(vue.k * facteur, ZOOM_MAX));
  const vrai = k / vue.k;                       // le facteur réellement appliqué, une fois borné
  return { k, x: centre.x - (centre.x - vue.x) * vrai, y: centre.y - (centre.y - vue.y) * vrai };
}

/** Du point de l'écran vers le dessin : utile pour savoir ce qu'on a touché. */
export const versDessin = (vue, point) => ({ x: (point.x - vue.x) / vue.k, y: (point.y - vue.y) / vue.k });

/** L'écart entre deux doigts, qui donne le facteur de zoom. */
export const ecartement = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Le milieu entre deux doigts : le centre du zoom. */
export const milieu = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Un appui, ou un glissement ? Un doigt qui bouge de moins de `seuil` pixels pendant moins de `duree`
 * millisecondes voulait désigner quelque chose.
 */
export const estUnAppui = (depart, arrivee, seuil = 8, duree = 500) =>
  Math.hypot(arrivee.x - depart.x, arrivee.y - depart.y) <= seuil && arrivee.t - depart.t <= duree;

/** Le cadrage qui amène une pièce au centre, à un zoom confortable. */
export function viser(piece, ecran, k = null) {
  const points = piece.contour.flat();
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const zoom = k ?? Math.min(ecran.largeur / Math.max(x1 - x0, 1), ecran.hauteur / Math.max(y1 - y0, 1)) * 0.5;
  const borne = Math.max(ZOOM_MIN, Math.min(zoom, ZOOM_MAX));
  return {
    k: borne,
    x: ecran.largeur / 2 - ((x0 + x1) / 2) * borne,
    y: ecran.hauteur / 2 - ((y0 + y1) / 2) * borne,
  };
}

/**
 * Un geste à deux doigts, calculé d'un bloc depuis son ancre : le zoom et le déplacement se déduisent
 * de l'écart et du centre des doigts au moment où on les a posés. Rien ne s'accumule, donc rien ne saute
 * quand un doigt arrive ou s'en va — il suffit alors de reprendre l'ancre.
 *
 * `ancre` : { vue, centre, ecart } relevé au dernier changement de doigts.
 * `doigts` : les positions courantes, en pixels écran. `origine` : le coin du plan à l'écran.
 */
export function geste(ancre, doigts, origine = { x: 0, y: 0 }) {
  if (!ancre || !doigts.length) return ancre?.vue ?? { x: 0, y: 0, k: 1 };
  const centre = doigts.length >= 2 ? milieu(doigts[0], doigts[1]) : doigts[0];
  let vue = ancre.vue;
  if (doigts.length >= 2 && ancre.ecart > 0) {
    const facteur = ecartement(doigts[0], doigts[1]) / ancre.ecart;
    vue = zoomer(vue, facteur, { x: ancre.centre.x - origine.x, y: ancre.centre.y - origine.y });
  }
  return deplacer(vue, centre.x - ancre.centre.x, centre.y - ancre.centre.y);
}

/** L'ancre à relever chaque fois que le nombre de doigts change. */
export const ancrer = (vue, doigts) => ({
  vue: { ...vue },
  centre: doigts.length >= 2 ? milieu(doigts[0], doigts[1]) : (doigts[0] ?? { x: 0, y: 0 }),
  ecart: doigts.length >= 2 ? ecartement(doigts[0], doigts[1]) : 0,
  doigts: doigts.length,
});
