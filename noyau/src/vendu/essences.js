// Bibliothèque des essences : réglages de découpe validés à la machine, et calcul d'un réglage depuis une bande de test.

/** Réglages communs à toutes les découpes. */
export const REGLAGES_DEFAUT = {
  compensation: 0.08,      // mm par calque, validée à la jauge le 11/09/2026 pour toutes les essences
  rayon: 0.15,             // mm : arrondi des angles saillants, pour épouser les creux que le faisceau laisse ronds
  jeu: 2,                  // mm entre deux pièces rangées
  largeurRangement: 160,   // mm : largeur maximale d'une bande quand les pièces sont rangées
  marge: 10,               // mm autour des pièces dans le fichier LightBurn
  toleranceFil: 5,         // degrés : en deçà, on ne tourne pas une pièce pour redresser son fil
  ecartFilGroupe: 20,      // degrés : au-delà, les pièces d'une feuille sont tournées une à une
  largeurFragile: 0.8,     // mm : largeur moyenne sous laquelle une pièce est signalée fragile
};

export const VITESSES_BANDES = [1000, 1400, 2000, 2900];
/** Les cases de la bande FULL, basses énergies comprises, et les deux rangées de passes. */
export const PUISSANCES_BANDE = [20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100];
export const PASSES_BANDE = [1, 2];

const e = (nom, epaisseur, vitesse, puissance, extra = {}) => ({ id: slug(nom), nom, epaisseur, vitesse, puissance, passes: 2, ...extra });

/** Palette validée au carnet de réglages (09–12/09/2026). Les teintes sont des approximations à affiner à la pipette. */
export const ESSENCES_CARNET = [
  e('Sycomore', 0.9, 1400, 85, { repli: '100 %', seuil: 95, couleur: 'très clair', teinte: '#eee4cf' }),
  e('Sycomore teinté noir', 0.9, 2900, 85, { seuil: 47, couleur: 'noir', teinte: '#2a2725' }),
  e('Frêne', 0.9, 1400, 90, { repli: '100 %', seuil: 107, couleur: 'clair', teinte: '#e2d2b2' }),
  e('Chêne', 0.9, 1400, 70, { repli: '80 %', seuil: 78, couleur: 'moyen', teinte: '#c9a676' }),
  e('Charme 6/10', 0.6, 2000, 90, { couleur: 'clair', teinte: '#ebe1cb' }),
  e('Noyer', 0.9, 2000, 70, { repli: 'jusqu’à 100 %', seuil: 55, couleur: 'brun foncé', teinte: '#6e4f38' }),
  e('Noyer clair', 0.9, 2000, 70, { repli: 'jusqu’à 100 %', seuil: 55, note: 'même réglage que le noyer', teinte: '#9a7857' }),
  e('Noyer foncé', 0.9, 2000, 70, { repli: 'jusqu’à 100 %', seuil: 55, note: 'même réglage que le noyer', teinte: '#553b2a' }),
  e('Noyer français', 0.9, 2000, 70, { repli: 'jusqu’à 100 %', seuil: 55, note: 'vérifié à la bande : 60 coupe, 50 non', teinte: '#7a5a40' }),
  e('Eucalyptus fumé', 0.9, 2900, 70, { repli: '80 %', seuil: 38, couleur: 'brun fumé', teinte: '#857a70' }),
  e('Merisier (ventre du pivert)', 0.5, 2900, 70, { repli: '80 %', seuil: 38, note: 'essence incertaine, plus fin qu’un 6/10', teinte: '#c08a62' }),
  e('Bubinga', 0.9, 2000, 90, { repli: '100 %', seuil: 45, couleur: 'brun rouge', note: '2900 / 80 % a échoué sur la vraie pièce', teinte: '#8a4b38' }),
  e('Palissandre clair', 0.9, 2000, 100, { repli: 'descendre à 1400 / 80 %', seuil: 83, couleur: 'brun clair rosé', teinte: '#9c5f4b' }),
  e('Palissandre foncé', 0.9, 2900, 70, { repli: '80 %', seuil: 38, couleur: 'brun violacé foncé', teinte: '#5b3a33' }),
  e('Padouk 6/10', 0.6, 2900, 70, { repli: '80 %', seuil: 38, couleur: 'rouge vif', teinte: '#b4462b' }),
  e('Bois clair ondé', 0.9, 2900, 60, { seuil: 35, couleur: 'clair', note: 'essence inconnue, très léger', teinte: '#c79a66' }),
  e('Ronce de thuya', 0.9, 2900, 90, { repli: '100 %', seuil: 52, couleur: 'brun doré foncé', teinte: '#8a5a3c' }),
  e('Wengé', 0.9, 2000, 80, { repli: '90 %', seuil: 65, couleur: 'brun très foncé', teinte: '#3e2c22' }),
];

