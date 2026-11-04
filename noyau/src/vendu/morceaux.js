// Un grand dessin découpé en morceaux (cheveux, visage, mains…) : chaque morceau garde la page du dessin complet,
// ses pièces à leur place ; les vides et les flèches laissés aux autres morceaux ne sont pas des erreurs.
import { verifier } from './audit.js';
import * as G from './geom.js';

const ORDRE = { erreur: 0, attention: 1, info: 2 };
const TOLERANCE = 0.05;                  // mm : écart admis entre une pièce du morceau et la même pièce du dessin complet
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

let memoire = { texte: null, res: null };
function verifierReference(texte) {
  if (memoire.texte !== texte) memoire = { texte, res: verifier(texte) };
  return memoire.res;
}

/** « leane2-cheveux leane.svg » morceau de « leane2.svg », ou « leane_main.svg » morceau de « leane_full.svg » : « cheveux leane », « main ». */
export function nomDuMorceau(nomMorceau = '', nomReference = '') {
  const sans = s => String(s).replace(/\.svg$/i, '').trim();
  const m = sans(nomMorceau), r = sans(nomReference);
  let k = 0;
  while (k < m.length && k < r.length && m[k].toLowerCase() === r[k].toLowerCase()) k++;
  if (k < r.length) {
    // début commun partiel (« leane_ ») : on coupe au dernier séparateur, pour ne pas manger le début d'un mot
    const coupe = Math.max(...[' ', '-', '_', '.'].map(c => m.slice(0, k).lastIndexOf(c)));
    k = coupe > 0 ? coupe + 1 : 0;
  }
  return m.slice(k).replace(/^[\s\-_.]+/, '') || m;
}

/**
 * Vérifie un morceau par rapport au dessin complet.
 * options : { tolerance, nomReference, nomMorceau }
 * Renvoie le résultat de verifier() sur le morceau, avec ses constats ajustés et un champ morceau.
 */
