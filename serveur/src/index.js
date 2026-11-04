// Lance l'atelier d'assemblage. Par défaut il n'écoute que ce PC ;
// avec --reseau, il accepte aussi le téléphone et la tablette du même Wi-Fi.
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerServeur } from './serveur.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const option = nom => process.argv.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);

const PORT = Number(option('port')) || Number(process.env.PORT) || 8460;
const RESEAU = process.argv.includes('--reseau') || process.env.RESEAU === '1';
const HOTE = RESEAU ? '0.0.0.0' : '127.0.0.1';
// le dossier de travail de l'atelier : celui qui contient 02-projets
const MECPOW = resolve(option('mecpow') ?? process.env.MECPOW ?? 'R:/Documents/MECPOW');
const CLIENT = join(ICI, '..', '..', 'client', 'src');

/** Les adresses auxquelles on peut joindre l'outil depuis le Wi-Fi. */
const adressesLocales = () => Object.values(networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal)
  .map(i => `http://${i.address}:${PORT}`);

const serveur = creerServeur({ mecpow: MECPOW, client: CLIENT });

serveur.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Le port ${PORT} est déjà pris. Relance avec --port=8461, par exemple.`);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});

serveur.listen(PORT, HOTE, () => {
  console.log(`Atelier d'assemblage — projets lus dans ${MECPOW}`);
  console.log(`  sur ce PC        http://localhost:${PORT}`);
  if (RESEAU) {
    for (const a of adressesLocales()) console.log(`  sur le Wi-Fi     ${a}`);
    console.log('\nSur l’iPhone : ouvre cette adresse dans Safari, puis « Ajouter à l’écran d’accueil ».');
  } else {
    console.log('  (pour y accéder depuis le téléphone, relance avec --reseau)');
  }
  console.log('\nGarde cette fenêtre ouverte ; ferme-la pour arrêter.');
});
