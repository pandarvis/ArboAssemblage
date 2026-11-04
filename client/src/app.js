// L'appli d'assemblage : on choisit un motif, on le regarde de près, on sait quelle essence est où,
// et on marque les pièces à redécouper. Le serveur de l'atelier fait le reste.
import { marques, recapitulatif } from './lib/marques.js';
import { cadrer, estUnAppui, geste, ancrer } from './lib/vue.js';

const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const stockage = (() => {
  try {
    localStorage.setItem('arbo:essai', '1');
    localStorage.removeItem('arbo:essai');
    return localStorage;
  } catch {
    return null;                                    // navigation privée : on continue sans mémoire
  }
})();

const CLE_DERNIER = 'arbo:dernier';
let modele = null, carnet = null, chemins = new Map();
let vue = { x: 0, y: 0, k: 1 }, choisie = null, essenceChoisie = null;

const montrer = id => {
  for (const e of document.querySelectorAll('.ecran')) e.classList.toggle('ouvert', e.id === id);
};
let minuteur = null;
function dire(texte, genre = 'info') {
  const m = $('#message');
  m.textContent = texte;
  m.dataset.genre = genre;
  m.hidden = false;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { m.hidden = true; }, genre === 'erreur' ? 7000 : 4000);
}

async function api(chemin, init) {
  const r = await fetch(chemin, init);
  const donnees = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(donnees.erreur ?? `L’atelier a répondu ${r.status}.`);
  return donnees;
}

// ---------- le choix du motif
/** Le dernier motif ouvert : au lancement suivant, c'est celui-là qu'on veut, pas une liste. */
function dernier(valeur) {
  try {
    if (valeur === undefined) return JSON.parse(stockage?.getItem(CLE_DERNIER) ?? 'null');
    stockage?.setItem(CLE_DERNIER, JSON.stringify(valeur));
  } catch { /* sans mémoire, on repassera par la liste */ }
  return valeur ?? null;
}

async function accueil({ direct = false } = {}) {
  montrer('accueil');
  try {
    const projets = await api('/api/projets');
    $('#accueil-erreur').hidden = true;
    if (!projets.length) {
      $('#projets').innerHTML = '<p class="doux">Aucun projet préparé pour l’instant.</p>';
      return;
    }
    const vu = dernier();
    const lignes = projets.flatMap(p => (p.declinaisons ?? []).map(d => ({ p, d })));
    const rang = ({ p, d }) => (vu && p.dossier === vu.projet && d.nom === vu.declinaison ? 0 : 1);
    lignes.sort((a, b) => rang(a) - rang(b));
    $('#projets').innerHTML = lignes.map(({ p, d }) => `
      <button class="ligne" data-projet="${attr(p.dossier)}" data-declinaison="${attr(d.nom)}">
        <span><b>${texte(p.nom)}</b><small>${texte(d.nom)}${p.cree ? ` · préparé le ${date(p.cree)}` : ''}</small></span>
        <span class="fin">${rang({ p, d }) === 0 ? 'en cours<br>' : ''}${d.pieces || '?'} pièces</span>
      </button>`).join('');
    for (const l of $('#projets').querySelectorAll('.ligne')) {
      l.addEventListener('click', () => ouvrir(l.dataset.projet, l.dataset.declinaison));
    }
    // au lancement, on reprend là où on s'était arrêté — les motifs déjà assemblés n'intéressent plus
    if (direct) {
      const d = dernier();
      const connu = d && projets.some(p => p.dossier === d.projet && (p.declinaisons ?? []).some(x => x.nom === d.declinaison));
      const choix = connu ? d : { projet: projets[0].dossier, declinaison: projets[0].declinaisons[0]?.nom };
      if (choix.projet && choix.declinaison) return ouvrir(choix.projet, choix.declinaison);
    }
  } catch (e) {
    $('#projets').innerHTML = '';
    $('#accueil-erreur').textContent = `${e.message} Vérifie que l’atelier est allumé sur le PC.`;
    $('#accueil-erreur').hidden = false;
  }
}

const texte = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const attr = s => texte(s).replace(/"/g, '&quot;');
const date = iso => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch { return ''; } };

// ---------- le motif
async function ouvrir(dossier, declinaison) {
  try {
    dire('Ouverture du motif…');
    modele = await api(`/api/assemblage/${encodeURIComponent(dossier)}/${encodeURIComponent(declinaison)}`);
  } catch (e) {
    dire(e.message, 'erreur');
    return;
  }
  $('#message').hidden = true;
  carnet = marques(modele.dossier, modele.declinaison, stockage ?? undefined);
  dernier({ projet: modele.dossier, declinaison: modele.declinaison });
  $('#titre-projet').textContent = modele.projet;
  $('#titre-declinaison').textContent = `${modele.declinaison} · ${modele.pieces.length} pièces`;
  dessiner();
  montrer('motif');
  cadrerTout();
  peindre();
}

