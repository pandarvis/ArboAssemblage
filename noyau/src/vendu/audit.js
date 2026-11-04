// Vérification d'un dessin Inkscape avant découpe : groupes numérotés, formes, pavage, flèches de fil.
// Tout se mesure en millimètres du dessin (la page Inkscape), avant toute mise à l'échelle.
import { parseXML } from './xml.js';
import * as G from './geom.js';

/** Flèches de fil reconnues, avec leur direction dans le repère SVG (y vers le bas). */
export const GLYPHES = {
  '→': 0, '➔': 0, '➜': 0, '➝': 0, '⟶': 0, '↔': 0,
  '↘': 45, '↓': 90, '↕': 90, '↙': 135, '←': 180, '↖': 225, '↑': 270, '↗': 315,
};
export const CATEGORIES = ['structure', 'formes', 'pavage', 'fleches'];

const FORMES = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const IGNORES = new Set(['defs', 'metadata', 'sodipodi:namedview', 'title', 'desc', 'clipPath', 'mask', 'pattern',
  'symbol', 'style', 'script', 'marker', 'linearGradient', 'radialGradient', 'filter']);
const CONTENEURS = new Set(['g', 'a', 'switch', 'svg']);
const UNITES = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
const ORDRE = { erreur: 0, attention: 1, info: 2 };
// un filament : une forme plus fine qu'un cheveu, reste d'une opération booléenne ; invisible à l'écran, rien à découper
const FILAMENT = { aire: 0.05, largeur: 0.05 };

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;
const nomDe = o => (o.nom ? `« ${o.nom} »` : o.id);
const fr = (x, d = 1) => x.toLocaleString('fr-FR', { maximumFractionDigits: d });

function style(el) {
  const m = {};
  for (const part of (el.attrs.style || '').split(';')) {
    const k = part.indexOf(':');
    if (k > 0) m[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  }
  return m;
}
const texteDe = el => el.children.map(c => (c.text != null ? c.text : c.children ? texteDe(c) : '')).join('');
const compterFormes = el => (FORMES.has(el.name) ? 1 : 0) + (el.children || []).reduce((s, c) => s + (c.name ? compterFormes(c) : 0), 0);

function longueurMM(v) {
  if (v == null) return null;
  const m = String(v).trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i);
  return m ? +m[1] * UNITES[(m[2] || '').toLowerCase()] : null;
}

/** Taille de la page en millimètres, et matrice qui passe des unités du document aux millimètres. */
export function pageEtRepere(svg) {
  const vb = G.nombres(svg.attrs.viewBox);
  const lmm = longueurMM(svg.attrs.width), hmm = longueurMM(svg.attrs.height);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const sx = lmm ? lmm / vb[2] : UNITES.px, sy = hmm ? hmm / vb[3] : sx;
    return { M0: [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy], page: { largeur: vb[2] * sx, hauteur: vb[3] * sy } };
  }
  return { M0: [UNITES.px, 0, 0, UNITES.px, 0, 0], page: { largeur: lmm ?? 0, hauteur: hmm ?? 0 } };
}

