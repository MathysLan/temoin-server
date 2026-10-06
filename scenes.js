// Les scènes de « Faux Témoin » : des lieux, et dans chaque lieu des
// EMPLACEMENTS qui prennent une variante au hasard. Module pur (hasard injecté).
//
// Une scène = un lieu + une variante par emplacement. Le client la dessine à
// partir de cette description : le vocabulaire est FERMÉ (KINDS ci-dessous),
// et `test-engine.mjs` refuse toute variante qui n'en fait pas partie (une
// faute de frappe donnerait un trou dans le dessin, sans erreur).
//
// Les questions de l'interrogatoire n'ont PAS de bonne réponse (questions.js) :
// la scène ne sert qu'à être vue 5 à 10 secondes, puis montrée à tous à la
// révélation. Le seul endroit où une réponse est juste ou fausse est la
// dernière chance : le Faux Témoin démasqué doit retrouver la vraie scène
// parmi 4 versions du même lieu (`versions()`), qui diffèrent sur 3
// emplacements.
//
// Garanties (tirées des milliers de fois par test-engine.mjs) :
//   - chaque scène a au moins 2 personnages ;
//   - les zones gauche, droite, fond et premier plan ne sont jamais toutes
//     vides (les questions de zone ont toujours de quoi répondre) ;
//   - les 4 versions sont toutes différentes, et chaque leurre diffère de la
//     vraie sur exactement 3 emplacements.
'use strict';

const COULEURS = ['rouge', 'bleu', 'jaune', 'vert', 'violet', 'orange', 'blanc', 'noir'];

// Le vocabulaire du dessin : genre → attributs permis (et leurs valeurs).
const KINDS = {
  ciel: { moment: ['matin', 'midi', 'soir', 'nuit'] },
  personne: { tenue: COULEURS, objet: ['rien', 'parapluie', 'valise', 'journal', 'cafe', 'chien', 'sac', 'plateau', 'panier', 'telephone'], pose: ['debout', 'assis'] },
  enfant: { tenue: COULEURS, objet: ['rien', 'ballon', 'glace', 'seau', 'cerf-volant'] },
  chien: { couleur: ['brun', 'noir', 'blanc'] },
  chat: { couleur: ['roux', 'noir', 'blanc'] },
  oiseaux: { espece: ['pigeon', 'mouette'], nombre: [1, 3] },
  velo: { couleur: COULEURS },
  trottinette: { couleur: COULEURS },
  voiture: { couleur: COULEURS },
  bus: { couleur: COULEURS },
  train: { couleur: COULEURS },
  bateau: { couleur: COULEURS },
  valise: { couleur: COULEURS },
  sac: { couleur: COULEURS },
  caddie: { couleur: COULEURS },
  parasol: { couleur: COULEURS },
  serviette: { couleur: COULEURS },
  enseigne: { couleur: COULEURS },
  affiche: { motif: ['soleil', 'montagne', 'gateau', 'chat', 'concert'] },
  arbre: { saison: ['ete', 'automne', 'hiver'] },
  fontaine: {},
  kiosque: {},
  chateau: {},
  rayon: { produit: ['fruits', 'boites', 'bouteilles'] },
};

const ZONES = ['fond', 'gauche', 'centre', 'droite', 'premier'];
// Les zones que les questions nomment : jamais toutes vides.
const ZONES_NOMMEES = ['fond', 'gauche', 'droite', 'premier'];

// --------------------------------------------------------------- fabrique
const ciel = () => ({ id: 'ciel', zone: 'fond', variants: KINDS.ciel.moment.map((moment) => ({ kind: 'ciel', moment })) });
// Une variante par couleur proposée, et l'absence si `vide`.
const objets = (kind, couleurs, vide) => [...couleurs.map((couleur) => ({ kind, couleur })), ...(vide ? [null] : [])];
// Des personnages : toutes les combinaisons tenue × objet, et l'absence si `vide`.
const gens = (pose, tenues, objs, vide) => [
  ...tenues.flatMap((tenue) => objs.map((objet) => ({ kind: 'personne', pose, tenue, objet }))),
  ...(vide ? [null] : []),
];
const enfants = (tenues, objs, vide) => [
  ...tenues.flatMap((tenue) => objs.map((objet) => ({ kind: 'enfant', tenue, objet }))),
  ...(vide ? [null] : []),
];
const slot = (id, zone, variants) => ({ id, zone, variants });