function dessiner() {
  const svg = document.createElementNS(NS, 'svg');
  // le repère du SVG, c'est l'écran en pixels ; le groupe amène le dessin (en millimètres) dedans
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.innerHTML = '<defs><pattern id="hachures" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    + '<rect width="3" height="3" fill="#2a2320"/><line x1="0" y1="0" x2="0" y2="3" stroke="#e4603f" stroke-width="1.4"/></pattern></defs>';
  const groupe = document.createElementNS(NS, 'g');
  svg.appendChild(groupe);
  chemins = new Map();
  for (const p of modele.pieces) {
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', p.contour.map(r => `M${r.map(q => q.join(' ')).join(' L')} Z`).join(' '));
    el.setAttribute('class', 'piece');
    el.dataset.id = p.id;
    groupe.appendChild(el);
    chemins.set(p.id, el);
  }
  $('#plan').replaceChildren(svg);
  appliquer.groupe = groupe;
  appliquer.svg = svg;
}

function appliquer() {
  appliquer.groupe?.setAttribute('transform', `translate(${vue.x} ${vue.y}) scale(${vue.k})`);
}

/** L'écran, en pixels : le viewBox le recouvre exactement, donc une unité SVG vaut un pixel. */
function ecran() {
  const r = appliquer.svg.getBoundingClientRect();
  return { largeur: r.width, hauteur: r.height, rect: r };
}
function cadrerTout() {
  const e = ecran();
  appliquer.svg.setAttribute('viewBox', `0 0 ${e.largeur} ${e.hauteur}`);
  vue = cadrer(modele.taille, e);
  appliquer();
}

function peindre() {
  for (const p of modele.pieces) {
    const el = chemins.get(p.id);
    el.setAttribute('fill', p.couleur ?? modele.essences[p.essence]?.teinte ?? '#6d675d');
    el.classList.toggle('refaire', carnet.a(p.id));
    el.classList.toggle('eteinte', !!essenceChoisie && p.essence !== essenceChoisie);
    el.classList.toggle('choisie', choisie === p.id);
  }
  $('#compteur').textContent = `${carnet.taille} à refaire`;
  $('#compteur').hidden = carnet.taille === 0;
}

// ---------- zoom et déplacement, au doigt
// Tout se calcule depuis l'ancre, relevée dès qu'un doigt se pose ou se lève : rien ne saute à ce moment-là.
const doigts = new Map();
let ancre = null, premier = null, bouge = false;

const positions = () => [...doigts.values()];
const reancrer = () => { ancre = modele ? ancrer(vue, positions()) : null; };

$('#plan').addEventListener('pointerdown', ev => {
  doigts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (doigts.size === 1) { premier = { x: ev.clientX, y: ev.clientY, t: Date.now() }; bouge = false; }
  reancrer();
});

$('#plan').addEventListener('pointermove', ev => {
  if (!doigts.has(ev.pointerId) || !modele || !ancre) return;
  doigts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const liste = positions();
  if (liste.length !== ancre.doigts) { reancrer(); return; }   // un doigt est arrivé entre-temps
  const { rect } = ecran();
  vue = geste(ancre, liste, { x: rect.left, y: rect.top });
  if (liste.length > 1 || Math.hypot(ev.clientX - premier.x, ev.clientY - premier.y) > 8) bouge = true;
  appliquer();
});

const lever = ev => {
  const restants = doigts.size - (doigts.has(ev.pointerId) ? 1 : 0);
  doigts.delete(ev.pointerId);
  if (!restants && premier && !bouge && estUnAppui(premier, { x: ev.clientX, y: ev.clientY, t: Date.now() })) toucher(ev);
  if (restants) reancrer();                                    // il reste des doigts : on repart de leur position
  else { ancre = null; premier = null; }
};
$('#plan').addEventListener('pointerup', lever);
$('#plan').addEventListener('pointercancel', ev => { doigts.delete(ev.pointerId); if (doigts.size) reancrer(); else ancre = null; });
addEventListener('resize', () => { if (modele) cadrerTout(); });

