// Étape 2 — du dessin vérifié aux feuilles de découpe : mise à l'échelle, fil redressé, angles arrondis,
// une feuille par essence, fichier LightBurn et fiche de découpe.
import { verifier } from './audit.js';
import { verifierMorceau } from './morceaux.js';
import * as G from './geom.js';
import { REGLAGES_DEFAUT, energie } from './essences.js';

const rad = d => d * Math.PI / 180;
const ecartSens = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
const HAUT = 270;                      // dans le repère du dessin (y vers le bas), vers le haut de l'écran
const echap = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fr = (x, d = 0) => Number(x).toLocaleString('fr-FR', { maximumFractionDigits: d });

/** Arrondit les angles saillants d'un anneau orienté dans le sens direct (y vers le haut). */
export function conge(anneau, R, n = 8) {
  const out = [];
  const N = anneau.length;
  for (let i = 0; i < N; i++) {
    const A = anneau[(i - 1 + N) % N], V = anneau[i], B = anneau[(i + 1) % N];
    let u1 = [A[0] - V[0], A[1] - V[1]], u2 = [B[0] - V[0], B[1] - V[1]];
    const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
    if (!l1 || !l2 || (V[0] - A[0]) * (B[1] - V[1]) - (V[1] - A[1]) * (B[0] - V[0]) <= 0) { out.push(V); continue; }
    u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
    const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    const r = Math.min(R, 0.45 * Math.min(l1, l2) * Math.tan(th / 2));
    if (r < 0.02 || th > Math.PI - 1e-3) { out.push(V); continue; }
    const t = r / Math.tan(th / 2);
    let b = [u1[0] + u2[0], u1[1] + u2[1]];
    const lb = Math.hypot(...b);
    b = [b[0] / lb, b[1] / lb];
    const C = [V[0] + b[0] * r / Math.sin(th / 2), V[1] + b[1] * r / Math.sin(th / 2)];
    const T1 = [V[0] + u1[0] * t, V[1] + u1[1] * t], T2 = [V[0] + u2[0] * t, V[1] + u2[1] * t];
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    const d = (a2 - a1 + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    for (let k = 0; k <= n; k++) out.push([C[0] + r * Math.cos(a1 + d * k / n), C[1] + r * Math.sin(a1 + d * k / n)]);
  }
  return out;
}

const boite = pts => G.boite([pts]);
const boitePiece = p => G.boite(p.anneaux);

/**
 * Prépare les feuilles de découpe.
 * dimension : { sens: 'hauteur' | 'largeur', mm }
 * affectations : { [numéro de groupe]: id d'essence } ; essences : { [id]: essence }
 * options : { reference: { nom, texte }, nom } quand le dessin est un morceau d'un dessin complet ;
 *           { morceaux: [{ nom, ids }] } quand le dessin complet est réparti en morceaux : un encart par morceau dans chaque feuille
 */
export function preparerDecoupe(svgTexte, dimension, affectations, essences, reglages = {}, options = {}) {
  const { R, S, res } = mettreALEchelle(svgTexte, dimension, reglages, options);
  const morceauDe = carteMorceaux(options.morceaux);

  const manquantes = res.groupes.filter(g => !essences[affectations[g.numero]]).map(g => g.numero);
  if (manquantes.length) throw new Error(`Choisis une essence pour ${manquantes.length > 1 ? 'les groupes' : 'le groupe'} ${manquantes.join(', ')}.`);

  const parEssence = new Map();
  for (const g of res.groupes) {
    const id = affectations[g.numero];
    if (!parEssence.has(id)) parEssence.set(id, []);
    parEssence.get(id).push(g.numero);
  }
  // on peut ne retenir qu'une partie des pièces : de quoi scinder une feuille trop grande pour le plateau
  const retenues = options.pieces ? new Set(options.pieces) : null;
  const dansLaFeuille = (p, groupes) => groupes.includes(p.groupe) && (!retenues || retenues.has(p.id));
  return assembler(res, S, [...parEssence].map(([id, groupes]) => {
    const pieces = res.pieces.filter(p => dansLaFeuille(p, groupes));
    // deux groupes du même bois partagent une feuille : un encart par groupe, sinon on ne sait plus
    // laquelle appartient à qui une fois les pièces rangées côte à côte
    let carte = morceauDe;
    if (!carte && groupes.length > 1) {
      carte = new Map(pieces.map(p => [p.id, `groupe ${p.groupe}`]));
      carte.ordre = [...groupes].sort((a, b) => a - b).map(g => `groupe ${g}`);
    }
    return feuille(essences[id], groupes, pieces, S, R, carte);
  }));
}

export const HORS_MORCEAUX = 'hors morceaux';

/** À quel morceau appartient chaque pièce ; une pièce dans deux morceaux serait découpée deux fois. */
function carteMorceaux(morceaux) {
  if (!morceaux?.length) return null;
  const carte = new Map();
  for (const m of morceaux) {
    for (const id of m.ids) {
      if (carte.has(id)) throw new Error(`La pièce ${id} est dans deux morceaux (« ${carte.get(id)} » et « ${m.nom} ») : elle serait découpée deux fois.`);
      carte.set(id, m.nom);
    }
  }
  carte.ordre = morceaux.map(m => m.nom);
  return carte;
}

/**
 * Avant le choix des essences : une feuille par groupe, avec sa couleur dans le dessin et sa taille de bande.
 * De quoi aller choisir les placages à l'atelier ; aucun réglage laser n'est nécessaire.
 */
export function feuilleDeRoute(svgTexte, dimension, reglages = {}, options = {}) {
  const { R, S, res } = mettreALEchelle(svgTexte, dimension, reglages, options);
  const morceauDe = carteMorceaux(options.morceaux);
  return assembler(res, S, res.groupes.map(g => {
    const pieces = res.pieces.filter(p => p.groupe === g.numero);
    const compte = new Map();
    for (const p of pieces) if (p.couleur) compte.set(p.couleur, (compte.get(p.couleur) ?? 0) + p.aire);
    const couleur = [...compte].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#c9a27a';
    return { ...feuille(null, [g.numero], pieces, S, R, morceauDe), couleur };
  }));
}

function assembler(res, S, feuilles) {
  feuilles.sort((a, b) => a.groupes[0] - b.groupes[0]);
  return {
    echelle: S,
    taille: { largeur: res.page.largeur * S, hauteur: res.page.hauteur * S },
    verification: res,
    feuilles,
    totaux: {
      pieces: feuilles.reduce((s, f) => s + f.pieces.length, 0),
      minutes: feuilles.reduce((s, f) => s + f.minutes, 0),
      surface: feuilles.reduce((s, f) => s + f.bande[0] * f.bande[1], 0),
    },
  };
}

function mettreALEchelle(svgTexte, dimension, reglages, options = {}) {
  const R = { ...REGLAGES_DEFAUT, ...reglages };
  // un morceau se vérifie contre le dessin complet ; l'échelle vient de la page, commune à tous les morceaux
  const verif = (o = {}) => (options.reference
    ? verifierMorceau(svgTexte, options.reference.texte, { ...o, nomReference: options.reference.nom, nomMorceau: options.nom })
    : verifier(svgTexte, o));
  const premier = verif();
  if (!premier.ok) throw new Error('Le dessin n’est pas prêt : corrige d’abord les erreurs de l’étape Vérifier.');
  const ref = dimension.sens === 'largeur' ? premier.page.largeur : premier.page.hauteur;
  if (!(ref > 0)) throw new Error('La page du dessin n’a pas de dimension lisible.');
  if (!(dimension.mm > 0)) throw new Error('Indique la dimension finale en millimètres.');
  const S = dimension.mm / ref;
  // les courbes sont réaplaties assez finement pour rester justes après agrandissement
  const res = S > 1 ? verif({ tolerance: 0.02 / S }) : premier;
  return { R, S, res };
}

// mm : autour des pièces, bandeau du nom, entre deux encarts ; largeur utile du plateau (420 mm) pour une rangée d'encarts
const CADRE = { marge: 3, etiquette: 5, ecart: 8, largeurMax: 380 };

function feuille(essence, groupes, pieces, S, R, morceauDe = null) {
  let travail = [], longueur = 0, ecart = 0, encarts = [];
  const modes = new Set();
  if (!morceauDe) {
    const d = disposer(pieces, S, R);
    ({ travail, longueur, ecart } = d);
    modes.add(d.mode);
  } else {
    // un encart par morceau, les uns sous les autres : cadre et nom pour s'y retrouver, les pièces à l'intérieur
    const lots = new Map();
    for (const p of pieces) {
      const nom = morceauDe.get(p.id) ?? HORS_MORCEAUX;
      if (!lots.has(nom)) lots.set(nom, []);
      lots.get(nom).push(p);
    }
    const rang = nom => { const i = morceauDe.ordre.indexOf(nom); return i < 0 ? Infinity : i; };
    // encarts en rangées, de gauche à droite puis de haut en bas, sans dépasser la largeur utile du plateau
    let x = 0, haut = 0, hauteurRang = 0;                   // repère LightBurn : y vers le haut, on descend de rangée en rangée
    for (const [nom, lot] of [...lots].sort((a, b) => rang(a[0]) - rang(b[0]))) {
      const d = disposer(lot, S, R);
      longueur += d.longueur;
      ecart = Math.max(ecart, d.ecart);
      modes.add(d.mode);
      const bb = G.boite(d.travail.flatMap(p => p.anneaux));
      const w = bb[2] - bb[0] + 2 * CADRE.marge, h = bb[3] - bb[1] + CADRE.etiquette + 2 * CADRE.marge;
      if (x > 0 && x + w > CADRE.largeurMax) { x = 0; haut -= hauteurRang + CADRE.ecart; hauteurRang = 0; }
      const bas = haut - h;
      travail.push(...d.travail.map(p => ({ ...deplacer(p, x + CADRE.marge - bb[0], bas + CADRE.marge - bb[1]), morceau: nom })));
      encarts.push({ nom, boite: [x, bas, x + w, haut], pieces: lot.length, mode: d.mode });
      x += w + CADRE.ecart;
      hauteurRang = Math.max(hauteurRang, h);
    }
    const dx = R.marge, dy = R.marge - Math.min(...encarts.map(e => e.boite[1]));
    travail = travail.map(p => ({ ...deplacer(p, dx, dy), morceau: p.morceau }));
    encarts = encarts.map(e => ({ ...e, boite: [e.boite[0] + dx, e.boite[1] + dy, e.boite[2] + dx, e.boite[3] + dy] }));
  }

  const bb = G.boite([...travail.flatMap(p => p.anneaux), ...encarts.map(e => [[e.boite[0], e.boite[1]], [e.boite[2], e.boite[3]]])]);
  const minutes = essence ? longueur * essence.passes / essence.vitesse : 0;
  return {
    essence, groupes,
    mode: modes.size === 1 ? [...modes][0] : 'mixte',
    ecartFil: ecart,
    pieces: travail,
    encarts,
    bande: [bb[2] - bb[0], bb[3] - bb[1]],
    boite: bb,
    longueur, minutes,
    energie: essence ? energie(essence.puissance, essence.vitesse, essence.passes) : null,
    fragiles: travail.filter(p => p.largeur < R.largeurFragile).map(p => p.id),
  };
}

/** Fil redressé, mise à l'échelle, disposition (comme le dessin ou rangées) et angles arrondis d'un lot de pièces. */
function disposer(pieces, S, R) {
  // ---- fil : chaque flèche doit pointer vers le haut dans le fichier, pour racler et poncer toute la feuille dans le même sens
  const angles = pieces.map(p => p.fleches[0] ?? HAUT);
  let ecart = 0;
  for (const a of angles) for (const b of angles) ecart = Math.max(ecart, ecartSens(a, b));
  const groupe = ecart <= R.ecartFilGroupe;
  const redresser = a => { const t = ((HAUT - a) % 360 + 540) % 360 - 180; return Math.abs(t) <= R.toleranceFil ? 0 : t; };
  let tourGroupe = 0;
  if (groupe && angles.length) {
    // moyenne circulaire des sens, puis une seule rotation pour tout le lot
    let x = 0, y = 0;
    for (const a of angles) { x += Math.cos(rad(a)); y += Math.sin(rad(a)); }
    tourGroupe = redresser(((Math.atan2(y, x) * 180 / Math.PI) % 360 + 360) % 360);
  }

  // ---- géométrie : échelle, rotation (repère du dessin, y vers le bas), puis repère LightBurn (y vers le haut)
  let travail = pieces.map((p, k) => {
    const t = rad(groupe ? tourGroupe : redresser(angles[k]));
    const c = Math.cos(t), s = Math.sin(t);
    const anneaux = p.anneaux.map(r => r.map(q => { const x = q[0] * S, y = q[1] * S; return [x * c - y * s, -(x * s + y * c)]; }));
    const tourne = groupe ? tourGroupe : redresser(angles[k]);
    return { id: p.id, groupe: p.groupe, anneaux, aire: p.aire * S * S, largeur: p.largeurMoyenne * S, fil: angles[k], tourne, sens: ((angles[k] + tourne) % 360 + 360) % 360 };
  });

  // ---- disposition
  if (groupe) {
    const bb = G.boite(travail.flatMap(p => p.anneaux));
    travail = travail.map(p => deplacer(p, R.marge - bb[0], R.marge - bb[1]));
  } else {
    const ordre = [...travail].sort((a, b) => { const A = boitePiece(a), B = boitePiece(b); return (B[3] - B[1]) - (A[3] - A[1]); });
    let x = R.marge, y = R.marge, hauteurRang = 0;
    travail = ordre.map(p => {
      const bb = boitePiece(p), w = bb[2] - bb[0], h = bb[3] - bb[1];
      if (x > R.marge && x + w > R.marge + R.largeurRangement) { x = R.marge; y += hauteurRang + R.jeu; hauteurRang = 0; }
      const place = deplacer(p, x - bb[0], y - bb[1]);
      x += w + R.jeu;
      hauteurRang = Math.max(hauteurRang, h);
      return place;
    });
  }

  // ---- contours orientés (extérieur direct, trous indirects) et angles arrondis
  let longueur = 0;
  for (const p of travail) {
    const prof = p.anneaux.map((r, i) => p.anneaux.reduce((s, r2, j) => s + (j !== i && G.anneauDans(r, r2) ? 1 : 0), 0));
    p.anneaux = p.anneaux.map((r, i) => {
      const sens = prof[i] % 2 ? -1 : 1;
      const oriente = G.aire(r) * sens < 0 ? [...r].reverse() : r;
      const arrondi = conge(oriente.map(q => [q[0], q[1]]), R.rayon);
      longueur += G.perimetre(arrondi);
      return arrondi;
    });
  }

  return { travail, longueur, ecart, mode: groupe ? 'dessin' : 'rangee' };
}

function deplacer(p, dx, dy) {
  return { ...p, anneaux: p.anneaux.map(r => r.map(q => [q[0] + dx, q[1] + dy])) };
}

const epaisseur = ep => `${fr(ep, 2)} mm`;

/** Nom de fichier lisible et trié dans l'ordre des groupes. */
export function nomFichier(f, index) {
  const propre = s => String(s).replace(/\//g, '-').replace(/[<>:"\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  return `${String(index + 1).padStart(2, '0')} - groupe ${f.groupes.join('+')} - ${propre(f.essence.nom)}.lbrn2`;
}

/** La bande d'Élodie pour tester une essence : les échelles 1400, 2000 et 2900 réunies, dans le dossier des tests. */
export const BANDE_FULL = 'ECHELLE DE PUISSANCE - full.lbrn2';

// Les pièces sortent SOUS la zone de travail, jamais dedans : rien ne peut partir à la découpe par oubli.
// Pour découper, on fait entrer dans la zone les seules pièces voulues.
export const HORS_ZONE = 25;             // de combien la feuille descend sous le bord bas du plateau

// Un rond à découper dans la chute : une fois le disque tombé, l'épingle passe par le trou et plaque
// la feuille sur le plateau quand elle n'est pas tout à fait plane.
export const ROND_EPINGLE = { rayon: 7.5 };

/** Le rond d'épingle, posé à gauche de la feuille, hors zone comme le reste. */
function rondEpingle(f, index) {
  const n = v => v.toFixed(4);
  const x = f.boite[0] - ROND_EPINGLE.rayon - 12;
  const y = -(HORS_ZONE - ROND_EPINGLE.rayon - 3);
  return `    <Shape Type="Ellipse" CutIndex="${index}" Rx="${n(ROND_EPINGLE.rayon)}" Ry="${n(ROND_EPINGLE.rayon)}">\n`
    + `        <XForm>1 0 0 1 ${n(x)} ${n(y)}</XForm>\n    </Shape>\n`;
}

const ENTETE = '<?xml version="1.0" encoding="UTF-8"?>\n<LightBurnProject AppVersion="1.7.04" DeviceName="Mecpow" FormatVersion="1" MaterialHeight="0" MirrorX="False" MirrorY="False">\n';
const notesXml = lignes => `    <Notes ShowOnLoad="1" Notes="${echap(lignes.join('\n')).replace(/\n/g, '&#10;')}"/>\n</LightBurnProject>\n`;

function calqueXml({ index, nom, puissance, vitesse, passes, kerf = 0, sortie = true }) {
  return '    <CutSetting type="Cut">\n'
    + `        <index Value="${index}"/>\n`
    + `        <name Value="${echap(nom)}"/>\n`
    + '        <minPower Value="10"/>\n'
    + `        <maxPower Value="${puissance}"/>\n`
    + '        <minPower2 Value="10"/>\n'
    + `        <maxPower2 Value="${puissance}"/>\n`
    + `        <speed Value="${(vitesse / 60).toFixed(4)}"/>\n`
    + `        <kerf Value="${kerf.toFixed(4)}"/>\n`
    + `        <numPasses Value="${passes}"/>\n`
    + '        <runBlower Value="1"/>\n'
    + `        <doOutput Value="${sortie ? 1 : 0}"/>\n`
    + `        <priority Value="${index}"/>\n`
    + '        <tabCount Value="1"/>\n'
    + '        <tabCountMax Value="1"/>\n'
    + '    </CutSetting>\n';
}

/**
 * Fichier LightBurn d'une feuille : un calque, compensation et réglage de l'essence, repères en notes.
 * Pour une essence à tester, la sortie du calque reste coupée tant que l'outil ne l'a pas réglé d'après la bande.
 */
export function fichierLightBurn(f, reglages = {}, titre = '') {
  const R = { ...REGLAGES_DEFAUT, ...reglages };
  const e = f.essence;
  const test = !!e.aTester;
  const n = v => v.toFixed(4);
  const dy = -(f.boite[3] + HORS_ZONE);           // toute la feuille passe sous la zone de travail
  const chemin = (p, retrait = '    ') => {
    let k = 0;
    const verts = [], prims = [];
    for (const r of p.anneaux) {
      for (const q of r) verts.push(`V${n(q[0])} ${n(q[1] + dy)}c0x1c1x1`);
      for (let i = 0; i < r.length; i++) prims.push(`L${k + i} ${k + (i + 1) % r.length}`);
      k += r.length;
    }
    return `${retrait}<Shape Type="Path" CutIndex="1">\n${retrait}    <XForm>1 0 0 1 0 0</XForm>\n${retrait}    <VertList>${verts.join('')}</VertList>\n${retrait}    <PrimList>${prims.join('')}</PrimList>\n${retrait}</Shape>\n`;
  };
  // les encarts : cadre et nom du morceau, sur un calque qui ne sort pas
  const encarts = f.encarts ?? [];
  // un encart = un groupe LightBurn : on attrape et on déplace tout un morceau d'un seul clic
  const formes = encarts.length
    ? encarts.map(e => {
      const dedans = f.pieces.filter(p => (p.morceau ?? null) === e.nom);
      if (!dedans.length) return '';
      return `    <Shape Type="Group">\n        <XForm>1 0 0 1 0 0</XForm>\n        <Children>\n${dedans.map(p => chemin(p, '            ')).join('')}        </Children>\n    </Shape>\n`;
    }).join('') + f.pieces.filter(p => !encarts.some(e => e.nom === (p.morceau ?? null))).map(p => chemin(p)).join('')
    : f.pieces.map(p => chemin(p)).join('');
  const cadres = encarts.map(e => {
    const [x0, y0, x1, y1] = e.boite, w = x1 - x0, h = y1 - y0;
    return `    <Shape Type="Rect" CutIndex="0" W="${n(w)}" H="${n(h)}" Cr="0">\n        <XForm>1 0 0 1 ${n(x0 + w / 2)} ${n(y0 + h / 2 + dy)}</XForm>\n    </Shape>\n`
      + `    <Shape Type="Text" CutIndex="0" Font="Arial,-1,100,5,50,0,0,0,0,0" Str="${echap(`${e.nom} · ${e.pieces} pièce${e.pieces > 1 ? 's' : ''}`)}" H="3.000" LS="0" LnS="0" Ah="0" Av="1" Bold="0" OldWidth="1" Weld="1" ForceCase="0">\n        <XForm>1 0 0 1 ${n(x0 + 2)} ${n(y1 - 4 + dy)}</XForm>\n    </Shape>\n`;
  }).join('');
  const calqueEncarts = encarts.length ? calqueXml({ index: 0, nom: 'Encarts (ne sort pas)', puissance: 10, vitesse: 3000, passes: 1, sortie: false }) : '';
  const calque = calqueXml({
    index: 1,
    nom: test ? `Pièces ${e.nom} — à régler après la bande` : `${e.nom} ${epaisseur(e.epaisseur)}`,
    puissance: test ? 100 : e.puissance, vitesse: e.vitesse, passes: e.passes, kerf: R.compensation, sortie: !test,
  });
  // le rond d'épingle prend les réglages de l'essence : il se découpe dans la même feuille
  const calqueRond = calqueXml({
    index: 2, nom: 'Rond d’épingle', puissance: test ? 100 : e.puissance, vitesse: e.vitesse, passes: e.passes,
    kerf: R.compensation, sortie: !test,
  });
  const notes = (test ? [
    `${titre ? titre + ' — ' : ''}${e.nom} (${epaisseur(e.epaisseur)}), essence à tester`,
    'Pas encore réglée : la sortie du calque est coupée.',
    `1. Lance d’abord ta bande FULL (01-tests, ${BANDE_FULL}) dans un coin de la feuille.`,
    '2. Entre dans l’outil d’atelier la première case qui se détache : il règle ce fichier.',
    '3. Ouvre ensuite ce fichier et lance.',
  ] : [
    `${titre ? titre + ' — ' : ''}${e.nom} (${epaisseur(e.epaisseur)})`,
    `${e.vitesse} mm/min, ${e.puissance} %, ${e.passes} passes, compensation ${fr(R.compensation, 3)} mm.${e.repli ? ` Si ça ne traverse pas : ${e.repli}.` : ''}`,
  ]).concat([
    `Bande : ${fr(f.bande[0])} x ${fr(f.bande[1])} mm. Toutes les pièces sont tournées pour que leur flèche pointe vers le haut : présente la feuille fil vers le haut, et racle dans ce sens.`,
    f.mode === 'rangee' ? 'Pièces rangées une à une (fils différents) : garde le dessin sous les yeux pour les reconnaître.' : f.mode === 'mixte' ? 'Pièces disposées comme sur le dessin ou rangées, selon l’encart.' : 'Pièces disposées comme sur le dessin.',
    ...(encarts.length ? [`Encarts : ${encarts.map(e => `${e.nom} (${e.pieces})`).join(', ')}. Les cadres et les noms sont sur le calque « Encarts » : ils ne sortent pas. Lance les encarts que tu veux.`] : []),
    `Les pièces sont posées SOUS la zone de travail : rien ne peut partir par erreur. Sélectionne celles que tu veux, fais-les entrer dans la zone, et laisse les autres dehors.`,
    `Le rond de ${fr(ROND_EPINGLE.rayon * 2)} mm sur le calque « Rond d’épingle » se découpe dans la chute : le disque tombe, et l’épingle qui passe par le trou plaque la feuille quand elle gondole.`,
    'Mise au point à refaire pour cette feuille. Pas de ruban clair sur le trait de coupe.',
  ]);
  return ENTETE + calqueEncarts + calque + calqueRond + cadres + formes + rondEpingle(f, 2) + notesXml(notes);
}

/**
 * Une seule feuille, mais un calque par essence : pour un fichier de rattrapage où les pièces à refaire
 * viennent d'essences différentes et qu'on ne veut pas éclater en dix fichiers.
 * `lots` : [{ essence, ids }] — chaque pièce part sur le calque de son essence, déjà réglé.
 */
export function fichierLightBurnMelange(f, lots, reglages = {}, titre = '') {
  const R = { ...REGLAGES_DEFAUT, ...reglages };
  const n = v => v.toFixed(4);
  const dy = -(f.boite[3] + HORS_ZONE);           // toute la feuille passe sous la zone de travail
  const calqueDe = new Map();
  lots.forEach((lot, i) => { for (const id of lot.ids) calqueDe.set(id, i + 1); });
  const chemin = (p, retrait = '    ') => {
    let k = 0;
    const verts = [], prims = [];
    for (const r of p.anneaux) {
      for (const q of r) verts.push(`V${n(q[0])} ${n(q[1] + dy)}c0x1c1x1`);
      for (let i = 0; i < r.length; i++) prims.push(`L${k + i} ${k + (i + 1) % r.length}`);
      k += r.length;
    }
    return `${retrait}<Shape Type="Path" CutIndex="${calqueDe.get(p.id) ?? 1}">\n${retrait}    <XForm>1 0 0 1 0 0</XForm>\n${retrait}    <VertList>${verts.join('')}</VertList>\n${retrait}    <PrimList>${prims.join('')}</PrimList>\n${retrait}</Shape>\n`;
  };
  const encarts = f.encarts ?? [];
  const formes = encarts.length
    ? encarts.map(e => {
      const dedans = f.pieces.filter(p => (p.morceau ?? null) === e.nom);
      if (!dedans.length) return '';
      return `    <Shape Type="Group">\n        <XForm>1 0 0 1 0 0</XForm>\n        <Children>\n${dedans.map(p => chemin(p, '            ')).join('')}        </Children>\n    </Shape>\n`;
    }).join('') + f.pieces.filter(p => !encarts.some(e => e.nom === (p.morceau ?? null))).map(p => chemin(p)).join('')
    : f.pieces.map(p => chemin(p)).join('');
  const cadres = encarts.map(e => {
    const [x0, y0, x1, y1] = e.boite, w = x1 - x0, h = y1 - y0;
    return `    <Shape Type="Rect" CutIndex="0" W="${n(w)}" H="${n(h)}" Cr="0">\n        <XForm>1 0 0 1 ${n(x0 + w / 2)} ${n(y0 + h / 2 + dy)}</XForm>\n    </Shape>\n`
      + `    <Shape Type="Text" CutIndex="0" Font="Arial,-1,100,5,50,0,0,0,0,0" Str="${echap(`${e.nom} · ${e.pieces} pièce${e.pieces > 1 ? 's' : ''}`)}" H="3.000" LS="0" LnS="0" Ah="0" Av="1" Bold="0" OldWidth="1" Weld="1" ForceCase="0">\n        <XForm>1 0 0 1 ${n(x0 + 2)} ${n(y1 - 4 + dy)}</XForm>\n    </Shape>\n`;
  }).join('');
  const calqueEncarts = calqueXml({ index: 0, nom: 'Repères (ne sort pas)', puissance: 10, vitesse: 3000, passes: 1, sortie: false });
  const calques = lots.map((lot, i) => {
    const e = lot.essence;
    return calqueXml({
      index: i + 1,
      nom: e.aTester ? `${e.nom} — à régler après la bande` : `${e.nom} ${epaisseur(e.epaisseur)}`,
      puissance: e.aTester ? 100 : e.puissance, vitesse: e.vitesse, passes: e.passes, kerf: R.compensation, sortie: !e.aTester,
    });
  }).join('');
  // le rond d'épingle, réglé comme la première essence de la feuille
  const premiere = lots[0].essence;
  const calqueRond = calqueXml({
    index: lots.length + 1, nom: 'Rond d’épingle', puissance: premiere.aTester ? 100 : premiere.puissance,
    vitesse: premiere.vitesse, passes: premiere.passes, kerf: R.compensation, sortie: !premiere.aTester,
  });
  const notes = [
    `${titre ? titre + ' — ' : ''}${f.pieces.length} pièces à refaire, ${lots.length} essences`,
    'Un calque par essence, déjà réglé : lance un calque à la fois, avec la feuille qui va avec.',
    ...lots.map((lot, i) => `  ${i + 1}. ${lot.essence.nom} (${epaisseur(lot.essence.epaisseur)}) — ${lot.ids.length} pièce${lot.ids.length > 1 ? 's' : ''}`
      + (lot.essence.aTester ? ' — à régler, sortie coupée' : ` — ${lot.essence.vitesse} mm/min, ${lot.essence.puissance} %, ${lot.essence.passes} passes`)),
    `Bande : ${fr(f.bande[0])} x ${fr(f.bande[1])} mm. Toutes les pièces sont tournées pour que leur flèche pointe vers le haut : présente la feuille fil vers le haut, et racle dans ce sens.`,
    ...(encarts.length ? ['Les cadres et les noms sont sur le calque « Repères » : ils ne sortent pas.'] : []),
    `Les pièces sont posées SOUS la zone de travail : rien ne peut partir par erreur. Sélectionne celles que tu veux, fais-les entrer dans la zone, et laisse les autres dehors.`,
    `Le rond de ${fr(ROND_EPINGLE.rayon * 2)} mm sur le calque « Rond d’épingle » se découpe dans la chute : le disque tombe, et l’épingle qui passe par le trou plaque la feuille quand elle gondole.`,
    'Mise au point à refaire pour chaque feuille. Pas de ruban clair sur le trait de coupe.',
  ];
  return ENTETE + calqueEncarts + calques + calqueRond + cadres + formes + rondEpingle(f, lots.length + 1) + notesXml(notes);
}

/**
 * Règle une feuille d'après sa bande de test : les calques qui portent des pièces prennent le réglage et leur sortie
 * s'ouvre ; les autres calques (une ancienne bande intégrée) ne sortent plus. Seuls les calques changent.
 */
export function reglerFichierLightBurn(texte, { vitesse, puissance, passes = 2, nom }) {
  const indexPieces = new Set();
  for (const m of texte.matchAll(/<Shape\b[^>]*>/g)) {
    const index = /\sCutIndex="(\d+)"/.exec(m[0]);
    if (/\sType="(Path|Ellipse)"/.test(m[0]) && index) indexPieces.add(+index[1]);
  }
  if (!indexPieces.size) throw new Error('ce fichier n’a pas de pièces à régler');
  const poser = (bloc, balise, valeur) => {
    const re = new RegExp(`<${balise} Value="[^"]*"\\s*/>`);
    return re.test(bloc) ? bloc.replace(re, `<${balise} Value="${valeur}"/>`)
      : bloc.replace(/(<index Value="\d+"\s*\/>)/, `$1\n        <${balise} Value="${valeur}"/>`);
  };
  let regles = 0;
  const sortie = texte.replace(/<CutSetting\b[\s\S]*?<\/CutSetting>/g, bloc => {
    const index = +(/<index Value="(\d+)"/.exec(bloc)?.[1] ?? -1);
    if (!indexPieces.has(index)) return poser(bloc, 'doOutput', 0);
    regles++;
    let b = poser(bloc, 'doOutput', 1);
    b = poser(b, 'maxPower', puissance);
    b = poser(b, 'maxPower2', puissance);
    b = poser(b, 'speed', (vitesse / 60).toFixed(4));
    b = poser(b, 'numPasses', passes);
    if (nom) b = poser(b, 'name', echap(nom));
    return b;
  });
  if (!regles) throw new Error('ce fichier n’a pas de calque de pièces à régler');
  return sortie;
}

/** Aperçu SVG d'une feuille (repère LightBurn remis à l'endroit pour l'écran). */
export function apercuFeuille(f, couleur = '#c9a27a') {
  const [x0, y0, x1, y1] = f.boite;
  const m = Math.max(x1 - x0, y1 - y0) * 0.04 + 1;
  const d = f.pieces.map(p => p.anneaux.map(r => `M${r.map(q => `${(q[0]).toFixed(2)} ${(-q[1]).toFixed(2)}`).join('L')}Z`).join('')).join('');
  const t = Math.max(x1 - x0, y1 - y0) / 400;
  const cadres = (f.encarts ?? []).map(e => `<rect x="${e.boite[0].toFixed(2)}" y="${(-e.boite[3]).toFixed(2)}" width="${(e.boite[2] - e.boite[0]).toFixed(2)}" height="${(e.boite[3] - e.boite[1]).toFixed(2)}" fill="none" stroke="#7a7466" stroke-width="${t.toFixed(3)}" stroke-dasharray="${(4 * t).toFixed(3)} ${(3 * t).toFixed(3)}"/>`
    + `<text x="${(e.boite[0] + 2).toFixed(2)}" y="${(-e.boite[3] + 4.2).toFixed(2)}" font-size="3.2" font-family="Segoe UI, system-ui, sans-serif" fill="#7a7466">${echap(e.nom)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(x0 - m).toFixed(2)} ${(-y1 - m).toFixed(2)} ${(x1 - x0 + 2 * m).toFixed(2)} ${(y1 - y0 + 2 * m).toFixed(2)}" preserveAspectRatio="xMidYMid meet">`
    + cadres + `<path d="${d}" fill="${couleur}" fill-rule="evenodd" stroke="#3b2a1a" stroke-width="${t.toFixed(3)}"/></svg>`;
}

const duree = min => (min < 1 ? 'moins d’une minute' : min < 60 ? `${fr(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`);

/** Pour un morceau : le dessin complet en gris, le morceau dans les teintes de ses essences, pour savoir où il va. */
function planMorceau(preparation) {
  const v = preparation.verification, m = v.morceau, p = m.page;
  const n = x => x.toFixed(2);
  const teinte = new Map(preparation.feuilles.flatMap(f => f.groupes.map(g => [g, f.essence.teinte || '#c9a27a'])));
  const chemin = pc => pc.anneaux.map(r => `M${r.map(q => `${n(q[0])} ${n(q[1])}`).join('L')}Z`).join('');
  const trait = n(Math.max(p.largeur, p.hauteur) / 500);
  const largeur = 200, hauteur = Math.round(largeur * p.hauteur / p.largeur);
  return `<figure class="morceau"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(p.largeur)} ${n(p.hauteur)}" width="${largeur}" height="${hauteur}" preserveAspectRatio="xMidYMid meet">`
    + `<rect width="${n(p.largeur)}" height="${n(p.hauteur)}" fill="#f4f2ec"/>`
    + `<g fill="#e6e2d8" stroke="#c9c4b8" stroke-width="${trait}" stroke-linejoin="round">${m.autres.map(pc => `<path d="${chemin(pc)}" fill-rule="evenodd"/>`).join('')}</g>`
    + `<g stroke="#2b2520" stroke-width="${trait}" stroke-linejoin="round">${v.pieces.map(pc => `<path d="${chemin(pc)}" fill="${echap(teinte.get(pc.groupe) ?? '#c9a27a')}" fill-rule="evenodd"/>`).join('')}</g></svg>`
    + `<figcaption><strong>Où va ce morceau</strong><br>« ${echap(m.nom)} » : ${v.pieces.length} pièces sur les ${m.piecesReference} de <span class="fichier">${echap(m.reference)}</span>.<br><small>En gris, les autres morceaux. Garde les pièces de ce morceau ensemble jusqu’au montage.</small></figcaption></figure>`;
}

/** Fiche de découpe imprimable : l'ordre des feuilles, les réglages, les gestes à ne pas oublier. */
export function ficheDecoupe({ projet, declinaison, preparation, fichiers, reglages = {} }) {
  const R = { ...REGLAGES_DEFAUT, ...reglages };
  const t = preparation.taille;
  // ordre conseillé : par épaisseur (moins de mises au point), puis par vitesse
  const ordre = preparation.feuilles.map((f, i) => ({ f, fichier: fichiers[i] }))
    .sort((a, b) => b.f.essence.epaisseur - a.f.essence.epaisseur || b.f.essence.vitesse - a.f.essence.vitesse);
  const lignes = ordre.map(({ f, fichier }, i) => {
    const change = i > 0 && ordre[i - 1].f.essence.epaisseur !== f.essence.epaisseur;
    return `${change ? `<tr class="focale"><td colspan="6">Changement d’épaisseur : ${epaisseur(f.essence.epaisseur)} — refais la mise au point</td></tr>` : ''}
      <tr>
        <td class="case"><span></span></td>
        <td class="apercu">${apercuFeuille(f)}</td>
        <td><strong>${echap(f.essence.nom)}</strong><br><small>${epaisseur(f.essence.epaisseur)} · groupe${f.groupes.length > 1 ? 's' : ''} ${f.groupes.join(', ')}</small><br><small class="fichier">${echap(fichier)}</small>${f.encarts?.length ? `<br><small>Encarts : ${f.encarts.map(e => `${echap(e.nom)} (${e.pieces})`).join(' · ')}</small>` : ''}</td>
        <td class="n">${f.essence.aTester ? `<strong>à tester</strong><br>bande FULL dans un coin<br><small>régler dans l’outil avant de lancer</small>` : `${f.essence.vitesse} mm/min<br>${f.essence.puissance} % × ${f.essence.passes}${f.essence.repli ? `<br><small>si ça ne traverse pas : ${echap(f.essence.repli)}</small>` : ''}`}</td>
        <td class="n">${fr(f.bande[0])} × ${fr(f.bande[1])} mm<br><small>${f.pieces.length} pièce${f.pieces.length > 1 ? 's' : ''}${f.mode === 'rangee' ? ', rangées' : ''}</small></td>
        <td class="n">${duree(f.minutes)}${f.fragiles.length ? `<br><small class="alerte">${f.fragiles.length} fragile${f.fragiles.length > 1 ? 's' : ''}</small>` : ''}</td>
      </tr>`;
  }).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fiche de découpe — ${echap(projet)} — ${echap(declinaison)}</title>
<style>
  body { margin: 0; font: 14px/1.5 "Segoe UI", system-ui, sans-serif; color: #1c1d21; background: #fff; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 28px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  .sous { color: #54565e; margin: 0 0 20px; }
  .gestes { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 12px 16px; border-left: 4px solid #2e4bd8; background: #eef1fc; margin: 0 0 22px; }
  .defile { overflow-x: auto; }
  table { width: 100%; min-width: 640px; border-collapse: collapse; }
  th { text-align: left; font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: #85878e; padding: 6px 8px; border-bottom: 2px solid #1c1d21; }
  td { padding: 8px; border-bottom: 1px solid #dedcd4; vertical-align: middle; }
  td.n { font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.apercu { width: 90px; } td.apercu svg { width: 80px; height: 80px; display: block; }
  td.case span { display: inline-block; width: 18px; height: 18px; border: 2px solid #1c1d21; border-radius: 4px; }
  tr.focale td { background: #f7eedb; color: #93600a; font-weight: 600; font-size: 13px; }
  small { color: #54565e; } .fichier { font-family: Consolas, monospace; font-size: 11.5px; } .alerte { color: #b93a2e; font-weight: 600; }
  .totaux { margin-top: 16px; color: #54565e; }
  .morceau { display: flex; flex-wrap: wrap; gap: 14px 20px; align-items: center; margin: 0 0 22px; }
  .morceau svg { flex: none; max-width: 100%; height: auto; border: 1px solid #dedcd4; }
  @media print { main { padding: 0; } .gestes { -webkit-print-color-adjust: exact; print-color-adjust: exact; } tr { break-inside: avoid; } }
</style></head><body><main>
  <h1>${echap(projet)}</h1>
  <p class="sous">${echap(declinaison)} · ${fr(t.largeur)} × ${fr(t.hauteur)} mm · ${preparation.feuilles.length} feuilles · ${preparation.totaux.pieces} pièces · compensation ${fr(R.compensation, 3)} mm</p>
  <div class="gestes"><span><strong>Avant chaque feuille :</strong></span><span>mise au point</span><span>air <em>high</em></span><span>cadrer</span><span>fil dans le sens de la hauteur</span><span>pas de ruban clair sur les traits</span></div>
  ${preparation.verification?.morceau ? planMorceau(preparation) : ''}
  <div class="defile"><table>
    <thead><tr><th></th><th>Feuille</th><th>Essence</th><th>Réglage</th><th>Bande</th><th>Temps</th></tr></thead>
    <tbody>${lignes}</tbody>
  </table></div>
  <p class="totaux">Temps de découpe estimé : ${duree(preparation.totaux.minutes)} (hors mise en place). Surface de bandes : ${fr(preparation.totaux.surface / 100)} cm².</p>
</main></body></html>`;
}

/** Le dessin avec ses couleurs d'Inkscape, pour la feuille de route. */
function apercuCouleurs(v) {
  const p = v.page;
  const n = x => x.toFixed(2);
  const trait = Math.max(p.largeur, p.hauteur) / 600;
  const formes = v.pieces.map(pc => `<path d="${pc.anneaux.map(r => `M${r.map(q => `${n(q[0])} ${n(q[1])}`).join('L')}Z`).join('')}" fill="${echap(pc.couleur ?? '#ddd')}" fill-rule="evenodd"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(p.largeur)} ${n(p.hauteur)}" preserveAspectRatio="xMidYMid meet"><g stroke="#2b2520" stroke-width="${n(trait)}" stroke-linejoin="round">${formes}</g></svg>`;
}

/**
 * Feuille de route A4 à imprimer avant de choisir les essences : le récapitulatif, le dessin en couleurs,
 * puis chaque groupe avec la taille de placage à prévoir et de quoi noter l'essence retenue.
 */
export function ficheDeRoute({ projet, dimension, route, marge = 10 }) {
  const t = route.taille, v = route.verification;
  const cartes = route.feuilles.map(f => `
    <article class="groupe">
      <div class="vignette">${apercuFeuille(f, f.couleur)}</div>
      <div class="texte">
        <h3><span class="pastille" style="background:${echap(f.couleur)}"></span>Groupe ${f.groupes[0]}</h3>
        <p><strong>${f.pieces.length} pièce${f.pieces.length > 1 ? 's' : ''}</strong> · bande de ${fr(f.bande[0])} × ${fr(f.bande[1])} mm</p>
        <p class="petit">Prévoir ${fr(f.bande[0] + marge)} × ${fr(f.bande[1] + marge)} mm, fil dans la hauteur${f.mode === 'rangee' ? ' · pièces rangées (fils différents)' : ''}</p>
        ${f.fragiles.length ? `<p class="petit alerte">${f.fragiles.length} pièce${f.fragiles.length > 1 ? 's' : ''} très fine${f.fragiles.length > 1 ? 's' : ''} : éviter un placage cassant</p>` : ''}
        <p class="ecrire">Essence <span></span></p>
        <p class="ecrire">Épaisseur <span class="court"></span></p>
      </div>
    </article>`).join('');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feuille de route — ${echap(projet)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.4 "Segoe UI", system-ui, sans-serif; color: #1c1d21; background: #fff; }
  main { max-width: 186mm; margin: 0 auto; padding: 10mm 4mm; }
  .imprimer { position: fixed; top: 12px; right: 12px; padding: 8px 16px; border-radius: 8px; border: 0; background: #2e4bd8; color: #fff; font: 600 14px system-ui; cursor: pointer; }
  header { display: grid; grid-template-columns: 1fr 62mm; gap: 8mm; align-items: start; border-bottom: 2px solid #1c1d21; padding-bottom: 6mm; margin-bottom: 6mm; }
  h1 { font-size: 22pt; margin: 0 0 2mm; letter-spacing: -0.01em; }
  .sous { margin: 0 0 4mm; color: #54565e; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 1.5mm 5mm; margin: 0; }
  dt { color: #54565e; } dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
  .dessin { border: 1px solid #dedcd4; padding: 2mm; border-radius: 2mm; } .dessin svg { display: block; width: 100%; max-height: 80mm; }
  .grille { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .groupe { display: grid; grid-template-columns: 26mm 1fr; gap: 4mm; padding: 3mm; border: 1px solid #cfccc3; border-radius: 2mm; break-inside: avoid; }
  .vignette { background: #f1eee7; border-radius: 1.5mm; aspect-ratio: 1; padding: 1mm; } .vignette svg { width: 100%; height: 100%; display: block; }
  h3 { margin: 0 0 1mm; font-size: 12pt; display: flex; align-items: center; gap: 2mm; }
  .pastille { width: 4.5mm; height: 4.5mm; border-radius: 1mm; border: 1px solid rgb(0 0 0 / .35); display: inline-block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .texte p { margin: 0 0 1mm; } .petit { font-size: 9pt; color: #54565e; } .alerte { color: #b93a2e; font-weight: 600; }
  .ecrire { display: flex; align-items: flex-end; gap: 2mm; margin-top: 2.5mm !important; font-size: 9.5pt; color: #54565e; }
  .ecrire span { flex: 1; border-bottom: 1px solid #85878e; height: 4.5mm; } .ecrire span.court { flex: 0 0 14mm; }
  .pied { margin-top: 6mm; font-size: 9pt; color: #54565e; }
  @media screen and (max-width: 760px) { header, .grille { grid-template-columns: 1fr; } .dessin { max-width: 70mm; } }
  @media print { .imprimer { display: none; } main { padding: 0; } .dessin, .vignette { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<button class="imprimer" onclick="print()">Imprimer</button>
<main>
  <header>
    <div>
      <h1>${echap(projet)}</h1>
      <p class="sous">Feuille de route — pour choisir les placages à l’atelier</p>
      <dl>
        <dt>Taille voulue</dt><dd>${fr(dimension.mm)} mm de ${dimension.sens === 'largeur' ? 'large' : 'haut'}</dd>
        <dt>Format final</dt><dd>${fr(t.largeur)} × ${fr(t.hauteur)} mm</dd>
        <dt>Pièces</dt><dd>${route.totaux.pieces} en ${route.feuilles.length} groupes</dd>
        <dt>Placage à prévoir</dt><dd>≈ ${fr(route.feuilles.reduce((s, f) => s + (f.bande[0] + marge) * (f.bande[1] + marge), 0) / 100)} cm² au total</dd>
        <dt>Date</dt><dd>${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
      </dl>
    </div>
    <div class="dessin">${apercuCouleurs(v)}</div>
  </header>
  <div class="grille">${cartes}</div>
  <p class="pied">Deux groupes peuvent partager une essence : l’outil les réunira sur une seule feuille. Les réglages laser viendront au moment de préparer la découpe.</p>
</main></body></html>`;
}
