import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listerProjets, lireProjet, declinaisonDe, lireSource, essencesDe, nomSur } from '../src/projets.js';
import { assemblage, parEssence } from '../src/assemblage.js';
import { redecoupe, nomDuFichier } from '../src/redecoupe.js';

const ICI = dirname(fileURLToPath(import.meta.url));
// l'exemple fait office d'atelier : un dossier « 02-projets » avec un seul projet dedans
const ATELIER = join(ICI, '..', 'exemple-atelier');
const DAMIER = join(ATELIER, '02-projets', 'Damier');
const projetDamier = () => JSON.parse(readFileSync(join(DAMIER, 'projet.json'), 'utf8'));
const sourceDamier = () => readFileSync(join(DAMIER, 'source', 'damier.svg'), 'utf8');
const damier = () => ({ ...projetDamier(), dossier: 'Damier' });

test('lire l’atelier : les projets, leurs déclinaisons, leurs essences', async () => {
  const projets = await listerProjets(ATELIER);
  assert.equal(projets.length, 1);
  assert.equal(projets[0].nom, 'Damier');
  assert.equal(projets[0].dossier, 'Damier');

  const projet = await lireProjet(ATELIER, 'Damier');
  const d = declinaisonDe(projet);
  assert.equal(d.nom, '200 mm de large');
  assert.equal(declinaisonDe(projet, '200 mm de large'), d, 'on peut la nommer');
  assert.throws(() => declinaisonDe(projet, 'jamais vue'), /n'est pas une déclinaison/);

  const source = await lireSource(ATELIER, projet, d);
  assert.match(source, /<svg/);
  assert.deepEqual(Object.keys(essencesDe(d)).sort(), ['chene', 'noyer']);
});

test('un atelier vide ou absent ne fait pas tomber la lecture', async () => {
  assert.deepEqual(await listerProjets(join(ICI, 'nulle-part')), []);
  assert.equal(nomSur('../../secret'), 'secret', 'pas de remontée de dossier');
  assert.equal(nomSur('Berceau'), 'Berceau');
});

test('le modèle d’assemblage : chaque pièce sait son essence et sa place, à la taille finale', () => {
  const projet = damier();
  const d = declinaisonDe(projet);
  const m = assemblage(projet, d, sourceDamier());

  assert.equal(m.projet, 'Damier');
  assert.equal(m.declinaison, '200 mm de large');
  // le dessin fait 100 × 60 mm, demandé en 200 mm de large : tout double
  assert.deepEqual(m.taille, [200, 120]);
  assert.equal(m.pieces.length, 6);

  const haut = m.pieces.find(p => p.id === 'h1');
  assert.equal(haut.groupe, 1);
  assert.equal(haut.essence, 'chene');
  assert.equal(haut.feuille, '01 - groupe 1 - Chêne.lbrn2');
  assert.deepEqual(haut.taille, [68, 60], 'la pièce fait bien le double de ses 34 × 30 mm');
  assert.ok(haut.contour[0].length >= 4);

  assert.equal(m.essences.chene.nom, 'Chêne');
  assert.equal(m.essences.noyer.epaisseur, 0.9);
  assert.equal(m.essences.chene.aTester, false);

  // rangées par essence, comme on va chercher les feuilles de placage
  const lots = parEssence(m).sort((a, b) => a.essence.id.localeCompare(b.essence.id));
  assert.deepEqual(lots.map(l => [l.essence.nom, l.pieces.length]), [['Chêne', 3], ['Noyer', 3]]);
});

test('un dessin qui ne passe pas la vérification est refusé, en disant pourquoi', () => {
  const projet = damier();
  const d = declinaisonDe(projet);
  const sansFleches = sourceDamier().replace(/<g inkscape:groupmode="layer"[\s\S]*?<\/g>/, '');
  assert.throws(() => assemblage(projet, d, sansFleches), /SANS_FLECHE/);
  assert.throws(() => assemblage(projet, { ...d, dimension: null }, sourceDamier()), /dimension finale/);
});

test('les pièces à redécouper : un encart et un calque par essence, aux réglages du projet', () => {
  const projet = damier();
  const d = declinaisonDe(projet);
  // deux chênes cassés, un noyer oublié
  const r = redecoupe(projet, d, sourceDamier(), ['h1', 'h3', 'b2']);

  assert.equal(r.pieces, 3);
  assert.deepEqual(r.lots, [{ essence: 'Chêne', pieces: 2 }, { essence: 'Noyer', pieces: 1 }]);
  assert.deepEqual(r.ignorees, []);

  // un calque de repères, un par essence, un pour le rond d'épingle
  assert.equal((r.xml.match(/<CutSetting/g) ?? []).length, 4);
  assert.match(r.xml, /<name Value="Chêne 0,6 mm"\/>/);
  assert.match(r.xml, /<name Value="Noyer 0,9 mm"\/>/);
  assert.match(r.xml, /<speed Value="23\.3333"\/>/, 'le chêne garde ses 1400 mm\/min');
  assert.match(r.xml, /Str="Chêne · 2 pièces"/);
  assert.match(r.xml, /Str="Noyer · 1 pièce"/);
  // les pièces attendent sous la zone de travail
  const hauteurs = [...r.xml.matchAll(/V(-?[\d.]+) (-?[\d.]+)c/g)].map(m => +m[2]);
  assert.ok(Math.max(...hauteurs) < 0, `tout est hors zone (le plus haut : ${Math.max(...hauteurs)})`);
});

test('redécoupe : les identifiants inconnus sont écartés, pas fatals', () => {
  const projet = damier();
  const d = declinaisonDe(projet);
  const r = redecoupe(projet, d, sourceDamier(), ['h1', 'h1', 'fantome']);
  assert.equal(r.pieces, 1, 'le doublon ne compte qu’une fois');
  assert.deepEqual(r.ignorees, [{ id: 'fantome', raison: 'cette pièce n’est plus dans le dessin' }]);
  assert.throws(() => redecoupe(projet, d, sourceDamier(), []), /Aucune pièce/);
  assert.throws(() => redecoupe(projet, d, sourceDamier(), ['fantome']), /essence connue/);
  assert.match(nomDuFichier(new Date('2026-11-04T10:00:00Z')), /^à redécouper 2026-11-04\.lbrn2$/);
});
