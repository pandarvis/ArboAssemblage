// Les pièces marquées « à redécouper » : elles vivent sur le téléphone, et survivent à la fermeture.
// Un dépôt par déclinaison, pour que le renard blanc et le renard roux ne se mélangent jamais.

/** La clé d'une déclinaison dans le stockage du navigateur. */
export const cleDe = (dossier, declinaison) => `arbo:refaire:${dossier}:${declinaison}`;

/** Un dépôt de secours, quand le navigateur refuse de stocker (navigation privée, par exemple). */
export function memoire() {
  const valeurs = new Map();
  return {
    getItem: cle => (valeurs.has(cle) ? valeurs.get(cle) : null),
    setItem: (cle, valeur) => valeurs.set(cle, String(valeur)),
    removeItem: cle => valeurs.delete(cle),
  };
}

/**
 * Ouvre le carnet des pièces à redécouper d'une déclinaison.
 * Le stockage est injecté : localStorage dans le navigateur, autre chose dans les tests.
 */
export function marques(dossier, declinaison, stockage = memoire()) {
  const cle = cleDe(dossier, declinaison);
  let liste = [];
  try {
    const brut = stockage.getItem(cle);
    if (brut) liste = JSON.parse(brut).filter(x => typeof x === 'string');
  } catch { /* un carnet illisible repart de zéro, ce n'est jamais qu'une liste */ }
  const dedans = new Set(liste);

  const garder = () => {
    try {
      stockage.setItem(cle, JSON.stringify([...dedans]));
    } catch { /* tant pis : la session en cours marche quand même */ }
  };

  return {
    get taille() { return dedans.size; },
    a: id => dedans.has(id),
    liste: () => [...dedans],
    /** Marque ou démarque, et renvoie l'état après coup. */
    basculer(id) {
      if (!id) return false;
      if (dedans.has(id)) dedans.delete(id); else dedans.add(id);
      garder();
      return dedans.has(id);
    },
    poser(id) { if (id && !dedans.has(id)) { dedans.add(id); garder(); } return true; },
    enlever(id) { if (dedans.delete(id)) garder(); return false; },
    vider() { dedans.clear(); garder(); },
  };
}

/** Ce qui est marqué, rangé par essence : ce que le serveur va transformer en feuille de redécoupe. */
export function recapitulatif(modele, carnet) {
  const lots = new Map();
  for (const p of modele.pieces) {
    if (!carnet.a(p.id)) continue;
    if (!lots.has(p.essence)) lots.set(p.essence, []);
    lots.get(p.essence).push(p);
  }
  return [...lots].map(([id, pieces]) => ({
    essence: modele.essences[id] ?? { id, nom: 'essence inconnue' },
    pieces,
  })).sort((a, b) => b.pieces.length - a.pieces.length);
}
