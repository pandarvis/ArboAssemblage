import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { creerServeur } from '../src/serveur.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const EXEMPLE = join(ICI, '..', '..', 'noyau', 'exemple-atelier');
const CLIENT = join(ICI, '..', '..', 'client', 'src');

/** Un atelier jetable, copié depuis l'exemple : les tests écrivent dedans sans rien abîmer. */
async function atelier() {
  const dossier = await mkdtemp(join(tmpdir(), 'arbo-'));
  await cp(EXEMPLE, dossier, { recursive: true });
  return dossier;
}

/** Lance le serveur sur un port libre et renvoie de quoi l'interroger puis l'éteindre. */
async function lancer(mecpow, options = {}) {
  const serveur = creerServeur({ mecpow, client: CLIENT, ...options });
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  return {
    base,
    appel: (chemin, init) => fetch(base + chemin, init),
    fermer: () => new Promise(r => serveur.close(r)),
  };
}

test('l’API liste les projets de l’atelier et leurs déclinaisons', async () => {
  const mecpow = await atelier();
  const s = await lancer(mecpow);
  try {
    const r = await s.appel('/api/projets');
    assert.equal(r.status, 200);
    const projets = await r.json();
    assert.equal(projets.length, 1);
    assert.equal(projets[0].nom, 'Damier');
    assert.deepEqual(projets[0].declinaisons, [{ nom: '200 mm de large', dossier: '200 mm de large', pieces: 6 }]);
  } finally {
    await s.fermer();
    await rm(mecpow, { recursive: true, force: true });
  }
});

test('l’API rend le modèle d’assemblage, et dit non proprement quand le projet n’existe pas', async () => {
  const mecpow = await atelier();
  const s = await lancer(mecpow);
  try {
    const r = await s.appel('/api/assemblage/Damier/200 mm de large');
    assert.equal(r.status, 200);
    const m = await r.json();
    assert.deepEqual(m.taille, [200, 120]);
    assert.equal(m.pieces.length, 6);
    assert.equal(m.pieces[0].essence, 'chene');
    assert.equal(m.essences.noyer.nom, 'Noyer');

    const sansDeclinaison = await s.appel('/api/assemblage/Damier');
    assert.equal(sansDeclinaison.status, 200, 'sans préciser, on prend la dernière');

    const inconnu = await s.appel('/api/assemblage/Jamais vu');
    assert.equal(inconnu.status, 404);
    assert.match((await inconnu.json()).erreur, /introuvable/);

    const perdue = await s.appel('/api/assemblage/Damier/300 mm');
    assert.equal(perdue.status, 404);
  } finally {
    await s.fermer();
    await rm(mecpow, { recursive: true, force: true });
  }
});

test('envoyer les pièces à redécouper écrit le fichier LightBurn dans le projet', async () => {
  const mecpow = await atelier();
  const s = await lancer(mecpow, { maintenant: () => new Date('2026-11-04T09:00:00Z') });
  try {
    const r = await s.appel('/api/redecouper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projet: 'Damier', declinaison: '200 mm de large', pieces: ['h1', 'h3', 'b2'] }),
    });
    assert.equal(r.status, 201);
    const bilan = await r.json();
    assert.equal(bilan.fichier, 'à redécouper 2026-11-04.lbrn2');
    assert.equal(bilan.pieces, 3);
    assert.deepEqual(bilan.lots, [{ essence: 'Chêne', pieces: 2 }, { essence: 'Noyer', pieces: 1 }]);

    const xml = await readFile(join(mecpow, '02-projets', 'Damier', '200 mm de large', bilan.fichier), 'utf8');
    assert.match(xml, /Str="Chêne · 2 pièces"/);
    assert.match(xml, /<name Value="Noyer 0,9 mm"\/>/);

    // deux envois le même jour : le premier part dans les sauvegardes, rien n'est perdu
    const deuxieme = await s.appel('/api/redecouper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projet: 'Damier', declinaison: '200 mm de large', pieces: ['b1'] }),
    });
    assert.equal(deuxieme.status, 201);
    const garde = await readFile(join(mecpow, '02-projets', 'Damier', '200 mm de large', '_sauvegardes',
      'avant-ajout-2026-11-04', 'à redécouper 2026-11-04.lbrn2'), 'utf8');
    assert.match(garde, /Str="Chêne · 2 pièces"/, 'la version précédente est gardée');
  } finally {
    await s.fermer();
    await rm(mecpow, { recursive: true, force: true });
  }
});

test('une liste vide ou farfelue est refusée sans rien écrire', async () => {
  const mecpow = await atelier();
  const s = await lancer(mecpow);
  try {
    for (const corps of [{}, { projet: 'Damier', pieces: [] }, { projet: 'Damier', pieces: ['fantome'] }]) {
      const r = await s.appel('/api/redecouper', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
      });
      assert.ok(r.status === 400 || r.status === 404, `${JSON.stringify(corps)} → ${r.status}`);
    }
    const casse = await s.appel('/api/redecouper', { method: 'POST', body: 'pas du json' });
    assert.equal(casse.status, 400);
  } finally {
    await s.fermer();
    await rm(mecpow, { recursive: true, force: true });
  }
});

test('le serveur sert le client, et refuse de sortir de son dossier', async () => {
  const mecpow = await atelier();
  const s = await lancer(mecpow);
  try {
    const accueil = await s.appel('/');
    assert.equal(accueil.status, 200);
    assert.match(accueil.headers.get('content-type'), /text\/html/);
    assert.match(await accueil.text(), /<!doctype html>/i);

    const dehors = await fetch(`${s.base}/../serveur/src/serveur.js`);
    assert.ok(dehors.status === 403 || dehors.status === 404, `échappée bloquée (${dehors.status})`);

    const inconnu = await s.appel('/api/rien');
    assert.equal(inconnu.status, 404);
  } finally {
    await s.fermer();
    await rm(mecpow, { recursive: true, force: true });
  }
});