/** options.tolerance : écart maximal (mm du dessin) entre une courbe et les segments qui la remplacent. */
export function verifier(texte, options = {}) {
  const chrono = Date.now();
  const tolerance = options.tolerance ?? 0.02;
  const constats = [];
  const noter = (niveau, categorie, code, message, extra = {}) =>
    constats.push({ niveau, categorie, code, message, ids: [], points: [], ...extra });

  let svg;
  try {
    svg = parseXML(texte);
  } catch (e) {
    noter('erreur', 'structure', 'SVG_ILLISIBLE', `Ce fichier n’est pas un SVG lisible (${e.message}).`);
    return { ok: false, page: { largeur: 0, hauteur: 0 }, pieces: [], fleches: [], groupes: [], constats,
      stats: { pieces: 0, groupes: 0, fleches: 0, resolution: null, remplitPage: false, duree: Date.now() - chrono } };
  }

  const { page, M0 } = pageEtRepere(svg);

  // ---------- parcours du document
  const pieces = [], fleches = [], groupes = [], imbriques = [], masques = [], textes = [], images = [], clones = [];

  function parcourir(el, m, groupe, sousGroupe, calque, herite = null) {
    if (!el.name || IGNORES.has(el.name)) return;
    const st = style(el);
    const id = el.attrs.id ?? null;
    const nom = el.attrs['inkscape:label'] ?? null;
    if (st.display === 'none' || el.attrs.display === 'none' || st.visibility === 'hidden' || el.attrs.visibility === 'hidden') {
      const nb = compterFormes(el);
      if (nb || el.name === 'text' || el.name === 'image') masques.push({ id: id ?? el.name, nom, formes: nb });
      return;
    }
    const mm = G.mul(m, G.lireTransformation(el.attrs.transform));
    const remplissage = st.fill ?? el.attrs.fill ?? herite;

    if (CONTENEURS.has(el.name)) {
      let g = groupe, sg = sousGroupe, c = calque;
      if (el.attrs['inkscape:groupmode'] === 'layer') c = nom ?? id;
      // « 7 », mais aussi « 07 sycomore » ou « 15 - syco bleu » : le numéro ouvre le nom, le reste dit l'essence
      const numerote = nom != null && /^\s*\d+\s*(?:[-–—.)_:]?\s+\S.*|[-–—.)_:]\s*\S.*)?$/.test(nom);
      if (numerote) {
        const numero = parseInt(nom, 10);
        if (groupe) { sg = { numero, id, dans: groupe.numero }; imbriques.push(sg); }
        else { g = { numero, id }; groupes.push(g); }
      }
      for (const k of el.children) parcourir(k, mm, g, sg, c, remplissage);
      return;
    }

    const base = { id: id ?? `${el.name} sans identifiant`, nom, calque, groupe: groupe ? groupe.numero : null, sousGroupe, couleur: /^(#|rgb)/i.test(remplissage ?? '') ? remplissage : null };

    if (FORMES.has(el.name)) {
      let sous;
      try {
        sous = G.formeEnSousTraces(el, tolerance / G.echelle(mm));
      } catch (e) {
        noter('erreur', 'formes', 'TRACE_ILLISIBLE', `Le tracé de ${nomDe(base)} est illisible : ${e.message}.`, { ids: [base.id] });
        return;
      }
      if (!sous.length) return;
      pieces.push({
        ...base,
        anneaux: sous.map(sp => sp.pts.map(p => { const q = G.appliquer(mm, p[0], p[1]); q.push(p[2]); return q; })),
        ouverts: sous.map(sp => !sp.closed),
      });
      return;
    }

    if (el.name === 'text') {
      const brut = texteDe(el).trim();
      const glyphe = GLYPHES[brut];
      if (glyphe === undefined) { if (brut) textes.push({ ...base, texte: brut }); return; }
      const tspan = el.children.find(k => k.name === 'tspan');
      const x = G.nombres(tspan?.attrs.x ?? el.attrs.x)[0] ?? 0;
      const y = G.nombres(tspan?.attrs.y ?? el.attrs.y)[0] ?? 0;
      const s = { ...st, ...(tspan ? style(tspan) : {}) };
      const corps = parseFloat(s['font-size'] ?? el.attrs['font-size']) || 4;
      const ancre = s['text-anchor'] ?? el.attrs['text-anchor'];
      const dx = ancre === 'middle' ? 0 : ancre === 'end' ? -0.3 * corps : 0.3 * corps;   // centre visuel du glyphe
      const mt = tspan?.attrs.transform ? G.mul(mm, G.lireTransformation(tspan.attrs.transform)) : mm;
      const rad = glyphe * Math.PI / 180;
      const v = G.appliquerVecteur(mt, Math.cos(rad), Math.sin(rad));
      fleches.push({
        ...base, glyphe: brut, piece: null,
        pos: G.appliquer(mt, x + dx, y - 0.35 * corps),
        angle: ((Math.atan2(v[1], v[0]) * 180 / Math.PI) % 360 + 360) % 360,          // le sens du fil, pas seulement son axe : 0 à 360°
      });
      return;
    }
    if (el.name === 'image') { images.push(base); return; }
    if (el.name === 'use') { clones.push(base); return; }
    for (const k of el.children || []) parcourir(k, mm, groupe, sousGroupe, calque, remplissage);
  }
  for (const k of svg.children) parcourir(k, M0, null, null, null);

  // ---------- géométrie de chaque pièce
  for (const p of pieces) {
    p.boite = G.boite(p.anneaux);
    p.fleches = [];
    p.aire = 0;
    p.largeurMoyenne = 0;
    if (p.ouverts.some(Boolean)) {
      p.etat = 'ouverte';
      p.interieur = [(p.boite[0] + p.boite[2]) / 2, (p.boite[1] + p.boite[3]) / 2];
      continue;
    }
    // un anneau contenu dans un nombre impair d'autres anneaux est un trou
    const prof = p.anneaux.map((r, i) => p.anneaux.reduce((s, r2, j) => s + (j !== i && G.anneauDans(r, r2) ? 1 : 0), 0));
    p.aire = p.anneaux.reduce((s, r, i) => s + (prof[i] % 2 ? -1 : 1) * Math.abs(G.aire(r)), 0);
    const perimetre = p.anneaux.reduce((s, r) => s + G.perimetre(r), 0);
    p.largeurMoyenne = perimetre ? 2 * p.aire / perimetre : 0;
    p.morceaux = prof.filter(d => d % 2 === 0).length;
    p.ilots = p.anneaux.filter((r, i) => prof[i] % 2 === 0)                 // morceaux secondaires, pour les montrer sur la carte
      .sort((a, b) => Math.abs(G.aire(b)) - Math.abs(G.aire(a))).slice(1).map(r => G.pointInterieur([r]));
    p.interieur = G.pointInterieur(p.anneaux, p.boite);
    // Un croisement franc rend la découpe imprévisible. Un croisement minuscule (nœud qui revient d'un cheveu
    // sur lui-même, trou qui effleure le bord) ne se voit pas à la découpe : on le signale sans bloquer.
    const graves = [], micro = [];
    for (let i = 0; i < p.anneaux.length; i++) {
      for (const c of G.autoCroisements(p.anneaux[i], 6)) (c.boucle < 0.05 ? micro : graves).push(c.pt);
      for (let j = i + 1; j < p.anneaux.length; j++) {
        const x = G.croisementsEntre(p.anneaux[i], p.anneaux[j], 6);
        if (!x.length) continue;
        let etendue = 0;
        for (const a of x) for (const b of x) etendue = Math.max(etendue, Math.hypot(a[0] - b[0], a[1] - b[1]));
        (x.length % 2 === 0 && etendue < 0.5 ? micro : graves).push(...x);
      }
    }
    if (graves.length) { p.etat = 'croisee'; p.croisements = graves; continue; }
    if (p.anneaux.some(r => r.length < 3) || p.aire < 0.01) { p.etat = 'degeneree'; continue; }
    if (p.aire < FILAMENT.aire || p.largeurMoyenne < FILAMENT.largeur) { p.etat = 'filament'; continue; }
    p.microCroisements = micro;
    p.etat = 'ok';
  }
  const saines = pieces.filter(p => p.etat === 'ok');
  const ids = l => l.map(p => p.id);
  const interieurs = l => l.map(p => p.interieur);

  // ---------- structure
  if (!pieces.length) noter('erreur', 'structure', 'AUCUNE_PIECE', 'Aucune forme visible à découper dans ce fichier.');
  const horsGroupe = pieces.filter(p => p.groupe === null);
  if (horsGroupe.length) {
    noter('erreur', 'structure', 'HORS_GROUPE', horsGroupe.length === pieces.length
      ? 'Aucune forme n’est rangée dans un groupe numéroté. Regroupe les pièces de chaque essence (Ctrl+G), puis nomme les groupes 1, 2, 3… dans le panneau Calques et objets.'
      : `${pluriel(horsGroupe.length, 'forme n’est rangée', 'formes ne sont rangées')} dans aucun groupe numéroté : l’outil ne saura pas dans quelle essence ${horsGroupe.length > 1 ? 'les' : 'la'} découper.`,
    { ids: ids(horsGroupe), points: interieurs(horsGroupe) });
  }
  for (const sg of imbriques) {
    const dedans = pieces.filter(p => p.sousGroupe === sg);
    noter('erreur', 'structure', 'GROUPE_IMBRIQUE',
      `Le groupe ${sg.numero} est rangé dans le groupe ${sg.dans}. Un groupe numéroté ne peut pas en contenir un autre : sors-le, ou renomme-le.`,
      { ids: ids(dedans), points: interieurs(dedans) });
  }
  const numeros = [...new Set(groupes.map(g => g.numero))].sort((a, b) => a - b);
  for (const n of numeros) {
    const dedans = pieces.filter(p => p.groupe === n);
    const nb = groupes.filter(g => g.numero === n).length;
    if (!dedans.length) noter('attention', 'structure', 'GROUPE_VIDE', `Le groupe ${n} ne contient aucune forme visible.`);
    else if (nb > 1) noter('info', 'structure', 'GROUPE_EN_PLUSIEURS', `${nb} groupes s’appellent ${n} : leurs pièces iront dans la même essence.`, { ids: ids(dedans) });
  }
  if (numeros.length) {
    const manquants = [];
    for (let k = 1; k < numeros[numeros.length - 1]; k++) if (!numeros.includes(k)) manquants.push(k);
    if (manquants.length) {
      noter('info', 'structure', 'NUMEROS_SAUTES', manquants.length > 1
        ? `Les numéros ${manquants.join(', ')} ne sont pas utilisés. Ce n’est pas bloquant.`
        : `Le numéro ${manquants[0]} n’est pas utilisé. Ce n’est pas bloquant.`);
    }
  }
  if (masques.length) {
    noter('info', 'structure', 'MASQUES', `${pluriel(masques.length, 'élément masqué est ignoré', 'éléments masqués sont ignorés')} : ${masques.slice(0, 5).map(nomDe).join(', ')}${masques.length > 5 ? '…' : ''}.`);
  }
  if (images.length) {
    noter('attention', 'structure', 'IMAGE_VISIBLE', `${pluriel(images.length, 'image est visible', 'images sont visibles')} dans le dessin (${images.map(nomDe).join(', ')}). Rien n’y sera découpé : pense à masquer ton calque de référence.`);
  }
  if (clones.length) {
    noter('erreur', 'structure', 'CLONE', `${pluriel(clones.length, 'clone', 'clones')} dans le dessin (${clones.map(nomDe).join(', ')}). L’outil ne sait pas les lire : sélectionne-${clones.length > 1 ? 'les' : 'le'}, puis Édition › Cloner › Délier le clone (Maj+Alt+D).`, { ids: ids(clones) });
  }
  if (textes.length) {
    noter('attention', 'structure', 'TEXTE', `${pluriel(textes.length, 'texte n’est', 'textes ne sont')} pas une flèche de fil (${textes.slice(0, 4).map(t => `« ${t.texte.slice(0, 20)} »`).join(', ')}) : ${textes.length > 1 ? 'ils sont ignorés' : 'il est ignoré'}.`, { ids: ids(textes) });
  }

  // ---------- formes
  const ouvertes = pieces.filter(p => p.etat === 'ouverte');
  if (ouvertes.length) {
    const points = [], presque = new Set();
    for (const p of ouvertes) {
      p.anneaux.forEach((r, i) => {
        if (!p.ouverts[i]) return;
        const a = r[0], b = r[r.length - 1];
        points.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) presque.add(p);
      });
    }
    let aide = '';
    if (presque.size) {
      const qui = presque.size === ouvertes.length
        ? (ouvertes.length > 1 ? 'Elles sont presque fermées' : 'Elle est presque fermée')
        : `${presque.size} ${presque.size > 1 ? 'sont presque fermées' : 'est presque fermée'}`;
      aide = ` ${qui} : avec l’outil Nœuds (N), sélectionne les deux extrémités et joins-les (Maj+J).`;
    }
    noter('erreur', 'formes', 'OUVERTE', `${pluriel(ouvertes.length, 'forme n’est pas fermée', 'formes ne sont pas fermées')} : LightBurn ne saurait pas de quel côté compenser le trait.${aide}`,
      { ids: ids(ouvertes), points });
  }
  const degenerees = pieces.filter(p => p.etat === 'degeneree');
  if (degenerees.length) {
    const s = degenerees.length > 1 ? 's' : '';
    noter('erreur', 'formes', 'DEGENEREE', `${pluriel(degenerees.length, 'forme est vide', 'formes sont vides')} ou réduite${s} à un trait : il n’y a rien à découper. Supprime-${s ? 'les' : 'la'}.`,
      { ids: ids(degenerees), points: interieurs(degenerees) });
  }
  const filaments = pieces.filter(p => p.etat === 'filament');
  if (filaments.length) {
    const s = filaments.length > 1 ? 's' : '';
    const noms = filaments.slice(0, 5).map(p => p.id).filter(Boolean).join(', ');
    noter('erreur', 'formes', 'FILAMENT', `${pluriel(filaments.length, 'forme est un filament invisible', 'formes sont des filaments invisibles')} : moins de ${fr(FILAMENT.largeur, 2)} mm de large, un reste d'opération booléenne. Il n'y a rien à découper, et c'est trop fin pour être attrapé à la souris${noms ? ` : cherche ${noms}${filaments.length > 5 ? '…' : ''} par son identifiant (Ctrl+F, recherche dans les propriétés puis ID) ou dans l'éditeur XML (Ctrl+Maj+X)` : ''}, puis supprime-${s ? 'les' : 'la'}.`,
      { ids: ids(filaments), points: interieurs(filaments) });
  }
  const croisees = pieces.filter(p => p.etat === 'croisee');
  if (croisees.length) {
    noter('erreur', 'formes', 'CROISEE', `${pluriel(croisees.length, 'forme se recoupe', 'formes se recoupent')} : un contour qui se croise, ou un trou qui touche son bord, donne une découpe imprévisible. Repère le croisement sur le dessin et déplace le nœud fautif.`,
      { ids: ids(croisees), points: croisees.flatMap(p => p.croisements) });
  }
  const microCroisees = saines.filter(p => p.microCroisements.length);
  if (microCroisees.length) {
    noter('attention', 'formes', 'MICRO_CROISEMENT', `${pluriel(microCroisees.length, 'forme a', 'formes ont')} un croisement minuscule : un nœud qui revient d’un cheveu sur lui-même, ou un trou qui effleure le bord. Invisible à la découpe, mais à nettoyer la prochaine fois que tu passes dessus.`,
      { ids: ids(microCroisees), points: microCroisees.flatMap(p => p.microCroisements) });
  }
  const enMorceaux = saines.filter(p => p.morceaux > 1);
  if (enMorceaux.length) {
    noter('attention', 'formes', 'MORCEAUX', `${pluriel(enMorceaux.length, 'forme est faite', 'formes sont faites')} de plusieurs morceaux séparés, qui partageront une seule flèche de fil. Si ce n’est pas voulu : Chemin › Scinder (Maj+Ctrl+Alt+K).`,
      { ids: ids(enMorceaux), points: enMorceaux.flatMap(p => p.ilots) });
  }

  // ---------- pavage
  let resolution = null, remplit = false;
  const avecPage = page.largeur > 0 && page.hauteur > 0;
  // Toutes les pièces sont peintes, même celles en défaut : sinon leur place apparaîtrait comme un faux vide.
  if (pieces.length) {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pieces) {
      bb[0] = Math.min(bb[0], p.boite[0]); bb[1] = Math.min(bb[1], p.boite[1]);
      bb[2] = Math.max(bb[2], p.boite[2]); bb[3] = Math.max(bb[3], p.boite[3]);
    }
    const T = 0.05;
    remplit = avecPage && Math.abs(bb[0]) < T && Math.abs(bb[1]) < T && Math.abs(bb[2] - page.largeur) < T && Math.abs(bb[3] - page.hauteur) < T;
    const domaine = avecPage
      ? [Math.min(bb[0], 0), Math.min(bb[1], 0), Math.max(bb[2], page.largeur), Math.max(bb[3], page.hauteur)]
      : bb;
    // Une forme ouverte n'a pas de surface définie : on ne la peint pas, et on tait les vides qu'elle laisse,
    // pour ne pas empiler de fausses erreurs par-dessus l'erreur « forme ouverte ».
    const ouvertesBoites = pieces.filter(p => p.etat === 'ouverte').map(p => p.boite);
    const ras = rasteriser(pieces.filter(p => p.etat !== 'ouverte'), domaine);
    resolution = ras.R;
    analyserPavage(ras, pieces.filter(p => p.etat !== 'ouverte'), remplit, page, noter, ouvertesBoites);
    if (avecPage && !remplit) {
      noter('info', 'pavage', 'PAGE_NON_REMPLIE', 'Le dessin ne remplit pas exactement la page : seuls les vides entourés de pièces sont contrôlés. Pour tout contrôler, cale la page sur le dessin (Maj+Ctrl+R).');
    }
    const debord = avecPage ? pieces.filter(p => p.boite[0] < -T || p.boite[1] < -T || p.boite[2] > page.largeur + T || p.boite[3] > page.hauteur + T) : [];
    if (debord.length) {
      noter('attention', 'pavage', 'HORS_PAGE', `${pluriel(debord.length, 'pièce dépasse', 'pièces dépassent')} de la page.`, { ids: ids(debord), points: interieurs(debord) });
    }
    presqueConfondus(saines, page, noter);
  }

  // ---------- flèches de fil
  const contient = (p, pt) => pt[0] >= p.boite[0] && pt[0] <= p.boite[2] && pt[1] >= p.boite[1] && pt[1] <= p.boite[3] && G.dansAnneaux(pt[0], pt[1], p.anneaux);
  for (const f of fleches) {
    const dedans = saines.filter(p => contient(p, f.pos));
    const p = dedans.length ? dedans.reduce((a, b) => (b.aire < a.aire ? b : a)) : pieces.find(q => q.etat !== 'ok' && contient(q, f.pos));
    if (p) { f.piece = p.id; p.fleches.push(f); }
  }
  const verifieFleches = options.fleches !== false;
  const sansFleche = verifieFleches ? saines.filter(p => !p.fleches.length) : [];
  if (sansFleche.length) {
    noter('erreur', 'fleches', 'SANS_FLECHE', `${pluriel(sansFleche.length, 'pièce n’a', 'pièces n’ont')} pas de flèche de fil. Pose une flèche ↑ tournée dans le sens du fil, bien à l’intérieur de chacune.`,
      { ids: ids(sansFleche), points: interieurs(sansFleche) });
  }
  const perdues = verifieFleches ? fleches.filter(f => !f.piece) : [];
  if (perdues.length) {
    noter('erreur', 'fleches', 'FLECHE_HORS_PIECE', `${pluriel(perdues.length, 'flèche est tombée', 'flèches sont tombées')} en dehors de toute pièce. C’est le centre de la flèche qui compte : ramène-la bien à l’intérieur de sa pièce, ou supprime-la.`,
      { ids: ids(perdues), points: perdues.map(f => f.pos) });
  }
  const contradictoires = [], doubles = [];
  for (const p of verifieFleches ? saines : []) {
    if (p.fleches.length < 2) continue;
    let ecart = 0;
    for (const a of p.fleches) for (const b of p.fleches) { const d = Math.abs(a.angle - b.angle) % 360; ecart = Math.max(ecart, Math.min(d, 360 - d)); }
    (ecart > 15 ? contradictoires : doubles).push(p);
  }
  if (contradictoires.length) {
    noter('attention', 'fleches', 'FLECHES_CONTRADICTOIRES', `${pluriel(contradictoires.length, 'pièce porte', 'pièces portent')} plusieurs flèches qui ne vont pas dans le même sens : garde-en une seule par pièce.`,
      { ids: ids(contradictoires), points: contradictoires.flatMap(p => p.fleches.map(f => f.pos)) });
  }
  if (doubles.length) {
    noter('info', 'fleches', 'FLECHES_EN_DOUBLE', `${pluriel(doubles.length, 'pièce porte', 'pièces portent')} plusieurs flèches dans le même sens. Ce n’est pas gênant, une seule suffit.`, { ids: ids(doubles) });
  }

  constats.sort((a, b) => ORDRE[a.niveau] - ORDRE[b.niveau] || CATEGORIES.indexOf(a.categorie) - CATEGORIES.indexOf(b.categorie));
  return {
    ok: !constats.some(c => c.niveau === 'erreur'),
    flechesVerifiees: verifieFleches,
    page,
    pieces: pieces.map(p => ({
      id: p.id, nom: p.nom, calque: p.calque, groupe: p.groupe, couleur: p.couleur, etat: p.etat, anneaux: p.anneaux, ouverts: p.ouverts,
      aire: p.aire, largeurMoyenne: p.largeurMoyenne, interieur: p.interieur, boite: p.boite, fleches: p.fleches.map(f => f.angle),
    })),
    fleches: fleches.map(f => ({ id: f.id, pos: f.pos, angle: f.angle, piece: f.piece })),
    groupes: numeros.map(n => {
      const dedans = pieces.filter(p => p.groupe === n);
      return { numero: n, pieces: dedans.length, flechees: dedans.filter(p => p.fleches.length).length, aire: dedans.reduce((s, p) => s + p.aire, 0) };
    }),
    constats,
    stats: { pieces: pieces.length, groupes: numeros.length, fleches: fleches.length, resolution, remplitPage: remplit, duree: Date.now() - chrono },
  };
}