export function verifierMorceau(texte, referenceTexte, options = {}) {
  const { nomReference = 'dessin complet', nomMorceau = '' } = options;
  const ref = verifierReference(referenceTexte);
  const res = verifier(texte, { tolerance: options.tolerance, fleches: options.fleches });
  if (!res.pieces.length && !res.ok) return res;

  const parId = new Map(ref.pieces.filter(p => p.id != null).map(p => [p.id, p]));
  const proche = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= TOLERANCE);
  const etrangeres = [], modifiees = [], regroupees = [];
  for (const p of res.pieces) {
    const q = p.id != null ? parId.get(p.id) : null;
    if (!q) etrangeres.push(p);
    else if (!proche(p.boite, q.boite) || Math.abs(p.aire - q.aire) > Math.max(TOLERANCE, q.aire * 0.002)) modifiees.push(p);
    else if (p.groupe !== q.groupe) regroupees.push(p);
  }
  const ids = new Set(res.pieces.map(p => p.id));

  // une pièce restée sans flèche dans le morceau reprend celle du dessin complet : c'est la même pièce, au même endroit
  const douteuses = new Set([...etrangeres, ...modifiees]);
  let reprises = 0;
  const pieces = res.pieces.map(p => {
    const q = parId.get(p.id);
    if (p.fleches.length || douteuses.has(p) || !q?.fleches.length) return p;
    reprises++;
    return { ...p, fleches: q.fleches };
  });
  // un groupe resté vide dans le morceau (ses pièces sont ailleurs) ne demande pas d'essence
  const groupes = res.groupes.filter(g => g.pieces > 0)
    .map(g => ({ ...g, flechees: pieces.filter(p => p.groupe === g.numero && p.fleches.length).length }));

  // une flèche sans pièce dans le morceau, qui dans le dessin complet tombe dans une pièce d'un autre morceau
  const flecheRef = f => ref.fleches.find(g => (f.id != null && g.id === f.id) || (Math.abs(g.pos[0] - f.pos[0]) < 0.01 && Math.abs(g.pos[1] - f.pos[1]) < 0.01));
  const autresFleches = new Set(res.fleches.filter(f => {
    if (f.piece) return false;
    const g = flecheRef(f);
    return g?.piece && !ids.has(g.piece);
  }));
  const fleches = res.fleches.filter(f => !autresFleches.has(f));

  const constats = [];
  for (const c of res.constats) {
    // les vides sont couverts par les autres morceaux : le dessin complet, lui, est contrôlé en entier
    if (['VIDE', 'PAGE_NON_REMPLIE', 'NUMEROS_SAUTES', 'GROUPE_VIDE'].includes(c.code)) continue;
    if (c.code === 'SANS_FLECHE') {
      const sans = pieces.filter(p => c.ids.includes(p.id) && !p.fleches.length);
      if (sans.length) constats.push({ ...c, ids: sans.map(p => p.id), points: sans.map(p => p.interieur),
        message: `${pluriel(sans.length, 'pièce n’a', 'pièces n’ont')} de flèche de fil ni ici, ni dans le dessin complet. Pose une flèche ↑ tournée dans le sens du fil, bien à l’intérieur de chacune.` });
      continue;
    }
    if (c.code === 'FLECHE_HORS_PIECE') {
      const perdues = fleches.filter(f => !f.piece);
      if (perdues.length) constats.push({ ...c, ids: perdues.map(f => f.id).filter(Boolean), points: perdues.map(f => f.pos),
        message: `${pluriel(perdues.length, 'flèche est tombée', 'flèches sont tombées')} en dehors de toute pièce, y compris dans le dessin complet. Ramène-la bien à l’intérieur de sa pièce, ou supprime-la.` });
      continue;
    }
    constats.push(c);
  }
  const noter = (niveau, code, message, extra = {}) => constats.push({ niveau, categorie: 'structure', code, message, ids: [], points: [], ...extra });
  if (!ref.ok) noter('erreur', 'REFERENCE_PAS_PRETE', `Le dessin complet « ${nomReference} » ne passe pas la vérification : vérifie-le d’abord en entier, puis reviens à ce morceau.`);
  if (Math.abs(res.page.largeur - ref.page.largeur) > 0.01 || Math.abs(res.page.hauteur - ref.page.hauteur) > 0.01) {
    noter('erreur', 'PAGE_DIFFERENTE', `La page de ce morceau (${fmt(res.page.largeur)} × ${fmt(res.page.hauteur)} mm) n’est pas celle du dessin complet (${fmt(ref.page.largeur)} × ${fmt(ref.page.hauteur)} mm). Garde exactement la même page, sinon les tailles ne tomberaient plus juste.`);
  }
  if (etrangeres.length) noter('erreur', 'PIECE_ETRANGERE', `${pluriel(etrangeres.length, 'pièce ne se retrouve pas', 'pièces ne se retrouvent pas')} dans « ${nomReference} » (identifiant inconnu). Un morceau se fait en supprimant des pièces d’une copie du dessin complet, sans en ajouter.`, { ids: etrangeres.map(p => p.id).filter(Boolean) });
  if (modifiees.length) noter('erreur', 'PIECE_MODIFIEE', `${pluriel(modifiees.length, 'pièce a bougé ou changé de forme', 'pièces ont bougé ou changé de forme')} par rapport à « ${nomReference} ». Si tu as retouché le dessin, refais le morceau à partir du dessin complet à jour, ou choisis ce dessin-là comme référence.`, { ids: modifiees.map(p => p.id) });
  if (regroupees.length) noter('attention', 'GROUPE_CHANGE', `${pluriel(regroupees.length, 'pièce n’est pas', 'pièces ne sont pas')} dans le même groupe que dans le dessin complet : elles ne recevraient pas la même essence que leurs voisines.`, { ids: regroupees.map(p => p.id) });
  if (reprises) noter('info', 'FLECHES_REPRISES', `${pluriel(reprises, 'pièce reprend', 'pièces reprennent')} la flèche de fil du dessin complet : dans ce morceau, ${reprises > 1 ? 'leurs flèches sont masquées ou absentes' : 'sa flèche est masquée ou absente'}.`);
  const communes = res.pieces.length - etrangeres.length - modifiees.length;
  noter('info', 'MORCEAU', `Morceau de « ${nomReference} » : ${pluriel(res.pieces.length, 'pièce', 'pièces')} sur ${ref.pieces.length}. Les vides laissés aux autres morceaux et leurs flèches sont ignorés.`);
  constats.sort((a, b) => ORDRE[a.niveau] - ORDRE[b.niveau]);

  return {
    ...res,
    ok: !constats.some(c => c.niveau === 'erreur'),
    pieces,
    groupes,
    fleches,
    constats,
    stats: { ...res.stats, fleches: fleches.length },
    morceau: {
      nom: nomDuMorceau(nomMorceau, nomReference),
      reference: nomReference,
      piecesReference: ref.pieces.length,
      page: ref.page,
      ids: res.pieces.map(p => p.id),
      communes,
      autres: ref.pieces.filter(p => !ids.has(p.id)),
    },
  };
}

const fmt = x => Number(x).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/**
 * Le dessin complet et tous ses morceaux d'un coup : à quel morceau va chaque pièce.
 * fichiers : [{ nom, texte }]. Une pièce dans deux morceaux bloque ; une pièce dans aucun ira dans un encart « hors morceaux ».
 */
