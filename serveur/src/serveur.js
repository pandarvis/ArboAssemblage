// L'API locale d'ArboAssemblage : elle lit l'atelier sur le disque et écrit les fichiers de redécoupe.
// Sans dépendance, comme l'outil d'atelier : un seul `node` suffit à la faire tourner.
import http from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { listerProjets, lireProjet, declinaisonDe, lireSource, dossierProjets } from '../../noyau/src/projets.js';
import { assemblage } from '../../noyau/src/assemblage.js';
import { redecoupe, nomDuFichier } from '../../noyau/src/redecoupe.js';

export class ErreurHttp extends Error {
  constructor(message, statut = 400) { super(message); this.statut = statut; }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

/** Le corps d'une requête, en JSON, borné pour qu'une requête folle ne remplisse pas la mémoire. */
async function lireCorps(req, maximum = 1 << 20) {
  const bouts = [];
  let taille = 0;
  for await (const bout of req) {
    taille += bout.length;
    if (taille > maximum) throw new ErreurHttp('Requête trop grosse.', 413);
    bouts.push(bout);
  }
  if (!bouts.length) return {};
  try {
    return JSON.parse(Buffer.concat(bouts).toString('utf8'));
  } catch {
    throw new ErreurHttp('Corps illisible : du JSON était attendu.', 400);
  }
}

/**
 * Crée le serveur. `mecpow` est le dossier de travail d'Élodie, `client` celui des fichiers à servir.
 * `maintenant` sert aux tests, pour que le nom du fichier produit soit prévisible.
 */
export function creerServeur({ mecpow, client = null, maintenant = () => new Date() } = {}) {
  if (!mecpow) throw new Error('creerServeur a besoin du dossier MECPOW.');

  /** Le projet, sa déclinaison et son dessin, en une fois. */
  async function charger(nomProjet, nomDeclinaison) {
    let projet;
    try {
      projet = await lireProjet(mecpow, nomProjet);
    } catch {
      throw new ErreurHttp(`Projet introuvable : ${nomProjet}`, 404);
    }
    let declinaison;
    try {
      declinaison = declinaisonDe(projet, nomDeclinaison);
    } catch (e) {
      throw new ErreurHttp(e.message, 404);
    }
    return { projet, declinaison, source: await lireSource(mecpow, projet, declinaison) };
  }

  /** La liste rapportée du client devient un fichier LightBurn, posé près des feuilles du projet. */
  async function poserRedecoupe(corps) {
    const { projet, declinaison, source } = await charger(corps.projet, corps.declinaison);
    let r;
    try {
      r = redecoupe(projet, declinaison, source, corps.pieces);
    } catch (e) {
      throw new ErreurHttp(e.message, 400);
    }
    const nom = nomDuFichier(maintenant());
    const dossier = join(dossierProjets(mecpow), projet.dossier, declinaison.dossier ?? '');
    const cible = join(dossier, nom);
    // un fichier du même jour part dans les sauvegardes plutôt que d'être écrasé
    try {
      const sauvegardes = join(dossier, '_sauvegardes', `avant-ajout-${maintenant().toISOString().slice(0, 10)}`);
      await mkdir(sauvegardes, { recursive: true });
      await rename(cible, join(sauvegardes, nom));
    } catch { /* pas de précédent, tant mieux */ }
    await mkdir(dossier, { recursive: true });
    await writeFile(cible, r.xml);
    return { fichier: nom, dossier: declinaison.dossier ?? '', pieces: r.pieces, lots: r.lots, bande: r.bande, ignorees: r.ignorees };
  }

  const json = (res, statut, donnees) => {
    res.writeHead(statut, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'X-ArboAssemblage': '1' });
    res.end(JSON.stringify(donnees));
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://arboassemblage');
      const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);

      if (segments[0] === 'api') {
        const route = `${req.method} /${segments[1] ?? ''}`;
        if (route === 'GET /projets' && segments.length === 2) {
          const projets = await listerProjets(mecpow);
          return json(res, 200, projets.map(p => ({
            nom: p.nom, dossier: p.dossier, categorie: p.categorie ?? null, cree: p.cree ?? null,
            declinaisons: (p.declinaisons ?? []).map(d => ({
              nom: d.nom, dossier: d.dossier,
              pieces: (d.feuilles ?? []).reduce((s, f) => s + (f.pieces ?? 0), 0),
            })),
          })));
        }
        if (route === 'GET /assemblage' && segments.length >= 3) {
          const { projet, declinaison, source } = await charger(segments[2], segments[3]);
          try {
            return json(res, 200, assemblage(projet, declinaison, source));
          } catch (e) {
            throw new ErreurHttp(e.message, 422);
          }
        }
        if (route === 'POST /redecouper') return json(res, 201, await poserRedecoupe(await lireCorps(req)));
        throw new ErreurHttp('Adresse inconnue.', 404);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErreurHttp('Méthode refusée.', 405);
      if (!client) throw new ErreurHttp('Adresse inconnue.', 404);
      const demande = segments.length ? segments.join(sep) : 'index.html';
      const cible = normalize(join(client, demande));
      if (!cible.startsWith(client + sep) && cible !== join(client, 'index.html')) throw new ErreurHttp('Refusé.', 403);
      const contenu = await readFile(cible);
      res.writeHead(200, { 'Content-Type': TYPES[extname(cible).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : contenu);
    } catch (e) {
      const statut = e.statut ?? (e.code === 'ENOENT' ? 404 : 500);
      if (statut === 500) console.error(e);
      json(res, statut, { erreur: statut === 500 ? `Erreur du serveur : ${e.message}` : e.message });
    }
  });
}