// ---------- pavage : on peint chaque pièce sur une grille fine et on compte les couches

function rasteriser(pieces, dom) {
  const larg = dom[2] - dom[0], haut = dom[3] - dom[1];
  const R = Math.min(20, 3000 / Math.max(larg, haut, 1));   // pixels par millimètre
  const B = 2;
  const W = Math.ceil(larg * R) + 2 * B, H = Math.ceil(haut * R) + 2 * B;
  const ox = dom[0] - B / R, oy = dom[1] - B / R;
  const nb = new Uint8Array(W * H);
  const xs = [];
  for (const p of pieces) {
    const aretes = [];
    for (const r of p.anneaux) {
      for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) if (r[i][1] !== r[j][1]) aretes.push(r[j][0], r[j][1], r[i][0], r[i][1]);
    }
    const j0 = Math.max(0, Math.floor((p.boite[1] - oy) * R - 0.5)), j1 = Math.min(H - 1, Math.ceil((p.boite[3] - oy) * R));
    for (let j = j0; j <= j1; j++) {
      const yc = oy + (j + 0.5) / R;
      xs.length = 0;
      for (let e = 0; e < aretes.length; e += 4) {
        const y1 = aretes[e + 1], y2 = aretes[e + 3];
        if ((y1 <= yc) !== (y2 <= yc)) xs.push(aretes[e] + (yc - y1) * (aretes[e + 2] - aretes[e]) / (y2 - y1));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const ligne = j * W;
      for (let k = 0; k + 1 < xs.length; k += 2) {           // centres de pixels dans [xa, xb[ : deux pièces qui partagent un bord ne se doublent pas
        let i0 = Math.ceil((xs[k] - ox) * R - 0.5), i1 = Math.ceil((xs[k + 1] - ox) * R - 0.5) - 1;
        if (i0 < 0) i0 = 0;
        if (i1 > W - 1) i1 = W - 1;
        for (let i = i0; i <= i1; i++) if (nb[ligne + i] < 255) nb[ligne + i]++;
      }
    }
  }
  return { nb, W, H, R, ox, oy };
}

