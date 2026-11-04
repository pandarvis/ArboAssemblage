// Lire l'atelier : les projets de marqueterie et leurs déclinaisons, tels que l'outil d'atelier les range.
// Un projet = un dossier avec un projet.json ; une déclinaison = une taille donnée, avec ses essences.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Le dossier des projets, d'après l'emplacement de MECPOW. */
export const dossierProjets = mecpow => join(mecpow, '02-projets');

/** Un nom de dossier sûr : ni remontée, ni séparateur. */
export const nomSur = nom => String(nom ?? '').replace(/[\\/:*?"<>|]/g, '').replace(/^\.+/, '').trim();

/** Le projet.json d'un dossier, avec son dossier en prime. */
export async function lireProjet(mecpow, dossier) {
  const nom = nomSur(dossier);
  if (!nom) throw new Error('Nom de projet vide.');
  const brut = await readFile(join(dossierProjets(mecpow), nom, 'projet.json'), 'utf8');
  return { dossier: nom, ...JSON.parse(brut) };
}

/** Tous les projets de l'atelier, les plus récents d'abord, sans leurs dessins. */
export async function listerProjets(mecpow) {
  let entrees = [];
  try {
    entrees = await readdir(dossierProjets(mecpow), { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const projets = [];
  for (const e of entrees) {
    if (!e.isDirectory()) continue;
    try {
      projets.push(await lireProjet(mecpow, e.name));
    } catch { /* un dossier sans projet.json n'est pas un projet */ }
  }
  return projets.sort((a, b) => String(b.cree ?? '').localeCompare(String(a.cree ?? '')));
}

/** La déclinaison demandée, ou la dernière préparée. */
export function declinaisonDe(projet, nom = null) {
  const liste = projet.declinaisons ?? [];
  if (!liste.length) throw new Error(`« ${projet.nom} » n'a aucune déclinaison préparée.`);
  if (!nom) return liste.at(-1);
  const trouvee = liste.find(d => d.nom === nom || d.dossier === nom);
  if (!trouvee) throw new Error(`« ${nom} » n'est pas une déclinaison de « ${projet.nom} ».`);
  return trouvee;
}

/** Le dessin d'une déclinaison, lu dans le dossier du projet. */
export async function lireSource(mecpow, projet, declinaison) {
  const morceaux = String(declinaison.source ?? '').split('/').filter(Boolean).map(nomSur);
  if (!morceaux.length) throw new Error('Cette déclinaison n’a pas de dessin source.');
  return readFile(join(dossierProjets(mecpow), projet.dossier, ...morceaux), 'utf8');
}

/**
 * Les essences d'une déclinaison, y compris celles qui attendent encore leur réglage.
 * Une essence à tester change d'identifiant une fois réglée : l'affectation du groupe garde l'ancien.
 */
export function essencesDe(declinaison) {
  const essences = { ...(declinaison.essences ?? {}) };
  for (const f of declinaison.feuilles ?? []) {
    if (!essences[f.essence] && f.aTester) {
      essences[f.essence] = f.regle
        ? { id: f.essence, nom: f.aTester.nom, epaisseur: f.aTester.epaisseur, ...f.regle }
        : {
          id: f.essence, nom: f.aTester.nom, epaisseur: f.aTester.epaisseur,
          vitesse: f.aTester.vitesse, puissance: 100, passes: f.aTester.passes ?? 2, aTester: true,
        };
    }
    const affecte = declinaison.affectations?.[f.groupes?.[0]];
    if (affecte && !essences[affecte] && essences[f.essence]) essences[affecte] = { ...essences[f.essence], id: affecte };
  }
  return essences;
}
