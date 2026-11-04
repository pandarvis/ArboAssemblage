// Lecture et écriture XML, juste ce qu'il faut pour les SVG d'Inkscape.
// Sans dépendance : le même code tourne dans le navigateur et dans Node (tests).

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decoder(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (tout, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : tout;
    }
    return ENTITES[e] ?? tout;
  });
}

const BLANC = /\s/;

/** Renvoie l'élément <svg> sous forme d'arbre { name, attrs, children } ; les textes sont des { text }. */
export function parseXML(src) {
  const svg = lireDocument(src).children.find(c => c.name === 'svg' || c.name?.endsWith(':svg'));
  if (!svg) throw new Error('aucun élément <svg>');
  return svg;
}

/** Lit n'importe quel document XML ; renvoie le nœud racine, dont les enfants sont les éléments de premier niveau. */
export function lireDocument(src) {
  const n = src.length;
  const racine = { name: '#document', attrs: {}, children: [] };
  const pile = [racine];
  const haut = () => pile[pile.length - 1];
  const texte = t => { if (t.trim()) haut().children.push({ text: decoder(t) }); };
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { texte(src.slice(i)); break; }
    if (lt > i) texte(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e < 0) throw new Error('commentaire jamais fermé');
      i = e + 3; continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      if (e < 0) throw new Error('bloc CDATA jamais fermé');
      haut().children.push({ text: src.slice(lt + 9, e) });
      i = e + 3; continue;
    }
    if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2);
      if (e < 0) throw new Error('instruction jamais fermée');
      i = e + 2; continue;
    }
    if (src.startsWith('<!', lt)) {                       // DOCTYPE, éventuellement avec [ ... ]
      let j = lt + 2, crochets = 0;
      for (; j < n; j++) {
        if (src[j] === '[') crochets++;
        else if (src[j] === ']') crochets--;
        else if (src[j] === '>' && crochets <= 0) break;
      }
      i = j + 1; continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      if (e < 0) throw new Error('balise fermante incomplète');
      const nom = src.slice(lt + 2, e).trim();
      const el = pile.pop();
      if (pile.length === 0 || el.name !== nom) throw new Error(`balise </${nom}> inattendue`);
      i = e + 1; continue;
    }
    let j = lt + 1;
    while (j < n && !BLANC.test(src[j]) && src[j] !== '/' && src[j] !== '>') j++;
    const el = { name: src.slice(lt + 1, j), attrs: {}, children: [] };
    if (!el.name) throw new Error('balise sans nom');
    for (;;) {
      while (j < n && BLANC.test(src[j])) j++;
      if (j >= n) throw new Error('fichier tronqué');
      if (src[j] === '/' && src[j + 1] === '>') { haut().children.push(el); i = j + 2; break; }
      if (src[j] === '>') { haut().children.push(el); pile.push(el); i = j + 1; break; }
      let k = j;
      while (k < n && !BLANC.test(src[k]) && src[k] !== '=' && src[k] !== '/' && src[k] !== '>') k++;
      if (k === j) throw new Error(`balise <${el.name}> mal formée`);
      const nom = src.slice(j, k);
      j = k;
      while (j < n && BLANC.test(src[j])) j++;
      if (src[j] !== '=') { el.attrs[nom] = ''; continue; }
      j++;
      while (j < n && BLANC.test(src[j])) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") throw new Error(`attribut ${nom} mal formé`);
      const e = src.indexOf(q, j + 1);
      if (e < 0) throw new Error(`attribut ${nom} jamais fermé`);
      el.attrs[nom] = decoder(src.slice(j + 1, e));
      j = e + 1;
    }
  }
  if (pile.length !== 1) throw new Error(`balise <${haut().name}> jamais fermée`);
  return racine;
}

const echapper = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function serialiser(el) {
  if (el.text != null) return echapper(el.text);
  const attrs = Object.entries(el.attrs).map(([k, v]) => ` ${k}="${echapper(v).replace(/"/g, '&quot;')}"`).join('');
  if (!el.children.length) return `<${el.name}${attrs}/>`;
  return `<${el.name}${attrs}>${el.children.map(serialiser).join('')}</${el.name}>`;
}