/** Taches connexes d'un masque ; une tache a un « noyau » si elle est épaisse d'au moins 2k+1 pixels quelque part. */
function composantes(masque, W, H, k) {
  const vu = new Uint8Array(W * H), pile = new Int32Array(W * H), res = [];
  const m = (i, j) => i >= 0 && j >= 0 && i < W && j < H && masque[j * W + i] === 1;
  for (let s = 0; s < W * H; s++) {
    if (!masque[s] || vu[s]) continue;
    const c = { n: 0, premier: s, noyau: -1 };
    let h = 0;
    pile[h++] = s; vu[s] = 1;
    while (h) {
      const q = pile[--h], i = q % W, j = (q - i) / W;
      c.n++;
      if (c.noyau < 0 && m(i - k, j) && m(i + k, j) && m(i, j - k) && m(i, j + k)) c.noyau = q;
      if (i > 0 && masque[q - 1] && !vu[q - 1]) { vu[q - 1] = 1; pile[h++] = q - 1; }
      if (i < W - 1 && masque[q + 1] && !vu[q + 1]) { vu[q + 1] = 1; pile[h++] = q + 1; }
      if (j > 0 && masque[q - W] && !vu[q - W]) { vu[q - W] = 1; pile[h++] = q - W; }
      if (j < H - 1 && masque[q + W] && !vu[q + W]) { vu[q + W] = 1; pile[h++] = q + W; }
    }
    res.push(c);
  }
  return res;
}

