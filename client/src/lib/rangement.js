// Ranger les motifs comme ils le sont dans l'atelier : par catégorie, le plus récent en tête.
// Sans ce rangement, la liste n'est qu'un tas où les motifs déjà assemblés noient celui du jour.

export const SANS_CATEGORIE = 'Sans catégorie';

/** Une déclinaison, telle qu'on l'affiche : son projet, son nom, sa taille. */
const ligneDe = (p, d) => ({
  projet: p.dossier, nomProjet: p.nom, declinaison: d.nom,
  pieces: d.pieces ?? 0, cree: p.cree ?? null, categorie: p.categorie || SANS_CATEGORIE,
});

/**
 * Range les projets en sections.
 * `dernier` ({ projet, declinaison }) sort de sa catégorie pour une section « Reprendre » en tête.
 * Les catégories sont classées par leur motif le plus récent ; « Sans catégorie » ferme la marche.
 */
export function ranger(projets, dernier = null) {
  const lignes = (projets ?? []).flatMap(p => (p.declinaisons ?? []).map(d => ligneDe(p, d)));
  const estLeDernier = l => dernier && l.projet === dernier.projet && l.declinaison === dernier.declinaison;

  const reprendre = lignes.filter(estLeDernier);
  const sections = new Map();
  for (const l of lignes) {
    if (estLeDernier(l)) continue;
    if (!sections.has(l.categorie)) sections.set(l.categorie, []);
    sections.get(l.categorie).push(l);
  }

  const recence = liste => liste.reduce((max, l) => (String(l.cree ?? '') > max ? String(l.cree ?? '') : max), '');
  const rangees = [...sections].map(([titre, liste]) => ({
    titre,
    lignes: liste.sort((a, b) => String(b.cree ?? '').localeCompare(String(a.cree ?? ''))),
  })).sort((a, b) => {
    if (a.titre === SANS_CATEGORIE) return 1;                 // ce qui n'est pas rangé passe en dernier
    if (b.titre === SANS_CATEGORIE) return -1;
    return recence(b.lignes).localeCompare(recence(a.lignes));
  });

  return reprendre.length ? [{ titre: 'Reprendre', lignes: reprendre }, ...rangees] : rangees;
}