// ------------------------------------------------------------- les lieux
// Le titre est la seule chose que le Faux Témoin connaît : il doit suffire à
// répondre de façon crédible à une question ouverte, sans trahir le détail.
const LIEUX = [
  {
    id: 'gare', title: 'Un quai de gare', slots: [
      ciel(),
      slot('train', 'fond', [...objets('train', ['rouge', 'bleu', 'vert'], true)]),
      slot('affiche', 'fond', ['soleil', 'montagne', 'gateau'].map((motif) => ({ kind: 'affiche', motif }))),
      slot('banc', 'gauche', gens('assis', ['rouge', 'bleu', 'jaune'], ['journal', 'cafe', 'rien'], true)),
      slot('voyageur', 'centre', gens('debout', ['orange', 'blanc', 'bleu'], ['sac', 'telephone', 'rien'], false)),
      slot('quai', 'droite', gens('debout', ['vert', 'violet', 'noir'], ['parapluie', 'valise', 'chien'], true)),
      slot('bagage', 'premier', objets('valise', ['rouge', 'bleu', 'jaune'], true)),
      slot('sol', 'premier', [{ kind: 'oiseaux', espece: 'pigeon', nombre: 1 }, { kind: 'oiseaux', espece: 'pigeon', nombre: 3 }, null]),
    ],
  },
  {
    id: 'terrasse', title: 'Une terrasse de café', slots: [
      ciel(),
      slot('enseigne', 'fond', objets('enseigne', ['rouge', 'vert', 'bleu'], false)),
      slot('trottoir', 'fond', objets('velo', ['rouge', 'bleu', 'jaune'], true)),
      slot('table-gauche', 'gauche', gens('assis', ['rouge', 'blanc', 'vert'], ['cafe', 'journal', 'telephone'], true)),
      slot('serveur', 'centre', gens('debout', ['noir', 'blanc'], ['plateau', 'rien'], false)),
      slot('table-droite', 'droite', gens('assis', ['jaune', 'bleu', 'violet'], ['cafe', 'sac', 'rien'], true)),
      slot('parasol', 'centre', objets('parasol', ['rouge', 'vert', 'jaune'], true)),
      slot('pieds', 'premier', [{ kind: 'chien', couleur: 'brun' }, { kind: 'chien', couleur: 'noir' }, { kind: 'chat', couleur: 'roux' }, null]),
    ],
  },
  {
    id: 'parc', title: 'Un parc', slots: [
      ciel(),
      slot('arbre', 'fond', ['ete', 'automne', 'hiver'].map((saison) => ({ kind: 'arbre', saison }))),
      slot('monument', 'fond', [{ kind: 'fontaine' }, { kind: 'kiosque' }, null]),
      slot('banc', 'gauche', gens('assis', ['bleu', 'jaune', 'violet'], ['journal', 'rien', 'telephone'], true)),
      slot('allee', 'centre', gens('debout', ['rouge', 'vert', 'noir'], ['chien', 'parapluie', 'rien'], false)),
      slot('pelouse', 'droite', enfants(['rouge', 'bleu', 'orange'], ['ballon', 'glace', 'cerf-volant'], true)),
      slot('chemin', 'premier', [...objets('velo', ['rouge', 'bleu'], false), ...objets('trottinette', ['vert', 'jaune'], false), null]),
      slot('sol', 'premier', [{ kind: 'oiseaux', espece: 'pigeon', nombre: 1 }, { kind: 'oiseaux', espece: 'pigeon', nombre: 3 }, null]),
    ],
  },
  {
    id: 'superette', title: 'Une supérette', slots: [
      ciel(),
      slot('rayon', 'fond', ['fruits', 'boites', 'bouteilles'].map((produit) => ({ kind: 'rayon', produit }))),
      slot('affiche', 'fond', ['gateau', 'soleil', 'concert'].map((motif) => ({ kind: 'affiche', motif }))),
      slot('caisse', 'gauche', gens('assis', ['rouge', 'vert', 'bleu'], ['rien', 'telephone'], false)),
      slot('client', 'centre', gens('debout', ['jaune', 'noir', 'violet'], ['panier', 'sac', 'telephone'], true)),
      slot('entree', 'droite', gens('debout', ['blanc', 'orange', 'bleu'], ['parapluie', 'sac', 'rien'], true)),
      slot('chariot', 'premier', objets('caddie', ['rouge', 'bleu', 'jaune'], true)),
      slot('sol', 'premier', [{ kind: 'chat', couleur: 'roux' }, { kind: 'chat', couleur: 'noir' }, { kind: 'sac', couleur: 'blanc' }, null]),
    ],
  },
  {
    id: 'plage', title: 'Une plage', slots: [
      ciel(),
      slot('mer', 'fond', objets('bateau', ['rouge', 'blanc', 'jaune'], true)),
      slot('parasol', 'gauche', objets('parasol', ['rouge', 'bleu', 'orange'], false)),
      slot('serviette', 'gauche', gens('assis', ['vert', 'jaune', 'violet'], ['rien', 'telephone', 'journal'], true)),
      slot('sable', 'centre', [{ kind: 'chateau' }, ...objets('serviette', ['rouge', 'bleu'], false), null]),
      slot('rivage', 'droite', enfants(['rouge', 'bleu', 'blanc'], ['ballon', 'seau', 'glace'], false)),
      slot('promeneur', 'droite', gens('debout', ['noir', 'orange'], ['chien', 'rien'], true)),
      slot('ciel-bas', 'premier', [{ kind: 'oiseaux', espece: 'mouette', nombre: 1 }, { kind: 'oiseaux', espece: 'mouette', nombre: 3 }, null]),
    ],
  },
  {
    id: 'arret', title: 'Un arrêt de bus', slots: [
      ciel(),
      slot('route', 'fond', [...objets('bus', ['rouge', 'vert', 'jaune'], false), null]),
      slot('abri', 'fond', ['concert', 'montagne', 'chat'].map((motif) => ({ kind: 'affiche', motif }))),
      slot('banc', 'gauche', gens('assis', ['bleu', 'rouge', 'blanc'], ['sac', 'journal', 'rien'], true)),
      slot('attente', 'centre', gens('debout', ['vert', 'jaune', 'noir'], ['parapluie', 'telephone', 'cafe'], false)),
      slot('trottoir', 'droite', [...gens('debout', ['violet', 'orange'], ['chien', 'valise'], false), null]),
      slot('chaussee', 'premier', [...objets('voiture', ['rouge', 'bleu', 'blanc'], false), ...objets('trottinette', ['vert'], false), null]),
      slot('sol', 'premier', [{ kind: 'oiseaux', espece: 'pigeon', nombre: 1 }, { kind: 'chien', couleur: 'blanc' }, null]),
    ],
  },
];