function analyserPavage({ nb, W, H, R, ox, oy }, pieces, remplit, page, noter, ouvertesBoites = []) {
  const k = Math.max(1, Math.round(0.1 * R));
  const centre = q => { const i = q % W, j = (q - i) / W; return [ox + (i + 0.5) / R, oy + (j + 0.5) / R]; };
  const sousOuverte = pt => ouvertesBoites.some(b => pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3]);
  const aire = c => c.n / (R * R);

  const double = new Uint8Array(W * H);
  for (let q = 0; q < W * H; q++) if (nb[q] >= 2) double[q] = 1;
  const chevauchements = composantes(double, W, H, k);

  const vide = new Uint8Array(W * H);
  if (remplit) {
    const i0 = Math.max(0, Math.ceil(-ox * R - 0.5)), i1 = Math.min(W - 1, Math.ceil((page.largeur - ox) * R - 0.5) - 1);
    const j0 = Math.max(0, Math.ceil(-oy * R - 0.5)), j1 = Math.min(H - 1, Math.ceil((page.hauteur - oy) * R - 0.5) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!nb[j * W + i]) vide[j * W + i] = 1;
  } else {
    const dehors = new Uint8Array(W * H), pile = new Int32Array(W * H);
    let h = 0;
    const pousser = q => { if (!nb[q] && !dehors[q]) { dehors[q] = 1; pile[h++] = q; } };
    for (let i = 0; i < W; i++) { pousser(i); pousser((H - 1) * W + i); }
    for (let j = 0; j < H; j++) { pousser(j * W); pousser(j * W + W - 1); }
    while (h) {
      const q = pile[--h], i = q % W;
      if (i > 0) pousser(q - 1);
      if (i < W - 1) pousser(q + 1);
      if (q >= W) pousser(q - W);
      if (q < W * (H - 1)) pousser(q + W);
    }
    for (let q = 0; q < W * H; q++) if (!nb[q] && !dehors[q]) vide[q] = 1;
  }
  const trous = composantes(vide, W, H, k).filter(c => !sousOuverte(centre(c.noyau >= 0 ? c.noyau : c.premier)));

  const piecesEn = pt => pieces.filter(p => pt[0] >= p.boite[0] && pt[0] <= p.boite[2] && pt[1] >= p.boite[1] && pt[1] <= p.boite[3] && G.dansAnneaux(pt[0], pt[1], p.anneaux));
  const imprecis = [];
  const MAX = 25;

  const graves = chevauchements.filter(c => c.noyau >= 0).sort((a, b) => b.n - a.n);
  graves.slice(0, MAX).forEach(c => {
    const pt = centre(c.noyau);
    const en = piecesEn(pt);
    const qui = en.length >= 2 ? `Les pièces ${en.map(nomDe).join(' et ')} se chevauchent` : 'Deux pièces se chevauchent';
    noter('erreur', 'pavage', 'CHEVAUCHEMENT', `${qui} sur ${fr(aire(c))} mm² : cette surface serait découpée deux fois.`, { ids: en.map(p => p.id), points: [pt] });
  });
  const trousGraves = trous.filter(c => c.noyau >= 0).sort((a, b) => b.n - a.n);
  trousGraves.slice(0, MAX).forEach(c => {
    noter('erreur', 'pavage', 'VIDE', `Un vide de ${fr(aire(c))} mm² n’est couvert par aucune pièce : il resterait un jour à cet endroit.`, { points: [centre(c.noyau)] });
  });
  const reste = Math.max(0, graves.length - MAX) + Math.max(0, trousGraves.length - MAX);
  if (reste) noter('erreur', 'pavage', 'PAVAGE_AUTRES', `Et ${reste} autres chevauchements ou vides, non détaillés.`);

  for (const c of [...chevauchements, ...trous]) if (c.noyau < 0 && aire(c) >= 0.5) imprecis.push(centre(c.premier));
  if (imprecis.length) {
    noter('attention', 'pavage', 'RACCORD_IMPRECIS', `${pluriel(imprecis.length, 'raccord est imprécis', 'raccords sont imprécis')} : le long d’un bord, deux pièces se recouvrent ou s’écartent d’un cheveu (moins de 0,1 mm). Invisible à la découpe, mais signe de nœuds mal accrochés.`,
      { points: imprecis.slice(0, 60) });
  }
}