export function slug(nom) {
  return String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'essence';
}

/** Indice d'énergie du carnet : puissance ÷ vitesse × passes × 1000. */
const FAMILLES = [[15, 'Rouge'], [45, 'Orange'], [70, 'Jaune'], [160, 'Vert'], [200, 'Turquoise'], [250, 'Bleu'], [290, 'Violet'], [345, 'Rose'], [360, 'Rouge']];

/** La famille de couleur d'une teinte, en français : de quoi nommer « Rouge 1 » une essence pas encore identifiée. */
export function familleTeinte(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return 'Teinte';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255, v = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, v, b), min = Math.min(r, v, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.12) return l > 0.85 ? 'Blanc' : l < 0.2 ? 'Noir' : 'Gris';
  let h = 0;
  if (d) h = max === r ? 60 * (((v - b) / d) % 6) : max === v ? 60 * ((b - r) / d + 2) : 60 * ((r - v) / d + 4);
  if (h < 0) h += 360;
  if (l > 0.9 || (l > 0.8 && s < 0.6)) return 'Crème';
  if (h < 45 && l < 0.75 && s < 0.7) return 'Brun';
  return FAMILLES.find(([limite]) => h < limite)[1];
}

/** « Rouge 1 », « Rouge 2 »… : le premier nom libre de la famille d'une teinte. */
export function nomProvisoire(teinte, nomsPris = []) {
  const pris = new Set(nomsPris.map(n => slug(n)));
  const famille = familleTeinte(teinte);
  for (let i = 1; ; i++) {
    const nom = `${famille} ${i}`;
    if (!pris.has(slug(nom))) return nom;
  }
}

export const energie = (puissance, vitesse, passes = 2) => puissance / vitesse * passes * 1000;

/**
 * Réglage à retenir depuis une bande d'échelle de puissance (cases de 10 en 10).
 * premiere : la plus basse puissance qui a coupé. On retient le cran au-dessus — le plus sûr et le plus propre.
 * Une bande est optimiste (ses carrés de 10 mm sont parcourus en accélération) : sous 25 % de marge, on prévient.
 */
export function reglageDepuisTest({ vitesse, premiere, passes = 2 }) {
  const v = Number(vitesse), p = Number(premiere);
  if (!(v > 0) || !(p > 0 && p <= 100)) return null;
  const seuil = energie(Math.max(p - 5, 1), v, passes);                 // entre la case qui ne coupe pas et celle qui coupe
  const plusRapide = VITESSES_BANDES.find(b => b > v);
  const plusLente = [...VITESSES_BANDES].reverse().find(b => b < v);
  const conseil = vitesseCible => {
    const pc = Math.ceil(seuil * 1.4 * vitesseCible / (passes * 1000) / 5) * 5;   // 40 % de marge, arrondi aux 5 %
    return pc <= 100 ? { vitesse: vitesseCible, puissance: pc } : null;
  };
  if (p <= PUISSANCES_BANDE[0]) {
    // la case la plus faible coupe déjà : le vrai seuil est sous la bande, et le chant chauffe pour rien
    const secours = { vitesse: v, puissance: PUISSANCES_BANDE[1], seuil: null, marge: null, alerte: 'toutCoupe' };
    if (passes > 1) return { ...secours, passes: 1, message: 'Même la case la plus faible coupe. Refais la bande en 1 passe : deux fois moins de chaleur dans le chant.' };
    if (plusRapide) return { ...secours, passes, message: `Même la case la plus faible coupe en 1 passe. Passe la bande ${plusRapide} pour un chant plus propre et plus rapide.` };
    return { ...secours, passes, message: 'Même la case la plus faible coupe en 1 passe, à la bande la plus rapide : ce placage se coupe avec un rien. Garde cette valeur et surveille le chant.' };
  }
  const puissance = Math.min(100, PUISSANCES_BANDE.find(x => x > p) ?? p + 10);
  const marge = energie(puissance, v, passes) / seuil - 1;
  const r = { vitesse: v, puissance, passes, seuil: Math.round(seuil), marge };
  if (p >= 100) {
    const c = plusLente && conseil(plusLente);
    return { ...r, alerte: 'plafond', message: `Seul le 100 % coupe : aucune réserve. ${c ? `Préfère ${c.vitesse} / ${c.puissance} %.` : 'Passe une bande plus lente.'}` };
  }
  if (marge < 0.25) {
    const c = plusLente && conseil(plusLente);
    return { ...r, alerte: 'margeCourte', repli: c,
      message: `Marge courte (${Math.round(marge * 100)} %) : une bande est optimiste. Surveille les premiers centimètres${c ? ` ; si ça ne traverse pas, passe à ${c.vitesse} / ${c.puissance} %` : ''}.` };
  }
  return { ...r, alerte: null, message: `Marge de ${Math.round(marge * 100)} %.` };
}
