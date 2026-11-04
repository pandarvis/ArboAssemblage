# ArboAssemblage

Le motif de marqueterie en main pendant l'assemblage.

Une fois la découpe faite, Élodie n'a plus la place d'étaler le dessin là où elle assemble.
Cette appli lui met le motif sur son téléphone : elle zoome, elle touche une pièce, l'appli lui dit
de quelle essence il s'agit — et elle marque celles qu'elle a cassées ou oubliées, pour que l'atelier
en fasse un fichier de redécoupe.

## Les trois morceaux

```
noyau/      la bibliothèque : lire l'atelier, bâtir le modèle d'assemblage, préparer la redécoupe
serveur/    l'API locale : elle lit les projets sur le disque et écrit les fichiers LightBurn
client/     l'appli : le motif, les essences, les pièces à redécouper
```

Aucune dépendance : `node` suffit, des deux côtés. Pas de build, pas d'installation.

## Faire tourner

```bash
node serveur/src/index.js --reseau
```

L'outil affiche alors deux adresses : celle de ce PC, et celle du Wi-Fi.
Sur l'iPhone ou l'iPad, ouvre la seconde dans Safari, puis **Partager → Ajouter à l'écran d'accueil** :
tu obtiens une icône et le plein écran.

Options : `--port=8460`, `--mecpow=R:/Documents/MECPOW` (le dossier qui contient `02-projets`),
et `--reseau` pour accepter le téléphone. Sans `--reseau`, le serveur n'écoute que ce PC.

## Les tests

```bash
cd noyau   && npm test     # lecture de l'atelier, modèle, redécoupe
cd serveur && npm test     # l'API, de bout en bout, sur un atelier jetable
cd client  && npm test     # le carnet des pièces marquées, le zoom, le cadrage
```

Tout tourne sur `noyau/exemple-atelier`, un petit projet « Damier » versionné ici : six pièces,
deux essences. Aucun test n'a besoin des vrais dossiers d'Élodie, donc ça marche sur n'importe quelle machine.

## Ce qui est décidé, et pourquoi

**Le serveur reste local.** Il lit les dessins des projets et écrit les `.lbrn2` dans leurs dossiers,
que LightBurn ouvre sur ce PC. Un hébergeur n'a ni ce disque ni ces fichiers : le déplacer là-bas
reviendrait à téléverser chaque dessin puis à retélécharger chaque fichier produit.

**Le client est statique et ne sait rien du disque.** Il affiche un modèle JSON que le serveur lui donne.
Servi par le serveur local aujourd'hui, il serait déployable ailleurs sans rien changer — à une réserve près :
une page en `https` ne peut pas appeler un serveur en `http://192.168.x.x`, le navigateur l'interdit.
D'où la v1 : tout en local.

**Pas de service worker.** Le mode hors ligne d'une PWA demande un contexte sécurisé, impossible en
Wi-Fi local sans certificat. L'icône et le plein écran, eux, marchent ; le PC doit juste être allumé.

**L'outil d'atelier n'a pas bougé.** `R:\Documents\MECPOW\outil` continue à faire la préparation et la
découpe ; ArboAssemblage lit les mêmes dossiers, sans y toucher. Les modules partagés sont copiés dans
`noyau/src/vendu/` — une dette assumée, à résorber quand l'outil pourra importer ce noyau plutôt que
l'inverse.

## L'API

| | |
|---|---|
| `GET /api/projets` | les projets de l'atelier et leurs déclinaisons |
| `GET /api/assemblage/:projet/:declinaison` | le modèle : pièces, contours à la taille finale, essences |
| `POST /api/redecouper` | `{ projet, declinaison, pieces: [id] }` → écrit le fichier LightBurn et répond ce qu'il contient |

Le fichier produit porte **un encart et un calque par essence**, aux réglages du projet : deux frênes
cassés, un charme et quatre noyers oubliés donnent trois encarts, trois calques, un seul fichier.