/** Nœuds de deux pièces presque au même endroit, sans être exactement accrochés.
 *  Sous 0,02 mm, ce n'est que l'arrondi d'écriture d'Inkscape (coordonnées relatives cumulées) : on l'ignore. */
const ARRONDI_INKSCAPE = 0.02;
function presqueConfondus(saines, page, noter) {
  const tol = Math.min(0.2, Math.max(0.05, Math.max(page.largeur, page.hauteur, 1) / 2000));
  const grille = new Map();
  saines.forEach((p, ip) => {
    for (const r of p.anneaux) for (const q of r) {
      if (!q[2]) continue;
      const cle = `${Math.floor(q[0] / tol)},${Math.floor(q[1] / tol)}`;
      let l = grille.get(cle);
      if (!l) grille.set(cle, (l = []));
      l.push([q[0], q[1], ip]);
    }
  });
  const lieux = new Map(), ids = new Set();
  for (const [cle, l] of grille) {
    const [gx, gy] = cle.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l2 = grille.get(`${gx + dx},${gy + dy}`);
      if (!l2) continue;
      for (const a of l) for (const b of l2) {
        if (b[2] <= a[2]) continue;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d >= ARRONDI_INKSCAPE && d < tol) {
          lieux.set(`${Math.round(a[0] / tol)},${Math.round(a[1] / tol)}`, [a[0], a[1]]);
          ids.add(saines[a[2]].id); ids.add(saines[b[2]].id);
        }
      }
    }
  }
  if (lieux.size) {
    noter('attention', 'pavage', 'NOEUDS_PRESQUE_CONFONDUS', `${pluriel(lieux.size, 'endroit où deux pièces ont', 'endroits où deux pièces ont')} des nœuds presque confondus, sans être accrochés (moins de ${fr(tol, 2)} mm d’écart). Active le magnétisme aux nœuds et recolle-les pour un raccord net.`,
      { ids: [...ids], points: [...lieux.values()].slice(0, 60) });
  }
}
