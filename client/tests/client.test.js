import test from 'node:test';
import assert from 'node:assert/strict';
import { marques, recapitulatif, cleDe, memoire } from '../src/lib/marques.js';
import { cadrer, zoomer, deplacer, versDessin, estUnAppui, viser, geste, ancrer, ZOOM_MIN, ZOOM_MAX } from '../src/lib/vue.js';

const modele = {
  dossier: 'Damier', declinaison: '200 mm de large', taille: [200, 120],
  essences: { chene: { id: 'chene', nom: 'Chêne' }, noyer: { id: 'noyer', nom: 'Noyer' } },
  pieces: [
    { id: 'h1', essence: 'chene', contour: [[[0, 0], [68, 0], [68, 60], [0, 60]]] },
    { id: 'h2', essence: 'chene', contour: [[[68, 0], [134, 0], [134, 60], [68, 60]]] },
    { id: 'b1', essence: 'noyer', contour: [[[0, 60], [68, 60], [68, 120], [0, 120]]] },
  ],
};

test('le carnet des pièces à redécouper garde, relit et oublie', () => {
  const stockage = memoire();
  const carnet = marques('Damier', '200 mm de large', stockage);
  assert.equal(carnet.taille, 0);
  assert.equal(carnet.basculer('h1'), true);
  assert.equal(carnet.basculer('b1'), true);
  assert.equal(carnet.basculer('h1'), false, 'un second appui démarque');
  assert.deepEqual(carnet.liste(), ['b1']);

  // rouvert plus tard, le carnet se souvient
  const relu = marques('Damier', '200 mm de large', stockage);
  assert.deepEqual(relu.liste(), ['b1']);
  assert.ok(relu.a('b1'));

  // chaque déclinaison a le sien : le renard blanc n'est pas le renard roux
  const autre = marques('Damier', '400 mm de large', stockage);
  assert.equal(autre.taille, 0);
  assert.notEqual(cleDe('Damier', '200 mm de large'), cleDe('Damier', '400 mm de large'));

  relu.vider();
  assert.equal(marques('Damier', '200 mm de large', stockage).taille, 0);
});

test('un carnet illisible ou un stockage qui refuse ne bloquent rien', () => {
  const casse = memoire();
  casse.setItem(cleDe('Damier', '200 mm de large'), '{pas du json');
  assert.equal(marques('Damier', '200 mm de large', casse).taille, 0);

  const refuse = { getItem: () => null, setItem: () => { throw new Error('non'); }, removeItem: () => {} };
  const carnet = marques('Damier', '200 mm de large', refuse);
  assert.equal(carnet.basculer('h1'), true, 'la session en cours marche quand même');
  assert.ok(carnet.a('h1'));
});

test('le récapitulatif range les pièces marquées par essence, la plus fournie d’abord', () => {
  const carnet = marques('Damier', '200 mm de large');
  for (const id of ['h1', 'h2', 'b1']) carnet.poser(id);
  const lots = recapitulatif(modele, carnet);
  assert.deepEqual(lots.map(l => [l.essence.nom, l.pieces.length]), [['Chêne', 2], ['Noyer', 1]]);

  carnet.enlever('h2');
  assert.deepEqual(recapitulatif(modele, carnet).map(l => l.pieces.length), [1, 1]);
  carnet.vider();
  assert.deepEqual(recapitulatif(modele, carnet), []);
});

test('le cadrage de départ montre tout le motif, centré', () => {
  const ecran = { largeur: 390, hauteur: 780 };
  const vue = cadrer(modele.taille, ecran);
  // le motif fait 200 de large pour 390 px : c'est la largeur qui limite
  assert.ok(Math.abs(vue.k - (390 / 200) * 0.92) < 1e-9);
  const centre = versDessin(vue, { x: ecran.largeur / 2, y: ecran.hauteur / 2 });
  assert.ok(Math.abs(centre.x - 100) < 1e-6 && Math.abs(centre.y - 60) < 1e-6, 'le centre du motif est au centre');
  assert.deepEqual(cadrer([0, 0], ecran), { x: 0, y: 0, k: 1 }, 'un motif vide ne fait pas diviser par zéro');
});