export function repartirMorceaux(referenceTexte, fichiers, nomReference = 'dessin complet') {
  const ref = verifierReference(referenceTexte);
  const morceaux = fichiers.map(f => {
    const r = verifierMorceau(f.texte, referenceTexte, { nomReference, nomMorceau: f.nom });
    const erreur = r.constats.find(c => c.niveau === 'erreur');
    return { nom: r.morceau?.nom ?? nomDuMorceau(f.nom, nomReference), fichier: f.nom, ids: r.morceau?.ids ?? [], ok: r.ok, probleme: erreur?.message ?? null };
  });
  const ou = new Map();
  for (const m of morceaux) for (const id of m.ids) (ou.get(id) ?? ou.set(id, []).get(id)).push(m.nom);
  const doublons = [...ou].filter(([, noms]) => noms.length > 1).map(([id, noms]) => ({ id, morceaux: noms }));
  const sansMorceau = ref.pieces.filter(p => !ou.has(p.id)).map(p => p.id);
  return {
    morceaux, doublons, sansMorceau,
    piecesReference: ref.pieces.length,
    couvertes: ref.pieces.length - sansMorceau.length,
    ok: morceaux.length > 0 && morceaux.every(m => m.ok) && !doublons.length,
  };
}

/**
 * Une carte des zones (un SVG de même page, une forme nommée par zone : « voiture calque », « route calque »…) :
 * chaque pièce du dessin va dans la zone où tombe son centre. Le résultat a la même forme que repartirMorceaux.
 * Une pièce sous deux zones va dans la plus petite (la plus précise) ; une pièce hors de toute zone est signalée.
 */
export function repartirZones(referenceTexte, carte, nomReference = 'dessin complet') {
  const ref = verifierReference(referenceTexte);
  const lue = verifier(carte.texte);
  const vus = new Map();
  const zones = lue.pieces.filter(p => p.etat === 'ok' && p.aire > 0).map((p, i) => {
    let nom = String(p.nom ?? '').replace(/\s*calque\s*$/i, '').trim() || p.id || `zone ${i + 1}`;
    const n = (vus.get(nom) ?? 0) + 1;
    vus.set(nom, n);
    if (n > 1) nom = `${nom} ${n}`;
    return { nom, anneaux: p.anneaux, aire: p.aire, ids: [] };
  });
  let probleme = null;
  if (!zones.length) probleme = `« ${carte.nom} » ne contient aucune forme fermée : dessine une forme par zone.`;
  else if (Math.abs(lue.page.largeur - ref.page.largeur) > 0.01 || Math.abs(lue.page.hauteur - ref.page.hauteur) > 0.01) {
    probleme = `La page de la carte des zones (${fmt(lue.page.largeur)} × ${fmt(lue.page.hauteur)} mm) n’est pas celle de « ${nomReference} » (${fmt(ref.page.largeur)} × ${fmt(ref.page.hauteur)} mm) : garde exactement la même page.`;
  }
  const sansMorceau = [];
  let chevauchements = 0;
  if (!probleme) {
    for (const p of ref.pieces) {
      const [x, y] = p.interieur ?? [];
      const dans = x == null ? [] : zones.filter(z => G.dansAnneaux(x, y, z.anneaux));
      if (!dans.length) { sansMorceau.push(p.id); continue; }
      if (dans.length > 1) chevauchements++;
      dans.reduce((a, b) => (b.aire < a.aire ? b : a)).ids.push(p.id);
    }
  }
  return {
    mode: 'zones',
    morceaux: zones.filter(z => z.ids.length).map(z => ({ nom: z.nom, fichier: carte.nom, ids: z.ids, ok: true, probleme: null })),
    zonesVides: probleme ? [] : zones.filter(z => !z.ids.length).map(z => z.nom),
    chevauchements,
    doublons: [],
    sansMorceau,
    piecesReference: ref.pieces.length,
    couvertes: probleme ? 0 : ref.pieces.length - sansMorceau.length,
    probleme,
    ok: !probleme,
  };
}

/**
 * Les morceaux d'un projet, regroupés par dessin complet et par dimension : pièces couvertes, manquantes, en double.
 * Deux déclinaisons d'un même morceau (même nom) : seule la plus récente compte.
 */
export function couverture(declinaisons = []) {
  const lots = new Map();
  for (const d of declinaisons) {
    const m = d.morceau;
    if (!m?.reference || !Array.isArray(m.ids)) continue;
    const cle = `${m.reference}|${d.dimension?.sens}|${d.dimension?.mm}`;
    if (!lots.has(cle)) {
      lots.set(cle, { reference: m.reference, nomReference: m.nomReference ?? m.reference.replace(/^source\//, ''), dimension: d.dimension, piecesReference: m.piecesReference, parNom: new Map() });
    }
    lots.get(cle).parNom.set(m.nom, { nom: m.nom, declinaison: d.dossier ?? d.nom, pieces: m.ids.length, ids: m.ids });
  }
  return [...lots.values()].map(({ parNom, ...lot }) => {
    const morceaux = [...parNom.values()];
    const vus = new Map();
    for (const m of morceaux) for (const id of m.ids) vus.set(id, (vus.get(id) ?? 0) + 1);
    const doublons = [...vus].filter(([, n]) => n > 1).map(([id]) => id);
    return { ...lot, morceaux, couvertes: vus.size, doublons, manquantes: Math.max(0, (lot.piecesReference ?? 0) - vus.size) };
  });
}