// ------------------------------------------------------------------ outils
const pick = (arr, random) => arr[Math.floor(random() * arr.length)];
const cle = (scene) => JSON.stringify(scene.items);
const estHumain = (v) => !!v && (v.kind === 'personne' || v.kind === 'enfant');

// Une variante est-elle bien dans le vocabulaire du dessin ?
function varianteValide(v) {
  if (v === null) return true;
  if (!v || typeof v !== 'object' || !KINDS[v.kind]) return false;
  const attrs = KINDS[v.kind];
  const cles = Object.keys(v).filter((k) => k !== 'kind');
  if (cles.length !== Object.keys(attrs).length) return false;
  return cles.every((k) => attrs[k] && attrs[k].includes(v[k]));
}

// La description envoyée au client : le lieu, son titre, et un élément par
// emplacement (`item: null` = emplacement vide, dessiné sans rien).
function decrire(lieu, choix) {
  return {
    place: lieu.id,
    title: lieu.title,
    items: lieu.slots.map((s, i) => ({ slot: s.id, zone: s.zone, item: choix[i] })),
  };
}

function sceneValide(lieu, scene) {
  if (!scene || scene.place !== lieu.id || scene.items.length !== lieu.slots.length) return false;
  if (!scene.items.every((x, i) => x.slot === lieu.slots[i].id && lieu.slots[i].variants.some((v) => JSON.stringify(v) === JSON.stringify(x.item)))) return false;
  if (scene.items.filter((x) => estHumain(x.item)).length < 2) return false;
  return ZONES_NOMMEES.every((z) => scene.items.some((x) => x.zone === z && x.item));
}

// Une scène au hasard dans un lieu (au hasard, ou imposé).
function tirerScene(random, lieuId) {
  const lieu = lieuId ? LIEUX.find((l) => l.id === lieuId) : pick(LIEUX, random);
  if (!lieu) throw new Error('lieu inconnu');
  for (let essai = 0; essai < 200; essai++) {
    const scene = decrire(lieu, lieu.slots.map((s) => pick(s.variants, random)));
    if (sceneValide(lieu, scene)) return scene;
  }
  throw new Error('scène impossible');   // jamais vu : le test le tire des milliers de fois
}

// Les 4 versions de la dernière chance : la vraie et 3 leurres du même lieu,
// chacun avec 3 emplacements changés. Rend { versions, vraie } (index).
const CHANGES = 3;
function versions(random, scene) {
  const lieu = LIEUX.find((l) => l.id === scene.place);
  const vus = new Set([cle(scene)]);
  const leurres = [];
  for (let essai = 0; leurres.length < 3 && essai < 500; essai++) {
    const idx = [];
    while (idx.length < CHANGES) {
      const i = Math.floor(random() * lieu.slots.length);
      if (!idx.includes(i)) idx.push(i);
    }
    const choix = scene.items.map((x) => x.item);
    for (const i of idx) {
      const autres = lieu.slots[i].variants.filter((v) => JSON.stringify(v) !== JSON.stringify(choix[i]));
      choix[i] = pick(autres, random);
    }
    const l = decrire(lieu, choix);
    if (!sceneValide(lieu, l) || vus.has(cle(l))) continue;
    vus.add(cle(l));
    leurres.push(l);
  }
  if (leurres.length < 3) throw new Error('versions impossibles');
  const tout = [scene, ...leurres];
  // Mélange (Fisher-Yates), en suivant la vraie.
  for (let i = tout.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tout[i], tout[j]] = [tout[j], tout[i]];
  }
  return { versions: tout, vraie: tout.indexOf(scene) };
}

// Nombre d'emplacements qui diffèrent entre deux scènes du même lieu.
const ecarts = (a, b) => a.items.filter((x, i) => JSON.stringify(x.item) !== JSON.stringify(b.items[i].item)).length;

module.exports = { LIEUX, KINDS, ZONES, ZONES_NOMMEES, COULEURS, CHANGES, tirerScene, versions, sceneValide, varianteValide, ecarts, estHumain };
