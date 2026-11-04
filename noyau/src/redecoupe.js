// Refaire les pièces cassées ou oubliées : une liste d'identifiants devient un fichier LightBurn,
// toutes essences confondues, avec un encart et un calque par essence, aux réglages du projet.
import { verifier } from './vendu/audit.js';
import { preparerDecoupe, fichierLightBurnMelange } from './vendu/decoupe.js';
import { essencesDe } from './projets.js';

// l'essence de passage : elle ne sert qu'à poser toutes les pièces sur une seule feuille
const MELANGE = { id: '_refaire', nom: 'à redécouper', epaisseur: 0.6, vitesse: 2000, puissance: 100, passes: 2 };

/**
 * Prépare la feuille des pièces à redécouper.
 * Renvoie { xml, lots, pieces, bande, ignorees } sans rien écrire sur le disque.
 */
export function redecoupe(projet, declinaison, source, identifiants) {
  const ids = [...new Set((identifiants ?? []).filter(x => typeof x === 'string' && x))];
  if (!ids.length) throw new Error('Aucune pièce à redécouper.');

  const essences = essencesDe(declinaison);
  const v = verifier(source);
  const connues = new Map(v.pieces.filter(p => p.etat === 'ok').map(p => [p.id, p]));

  const parEssence = new Map();
  const ignorees = [];
  for (const id of ids) {
    const piece = connues.get(id);
    if (!piece) { ignorees.push({ id, raison: 'cette pièce n’est plus dans le dessin' }); continue; }
    const essence = declinaison.affectations?.[piece.groupe];
    if (!essence || !essences[essence]) { ignorees.push({ id, raison: `groupe ${piece.groupe} sans essence connue` }); continue; }
    if (!parEssence.has(essence)) parEssence.set(essence, []);
    parEssence.get(essence).push(id);
  }
  if (!parEssence.size) throw new Error('Aucune de ces pièces n’a d’essence connue.');

  // un encart par essence, pour savoir d'un coup d'œil ce qui sort de quelle feuille de placage
  const morceaux = [...parEssence].map(([id, lot]) => ({ nom: essences[id].nom, ids: lot }));
  const affectations = Object.fromEntries(Object.keys(declinaison.affectations ?? {}).map(g => [g, MELANGE.id]));
  const prep = preparerDecoupe(source, declinaison.dimension, affectations, { [MELANGE.id]: MELANGE },
    declinaison.reglages, { morceaux, pieces: [...parEssence.values()].flat() });
  const feuille = prep.feuilles[0];
  const lots = [...parEssence].map(([id, lot]) => ({ essence: essences[id], ids: lot }));

  return {
    xml: fichierLightBurnMelange(feuille, lots, declinaison.reglages, projet.nom),
    lots: lots.map(l => ({ essence: l.essence.nom, pieces: l.ids.length })),
    pieces: feuille.pieces.length,
    bande: feuille.bande.map(x => Math.round(x)),
    ignorees,
  };
}

/** Le nom du fichier à poser dans le dossier de la déclinaison. */
export const nomDuFichier = (date = new Date()) => `à redécouper ${date.toISOString().slice(0, 10)}.lbrn2`;