// ---------- toucher une pièce
function toucher(ev) {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!el?.classList.contains('piece')) { fermerFiche(); return; }
  choisie = el.dataset.id;
  const p = modele.pieces.find(x => x.id === choisie);
  const e = modele.essences[p.essence];
  $('#fiche-pastille').style.background = p.couleur ?? e?.teinte ?? '#6d675d';
  $('#fiche-essence').textContent = e ? e.nom : 'essence non choisie';
  $('#fiche-detail').innerHTML = [
    e ? `${e.epaisseur} mm` : null,
    `groupe ${p.groupe}`,
    `${p.taille[0]} × ${p.taille[1]} mm`,
    p.feuille ? `feuille : ${texte(p.feuille.replace(/\.lbrn2$/, ''))}` : null,
    e ? (e.aTester ? 'essence encore à régler' : `${e.vitesse} mm/min · ${e.puissance} % · ${e.passes} passes`) : null,
  ].filter(Boolean).join('<br>');
  majMarquer();
  $('#fiche').classList.add('ouvert');
  peindre();
}
function majMarquer() {
  const marquee = choisie && carnet.a(choisie);
  $('#marquer').textContent = marquee ? 'Ne plus refaire' : 'À redécouper';
  $('#marquer').classList.toggle('actif', !!marquee);
}
function fermerFiche() { choisie = null; $('#fiche').classList.remove('ouvert'); peindre(); }

$('#fermer-fiche').addEventListener('click', fermerFiche);
$('#marquer').addEventListener('click', () => {
  if (!choisie) return;
  carnet.basculer(choisie);
  majMarquer();
  peindre();
});
$('#retour').addEventListener('click', () => { modele = null; accueil(); });   // le retour, lui, montre la liste

// ---------- les essences, et l'envoi à l'atelier
function remplirEssences() {
  const lots = new Map();
  for (const p of modele.pieces) {
    if (!lots.has(p.essence)) lots.set(p.essence, []);
    lots.get(p.essence).push(p);
  }
  $('#liste-essences').innerHTML = [...lots].map(([id, pieces]) => {
    const e = modele.essences[id];
    const refaire = pieces.filter(p => carnet.a(p.id)).length;
    return `<button class="ligne${essenceChoisie === id ? ' active' : ''}" data-essence="${attr(id)}">
      <span class="pastille" style="background:${attr(e?.teinte ?? pieces[0].couleur ?? '#6d675d')}"></span>
      <span><b>${texte(e?.nom ?? 'non choisie')}</b><small>${e ? `${e.epaisseur} mm` : ''}</small></span>
      <span class="fin">${pieces.length} pièces${refaire ? `<br><b style="color:var(--alerte)">${refaire} à refaire</b>` : ''}</span>
    </button>`;
  }).join('');
  for (const l of $('#liste-essences').querySelectorAll('.ligne')) {
    l.addEventListener('click', () => {
      essenceChoisie = essenceChoisie === l.dataset.essence ? null : l.dataset.essence;
      remplirEssences();
      peindre();
      if (essenceChoisie) montrer('motif');
    });
  }

  const lotsRefaire = recapitulatif(modele, carnet);
  const total = lotsRefaire.reduce((s, l) => s + l.pieces.length, 0);
  $('#refaire').innerHTML = total
    ? `<h2>À redécouper (${total})</h2>
       <p class="doux">${lotsRefaire.map(l => `${l.pieces.length} ${texte(l.essence.nom)}`).join(', ')}.
       L’atelier en fera un seul fichier, un encart par essence, aux bons réglages.</p>
       <button class="bouton large" id="envoyer" type="button">Envoyer à l’atelier</button>
       <button class="bouton large" id="vider" type="button">Tout effacer</button>`
    : '<p class="doux">Rien à redécouper. Touche une pièce dans le motif, puis « À redécouper ».</p>';

  $('#envoyer')?.addEventListener('click', envoyer);
  $('#vider')?.addEventListener('click', () => {
    if (!confirm(`Effacer les ${total} pièces marquées ?`)) return;
    carnet.vider();
    remplirEssences();
    peindre();
  });
}

async function envoyer() {
  const bouton = $('#envoyer');
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';
  try {
    const bilan = await api('/api/redecouper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projet: modele.dossier, declinaison: modele.declinaison, pieces: carnet.liste() }),
    });
    const detail = bilan.lots.map(l => `${l.pieces} ${l.essence}`).join(', ');
    dire(`« ${bilan.fichier} » est prêt dans ${bilan.dossier || 'le projet'} : ${detail}.`);
    carnet.vider();
    remplirEssences();
    peindre();
  } catch (e) {
    dire(`${e.message} Rien n’a été effacé : tu pourras renvoyer.`, 'erreur');
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Envoyer à l’atelier';
  }
}

$('#ouvrir-essences').addEventListener('click', () => { remplirEssences(); montrer('essences'); });
$('#compteur').addEventListener('click', () => { remplirEssences(); montrer('essences'); });
$('#fermer-essences').addEventListener('click', () => montrer('motif'));

// au lancement, on reprend le dernier motif ; le bouton « retour » montre la liste
accueil({ direct: true });