test('zoomer laisse sous le doigt ce qui s’y trouvait, et reste dans les bornes', () => {
  const vue = { x: 10, y: 20, k: 2 };
  const doigt = { x: 150, y: 300 };
  const avant = versDessin(vue, doigt);
  const apres = versDessin(zoomer(vue, 1.7, doigt), doigt);
  assert.ok(Math.abs(avant.x - apres.x) < 1e-9 && Math.abs(avant.y - apres.y) < 1e-9);

  assert.equal(zoomer({ x: 0, y: 0, k: 1 }, 1e6, doigt).k, ZOOM_MAX);
  assert.equal(zoomer({ x: 0, y: 0, k: 1 }, 1e-6, doigt).k, ZOOM_MIN);
  assert.deepEqual(deplacer(vue, 5, -5), { x: 15, y: 15, k: 2 });
});

test('un appui se distingue d’un glissement', () => {
  const depart = { x: 100, y: 100, t: 1000 };
  assert.ok(estUnAppui(depart, { x: 103, y: 102, t: 1200 }));
  assert.ok(!estUnAppui(depart, { x: 140, y: 100, t: 1200 }), 'trop loin : c’est un déplacement');
  assert.ok(!estUnAppui(depart, { x: 100, y: 100, t: 2000 }), 'trop long : c’est autre chose');
});

test('viser une pièce l’amène au centre de l’écran', () => {
  const ecran = { largeur: 390, hauteur: 780 };
  const vue = viser(modele.pieces[2], ecran);
  const centre = versDessin(vue, { x: ecran.largeur / 2, y: ecran.hauteur / 2 });
  assert.ok(Math.abs(centre.x - 34) < 1e-6, `centre en x : ${centre.x}`);
  assert.ok(Math.abs(centre.y - 90) < 1e-6, `centre en y : ${centre.y}`);
  assert.ok(vue.k >= ZOOM_MIN && vue.k <= ZOOM_MAX);
});

test('le geste ne saute pas quand un doigt arrive ou s’en va', () => {
  const origine = { x: 0, y: 0 };
  let vue = { x: 0, y: 0, k: 2 };

  // un doigt qui glisse de 40 px vers la droite
  let doigts = [{ x: 100, y: 200 }];
  let ancre = ancrer(vue, doigts);
  vue = geste(ancre, [{ x: 140, y: 200 }], origine);
  assert.deepEqual(vue, { x: 40, y: 0, k: 2 });

  // un second doigt se pose : on réancre, et sans bouger rien ne change
  doigts = [{ x: 140, y: 200 }, { x: 240, y: 200 }];
  ancre = ancrer(vue, doigts);
  assert.deepEqual(geste(ancre, doigts, origine), vue, 'poser un doigt ne déplace pas le motif');

  // les doigts s'écartent du double : le zoom double, le point entre les doigts ne bouge pas
  const ecartes = [{ x: 90, y: 200 }, { x: 290, y: 200 }];
  const zoomee = geste(ancre, ecartes, origine);
  assert.ok(Math.abs(zoomee.k - 4) < 1e-9, `k = ${zoomee.k}`);
  const avant = versDessin(vue, { x: 190, y: 200 });
  const apres = versDessin(zoomee, { x: 190, y: 200 });
  assert.ok(Math.abs(avant.x - apres.x) < 1e-9 && Math.abs(avant.y - apres.y) < 1e-9);

  // un doigt se lève : on réancre sur celui qui reste, et là encore rien ne saute
  const reste = [{ x: 90, y: 200 }];
  const ancre2 = ancrer(zoomee, reste);
  assert.deepEqual(geste(ancre2, reste, origine), zoomee, 'lever un doigt ne déplace pas le motif');
  assert.deepEqual(geste(ancre2, [{ x: 100, y: 210 }], origine), { ...zoomee, x: zoomee.x + 10, y: zoomee.y + 10 });
});
