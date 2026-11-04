// Le modèle d'assemblage : ce qu'il faut savoir, une fois la découpe faite, pour recomposer le motif.
// Chaque pièce porte son contour à la taille finale, son groupe et son essence. C'est ce que le client affiche.
import { verifier } from './vendu/audit.js';
import { essencesDe } from './projets.js';

const arrondi = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

/**
 * Construit le modèle d'une déclinaison à partir de son dessin.
 * Renvoie { projet, declinaison, taille, pieces, essences, feuilles } — tout en millimètres.
 */
export function assemblage(projet, declinaison, source) {
  const v = verifier(source);
  const erreurs = v.constats.filter(c => c.niveau === 'erreur');
  if (erreurs.length) {
    throw new Error(`Le dessin de « ${projet.nom} » ne passe pas la vérification : ${erreurs.map(c => c.code).join(', ')}`);
  }
  const { sens, mm } = declinaison.dimension ?? {};
  if (!mm) throw new Error('Cette déclinaison n’a pas de dimension finale.');
  const echelle = mm / (sens === 'largeur' ? v.page.largeur : v.page.hauteur);

  const essences = essencesDe(declinaison);
  const feuilleDuGroupe = {};
  for (const f of declinaison.feuilles ?? []) for (const g of f.groupes ?? []) feuilleDuGroupe[g] = f.fichier;

  const pieces = v.pieces.filter(p => p.etat === 'ok').map(p => ({
    id: p.id,
    groupe: p.groupe,
    essence: declinaison.affectations?.[p.groupe] ?? null,
    couleur: p.couleur ?? null,
    feuille: feuilleDuGroupe[p.groupe] ?? null,
    contour: p.anneaux.map(r => r.map(q => [arrondi(q[0] * echelle), arrondi(q[1] * echelle)])),
    taille: [arrondi((p.boite[2] - p.boite[0]) * echelle), arrondi((p.boite[3] - p.boite[1]) * echelle)],
  }));

  return {
    projet: projet.nom,
    dossier: projet.dossier,
    declinaison: declinaison.nom,
    taille: [arrondi(v.page.largeur * echelle), arrondi(v.page.hauteur * echelle)],
    pieces,
    essences: Object.fromEntries(Object.entries(essences).map(([id, e]) => [id, {
      id, nom: e.nom, epaisseur: e.epaisseur, vitesse: e.vitesse, puissance: e.puissance,
      passes: e.passes, teinte: e.teinte ?? null, aTester: !!e.aTester,
    }])),
  };
}

/** Les pièces d'un modèle, rangées par essence — l'ordre dans lequel on va chercher les feuilles de placage. */
export function parEssence(modele) {
  const lots = new Map();
  for (const p of modele.pieces) {
    if (!lots.has(p.essence)) lots.set(p.essence, []);
    lots.get(p.essence).push(p);
  }
  return [...lots].map(([id, pieces]) => ({ essence: modele.essences[id] ?? null, pieces }));
}
