// Les questions de l'interrogatoire. Module pur (hasard injecté).
//
// UNE QUESTION N'A PAS DE BONNE RÉPONSE. Elle demande à chacun de CHOISIR ce
// qu'il dit de la scène : deux vrais témoins répondent différemment en toute
// honnêteté, et le Faux Témoin se cache dans ces écarts. Le serveur ne vérifie
// aucune réponse (elles sont dites à voix haute, sur Discord) ; la table juge
// pendant le débat, la scène tranche à la révélation.
//
// Deux sortes :
//   - OUVERTES (libre, impression) : faciles à bluffer avec le seul titre,
//     elles font parler. Toujours la première question d'une manche.
//   - CIBLÉES (zone, estimation, couleur) : chacun dose sa précision. Trop
//     précis, on souffle au Faux Témoin quoi dire et quelle scène choisir à
//     la dernière chance ; trop vague, on devient suspect.
//
// Toutes valent pour toutes les scènes (scenes.js garantit des personnages,
// et les zones gauche, droite, fond et premier plan jamais toutes vides).
// Dix mots au plus : l'écran les affiche en grand, on les lit à voix haute.
'use strict';

const QUESTIONS = [
  { id: 'l1', famille: 'libre', text: 'Cite une chose que tu as vue. Une seule.' },
  { id: 'l2', famille: 'libre', text: "Qu'est-ce qui t'a sauté aux yeux en premier ?" },
  { id: 'l3', famille: 'libre', text: "Un détail que les autres n'ont pas vu ?" },
  { id: 'l4', famille: 'libre', text: "Qu'est-ce qui n'avait rien à faire là ?" },
  { id: 'i1', famille: 'impression', text: 'Plutôt calme ou agité ? Pourquoi ?' },
  { id: 'i2', famille: 'impression', text: "Quelqu'un avait l'air louche ? Décris-le." },
  { id: 'i3', famille: 'impression', text: "Il venait de se passer quoi, à ton avis ?" },
  { id: 'i4', famille: 'impression', text: "Décris l'ambiance en trois mots." },
  { id: 'z1', famille: 'zone', text: "Qu'y avait-il sur la gauche ?" },
  { id: 'z2', famille: 'zone', text: "Qu'y avait-il sur la droite ?" },
  { id: 'z3', famille: 'zone', text: "Qu'y avait-il au fond ?" },
  { id: 'z4', famille: 'zone', text: "Qu'y avait-il au premier plan ?" },
  { id: 'e1', famille: 'estimation', text: 'Combien de personnes, à peu près ?' },
  { id: 'e2', famille: 'estimation', text: 'Quel moment de la journée ? Comment tu le sais ?' },
  { id: 'e3', famille: 'estimation', text: "Combien d'animaux as-tu vus ?" },
  { id: 'c1', famille: 'couleur', text: "Une couleur qui t'a marqué, et sur quoi ?" },
  { id: 'c2', famille: 'couleur', text: 'La tenue la plus voyante : de quelle couleur ?' },
  { id: 'c3', famille: 'couleur', text: "Quelqu'un tenait quelque chose. Quoi, de quelle couleur ?" },
  { id: 'c4', famille: 'couleur', text: 'Un véhicule ? Lequel, de quelle couleur ?' },
];

const OUVERTES = ['libre', 'impression'];
const CIBLEES = ['zone', 'estimation', 'couleur'];

const melanger = (arr, random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Les `n` questions d'une manche : une ouverte, puis des ciblées de familles
// différentes. `deja` (Set d'ids) évite de reposer une question dans la même
// partie tant qu'il en reste d'inédites ; on y ajoute celles tirées.
function tirerQuestions(random, n, deja) {
  const vues = deja || new Set();
  const prendre = (familles) => {
    const cand = QUESTIONS.filter((q) => familles.includes(q.famille));
    const neuves = cand.filter((q) => !vues.has(q.id));
    const q = melanger(neuves.length ? neuves : cand, random)[0];
    vues.add(q.id);
    return q;
  };
  const choix = [prendre(OUVERTES)];
  // Les ciblées : à chaque fois la famille qui a le plus de questions encore
  // inédites (au hasard entre ex æquo), sans répéter une famille dans la manche.
  const inedites = (f) => QUESTIONS.filter((q) => q.famille === f && !vues.has(q.id)).length;
  while (choix.length < n) {
    const prises = choix.map((q) => q.famille);
    const reste = melanger(CIBLEES.filter((f) => !prises.includes(f)), random);
    const libres = reste.length ? reste : melanger(CIBLEES, random);
    libres.sort((a, b) => inedites(b) - inedites(a));
    choix.push(prendre([libres[0]]));
  }
  return choix.map((q) => ({ id: q.id, famille: q.famille, text: q.text }));
}

module.exports = { QUESTIONS, OUVERTES, CIBLEES, tirerQuestions };
