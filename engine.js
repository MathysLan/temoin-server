// Moteur PUR de « Faux Témoin ». Aucun réseau, aucun DOM, aucune minuterie :
// l'horloge (`now`, en ms) et le hasard (`random`) sont injectés. Le serveur
// branche ce moteur sur ses sockets et sur UNE minuterie, posée à
// `nextDeadline()`.
//
// Le jeu (« l'Interrogatoire », refonte du 2026-10-06) : une scène s'affiche
// quelques secondes. Tout le monde la voit, sauf le Faux Témoin, qui n'en a
// que le titre. L'écran pose des questions ; chacun répond À VOIX HAUTE (sur
// Discord), à son tour. On débat, on vote pour un joueur. Démasqué, le Faux
// Témoin a une dernière chance : retrouver la vraie scène parmi 4 versions.
//
// LA SCÈNE ET LE RÔLE SONT LES SECRETS DE CE JEU. La scène ne sort que par
// `sceneView()` (aux témoins, pendant le flash), les 4 versions que par
// `optionsView()` (au Faux Témoin démasqué), le rôle que par `roleView()`
// (chacun le sien). Les votes ne sortent qu'à la révélation (avant : QUI a
// voté, jamais pour qui). Le serveur ne vérifie aucune réponse orale.
//
// Phases d'une manche :
//   role      3 s : chacun découvre son rôle
//   flash     5, 8 ou 10 s (réglé au salon) : la scène, ou son titre seul
//   question  un tour de parole par répondant (8 s, +3 s pour lire la
//             question au premier) ; « J'ai répondu » passe au suivant
//   debate    60 s (90 s dès 9 joueurs) ; finit quand tous sont prêts
//   vote      20 s ; finit quand tous ont voté ; vote modifiable
//   verdict   4 s : le plus voté (une égalité en tête le sauve)
//   guess     15 s, seulement si le Faux Témoin est démasqué
//   reveal    sans minuterie : l'hôte passe à la manche suivante
//   … puis `end`.
//
// Toute transition automatique a lieu à SON échéance, pas à l'heure où la
// minuterie se réveille : une minuterie en retard ne donne de temps à personne.
'use strict';
const S = require('./scenes.js');
const Q = require('./questions.js');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;
const ROUNDS = [3, 5, 7];
const DEFAULT_ROUNDS = 3;
const FLASHES = [5000, 8000, 10000];
const DEFAULT_FLASH = 8000;

const ROLE_MS = 3000;
const ASK_MS = 3000;              // lire la question, en plus du premier tour
const ANSWER_MS = 8000;
const DEBATE_MS = 60000;
const DEBATE_LONG_MS = 90000;     // dès DEBATE_LONG_FROM présents
const DEBATE_LONG_FROM = 9;
const VOTE_MS = 20000;
const VERDICT_MS = 4000;
const GUESS_MS = 15000;
const SMALL_TABLE = 6;            // jusqu'à 6 : 2 questions pour tous ; au-delà : 3, une chacun

// Les points d'une manche.
const ESCAPE_POINTS = 3;          // Faux Témoin pas démasqué (égalité en tête comprise)
const GUESS_POINTS = 2;           // démasqué, mais il retrouve la vraie scène
const CATCH_POINTS = 1;           // sinon : à chaque témoin qui a voté contre lui

const REFUS = {
  NOT_IN_GAME: "tu n'es pas dans cette partie",
  STALE_ROUND: 'cette manche est déjà passée',
  NOT_YOUR_TURN: "ce n'est pas ton tour de parole",
  NOT_DEBATING: "ce n'est pas le moment du débat",
  NOT_VOTING: "ce n'est pas le moment de voter",
  BAD_TARGET: 'vote invalide',
  NOT_GUESSING: "ce n'est pas le moment de choisir",
  NOT_LIAR: "seul le Faux Témoin démasqué choisit",
  BAD_OPTION: 'choix invalide',
  ALREADY_GUESSED: 'choix déjà fait',
  NOT_REVEAL: "la manche n'est pas finie",
};

// ------------------------------------------------------------------ outils
function shuffle(arr, random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Les tours de parole d'une manche, pour les présents `ici` et le Faux Témoin
// `liar`. Jusqu'à 6 : deux questions, tout le monde répond aux deux, ordre
// tiré pour chacune. Au-delà : trois questions, chacun répond à une seule
// (groupes de tailles égales à 1 près). Dans tous les cas, le Faux Témoin
// n'ouvre jamais la PREMIÈRE question : il n'aurait rien entendu pour se caler.
function ordres(ici, liar, random) {
  let groupes;
  if (ici.length <= SMALL_TABLE) {
    groupes = [shuffle(ici, random), shuffle(ici, random)];
  } else {
    const m = shuffle(ici, random);
    groupes = [[], [], []];
    m.forEach((id, i) => groupes[i % 3].push(id));
  }
  const g0 = groupes[0];
  if (g0[0] === liar) {
    if (g0.length > 1) {
      const j = 1 + Math.floor(random() * (g0.length - 1));
      [g0[0], g0[j]] = [g0[j], g0[0]];
    } else {
      // Groupe d'un seul (impossible à 7 et plus, gardé par prudence) :
      // il passe dans le 2e groupe, dont il n'ouvre pas la parole non plus.
      groupes[0] = [groupes[1].shift(), ...g0];
    }
  }
  return groupes;
}

// ------------------------------------------------------------------ partie
function createGame(opts) {
  const o = opts || {};
  const ids = Array.isArray(o.players) ? o.players.map(String) : [];
  if (new Set(ids).size !== ids.length) throw new Error('joueur en double');
  if (ids.length < MIN_PLAYERS) throw new Error(`il faut au moins ${MIN_PLAYERS} joueurs`);
  if (ids.length > MAX_PLAYERS) throw new Error(`${MAX_PLAYERS} joueurs maximum`);
  if (typeof o.random !== 'function') throw new Error('hasard non fourni');
  if (!Number.isFinite(o.now)) throw new Error('horloge non fournie');
  if (o.flashMs !== undefined && !FLASHES.includes(o.flashMs)) throw new Error('durée du flash : 5000, 8000 ou 10000');

  // `regles` : durées raccourcies POUR LES TESTS (le serveur les lit dans
  // des variables d'environnement que personne ne pose en production).
  const r = o.regles || {};
  const players = new Map();
  for (const id of ids) players.set(id, { id, score: 0, left: false, liarTimes: 0, caught: 0 });

  const g = {
    phase: null,
    order: ids.slice(),
    players,
    rounds: ROUNDS.includes(o.rounds) ? o.rounds : DEFAULT_ROUNDS,
    flashMs: o.flashMs || DEFAULT_FLASH,
    durations: {
      role: r.roleMs || ROLE_MS,
      flash: r.flashMs || o.flashMs || DEFAULT_FLASH,
      ask: r.askMs != null ? r.askMs : ASK_MS,
      answer: r.answerMs || ANSWER_MS,
      debate: r.debateMs || DEBATE_MS,
      debateLong: r.debateMs || DEBATE_LONG_MS,
      vote: r.voteMs || VOTE_MS,
      verdict: r.verdictMs || VERDICT_MS,
      guess: r.guessMs || GUESS_MS,
    },
    roundId: 0,
    round: null,
    asked: new Set(),          // questions déjà posées dans la partie
    endsAt: null,              // échéance de la phase : SECRÈTE (view donne un reste)
    durationMs: null,
    complete: null,
    random: o.random,
  };
  const ev = [];
  nouvelleManche(g, o.now, ev);
  g.startEvents = ev;
  return g;
}

const presents = (g) => g.order.filter((id) => !g.players.get(id).left);

// Le Faux Témoin : celui qui l'a été le moins souvent, au hasard entre
// ex æquo (chacun l'est à ±1 près sur la partie).
function tirerMenteur(g) {
  const ici = shuffle(presents(g), g.random);
  ici.sort((a, b) => g.players.get(a).liarTimes - g.players.get(b).liarTimes);
  return ici[0];
}

function nouvelleManche(g, at, ev) {
  if (g.roundId >= g.rounds) return finir(g, true, ev);
  const random = g.random;
  g.roundId += 1;
  const liar = tirerMenteur(g);
  g.players.get(liar).liarTimes += 1;
  const ici = presents(g);
  const groupes = ordres(ici, liar, random);
  const questions = Q.tirerQuestions(random, groupes.length, g.asked);
  const scene = S.tirerScene(random);
  g.round = {
    id: g.roundId,
    liar,
    scene,
    title: scene.title,
    questions: questions.map((q, i) => ({ ...q, order: groupes[i] })),
    qi: 0,                    // question en cours
    si: 0,                    // répondant en cours dans `order`
    answered: [],             // tours de parole faits pour la question en cours
    lu: false,                // la question en cours a-t-elle déjà eu son temps de lecture ?
    debateMs: ici.length >= DEBATE_LONG_FROM ? g.durations.debateLong : g.durations.debate,
    ready: new Set(),
    votes: new Map(),         // votant → cible
    verdict: null,            // { accused, tie, caught }
    options: null,            // { versions, vraie } : seulement si démasqué
    guess: null,              // index choisi
    points: null,             // Map id → points
    aborted: null,            // 'liar-left' : le Faux Témoin est parti
  };
  ev.push({ type: 'round', roundId: g.roundId });
  passer(g, 'role', at, ev);
}

function passer(g, phase, at, ev, duree) {
  g.phase = phase;
  const d = duree != null ? duree : g.durations[phase];
  g.durationMs = d == null ? null : d;
  g.endsAt = d == null ? null : at + d;
  ev.push({ type: 'phase', roundId: g.roundId, phase });
}

function finir(g, complete, ev) {
  if (g.phase === 'end') return;
  g.phase = 'end';
  g.endsAt = null;
  g.durationMs = null;
  g.complete = complete;
  ev.push({ type: 'end', complete, ranking: ranking(g) });
}

// ------------------------------------------------------ l'interrogatoire
// Le prochain tour de parole à partir de (qi, si), en sautant les partis.
// Rend false quand l'interrogatoire est fini.
function prochainTour(g, at, ev) {
  const k = g.round;
  while (k.qi < k.questions.length) {
    const q = k.questions[k.qi];
    while (k.si < q.order.length && g.players.get(q.order[k.si]).left) k.si += 1;
    if (k.si < q.order.length) {
      // Le temps de lire la question : au premier tour de la question seulement.
      const lecture = k.lu ? 0 : g.durations.ask;
      k.lu = true;
      passer(g, 'question', at, ev, g.durations.answer + lecture);
      return true;
    }
    k.qi += 1;
    k.si = 0;
    k.answered = [];
    k.lu = false;
  }
  return false;
}

function finTour(g, at, ev) {
  const k = g.round;
  const q = k.questions[k.qi];
  k.answered.push(q.order[k.si]);
  k.si += 1;
  if (!prochainTour(g, at, ev)) passer(g, 'debate', at, ev, k.debateMs);
}

// ------------------------------------------------------------- le verdict
// Le plus voté est accusé ; une égalité en tête (ou aucun vote) ne désigne
// personne, et sauve donc le Faux Témoin (règle d'A Fake Artist Goes to New
// York). Seuls comptent les votes de joueurs présents pour des joueurs présents.
function compter(g) {
  const k = g.round;
  const n = new Map();
  for (const [v, cible] of k.votes) {
    if (g.players.get(v).left || g.players.get(cible).left) continue;
    n.set(cible, (n.get(cible) || 0) + 1);
  }
  let max = 0, accuses = [];
  for (const [id, x] of n) {
    if (x > max) { max = x; accuses = [id]; } else if (x === max) accuses.push(id);
  }
  const accused = accuses.length === 1 ? accuses[0] : null;
  return { accused, tie: accuses.length > 1, caught: accused === k.liar };
}

function verdict(g, at, ev) {
  g.round.verdict = compter(g);
  passer(g, 'verdict', at, ev);
}

function apresVerdict(g, at, ev) {
  const k = g.round;
  if (k.verdict.caught) {
    k.options = S.versions(g.random, k.scene);
    return passer(g, 'guess', at, ev);
  }
  reveler(g, at, ev);
}

// La révélation : les points, puis tout est public. Aucune minuterie : l'hôte
// passe à la suite (`next`).
function reveler(g, at, ev) {
  const k = g.round;
  const points = new Map(g.order.map((id) => [id, 0]));
  if (!k.aborted) {
    const v = k.verdict;
    if (!v.caught) {
      points.set(k.liar, ESCAPE_POINTS);
    } else if (k.guess === k.options.vraie) {
      points.set(k.liar, GUESS_POINTS);
    } else {
      g.players.get(k.liar).caught += 1;
      for (const [votant, cible] of k.votes) {
        if (cible === k.liar && votant !== k.liar && !g.players.get(votant).left) points.set(votant, CATCH_POINTS);
      }
    }
  }
  for (const [id, p] of points) g.players.get(id).score += p;
  k.points = points;
  passer(g, 'reveal', at, ev, null);
}

// ----------------------------------------------------------------- horloge
// L'échéance que le serveur doit attendre (une seule minuterie). Jamais envoyée.
function nextDeadline(g) {
  if (g.phase === 'end' || g.endsAt == null) return null;
  return g.endsAt;
}

function avancer(g, at, ev) {
  const k = g.round;
  switch (g.phase) {
    case 'role': return passer(g, 'flash', at, ev);
    case 'flash': if (!prochainTour(g, at, ev)) passer(g, 'debate', at, ev, k.debateMs); return undefined;
    case 'question': return finTour(g, at, ev);
    case 'debate': return passer(g, 'vote', at, ev);
    case 'vote': return verdict(g, at, ev);
    case 'verdict': return apresVerdict(g, at, ev);
    case 'guess': return reveler(g, at, ev);
    default: return undefined;
  }
}

// Fait avancer le jeu jusqu'à `now`. Rend les événements.
function tick(g, now, events) {
  const ev = events || [];
  for (let garde = 0; garde < 1000; garde++) {
    if (g.phase === 'end' || g.endsAt == null || now < g.endsAt) break;
    avancer(g, g.endsAt, ev);
  }
  return ev;
}

// Fins anticipées : tous les présents sont prêts (débat), ont voté (vote).
function verifierFinAnticipee(g, at, ev) {
  const k = g.round;
  if (!k) return;
  const ici = presents(g);
  if (g.phase === 'debate' && ici.every((id) => k.ready.has(id))) passer(g, 'vote', at, ev);
  else if (g.phase === 'vote' && ici.every((id) => k.votes.has(id))) verdict(g, at, ev);
}

// ------------------------------------------------------------------ actions
const refus = (reason, events) => ({ ok: false, reason, message: REFUS[reason], events });

function garde(g, playerId, roundId, now) {
  const events = tick(g, now);
  const id = String(playerId);
  const p = g.players.get(id);
  if (!p || p.left || g.phase === 'end') return { r: refus('NOT_IN_GAME', events) };
  if (roundId !== g.roundId) return { r: refus('STALE_ROUND', events) };
  return { id, events };
}

// « J'ai répondu » : seul celui qui a la parole peut la rendre.
function answered(g, playerId, roundId, now) {
  const x = garde(g, playerId, roundId, now);
  if (x.r) return x.r;
  const k = g.round;
  if (g.phase !== 'question' || k.questions[k.qi].order[k.si] !== x.id) return refus('NOT_YOUR_TURN', x.events);
  finTour(g, now, x.events);
  return { ok: true, events: x.events };
}

// « Prêt à voter » (ou plus prêt : `ready: false`).
function ready(g, playerId, roundId, etat, now) {
  const x = garde(g, playerId, roundId, now);
  if (x.r) return x.r;
  const k = g.round;
  if (g.phase !== 'debate') return refus('NOT_DEBATING', x.events);
  if (etat === false) k.ready.delete(x.id); else k.ready.add(x.id);
  x.events.push({ type: 'ready', roundId: k.id });
  verifierFinAnticipee(g, now, x.events);
  return { ok: true, events: x.events };
}

// Un vote : pour un AUTRE joueur présent. Modifiable jusqu'à la fin du vote.
function vote(g, playerId, roundId, cible, now) {
  const x = garde(g, playerId, roundId, now);
  if (x.r) return x.r;
  const k = g.round;
  if (g.phase !== 'vote') return refus('NOT_VOTING', x.events);
  const t = typeof cible === 'string' ? cible : '';
  const p = g.players.get(t);
  if (!p || p.left || t === x.id) return refus('BAD_TARGET', x.events);
  k.votes.set(x.id, t);
  x.events.push({ type: 'voted', roundId: k.id });
  verifierFinAnticipee(g, now, x.events);
  return { ok: true, events: x.events };
}

// La dernière chance : le Faux Témoin démasqué désigne une des 4 versions.
function guess(g, playerId, roundId, option, now) {
  const x = garde(g, playerId, roundId, now);
  if (x.r) return x.r;
  const k = g.round;
  if (g.phase !== 'guess') return refus('NOT_GUESSING', x.events);
  if (x.id !== k.liar) return refus('NOT_LIAR', x.events);
  if (k.guess != null) return refus('ALREADY_GUESSED', x.events);
  if (!Number.isInteger(option) || option < 0 || option >= k.options.versions.length) return refus('BAD_OPTION', x.events);
  k.guess = option;
  reveler(g, now, x.events);
  return { ok: true, events: x.events };
}

// L'hôte passe la révélation : manche suivante, ou fin de partie.
function next(g, now) {
  const events = tick(g, now);
  if (g.phase !== 'reveal') return refus('NOT_REVEAL', events);
  nouvelleManche(g, now, events);
  return { ok: true, events };
}

// Un départ est définitif pour la partie.
//   - moins de 3 présents : la partie s'arrête, incomplète (aucun classement
//     ne part au Hub) ;
//   - le Faux Témoin s'en va avant la révélation : la manche s'arrête, sans
//     points (tout est révélé) ;
//   - celui qui a la parole s'en va : on passe au suivant ;
//   - ses votes, et les votes contre lui, ne comptent plus.
function leave(g, playerId, now) {
  const events = tick(g, now);
  const p = g.players.get(String(playerId));
  if (!p || p.left || g.phase === 'end') return events;
  const k = g.round;
  const parlait = g.phase === 'question' && k.questions[k.qi].order[k.si] === p.id;
  p.left = true;
  k.ready.delete(p.id);
  events.push({ type: 'left', id: p.id });
  if (presents(g).length < MIN_PLAYERS) {
    finir(g, false, events);
    return events;
  }
  if (p.id === k.liar && g.phase !== 'reveal') {
    k.aborted = 'liar-left';
    reveler(g, now, events);
    return events;
  }
  if (parlait) {
    k.si += 1;
    if (!prochainTour(g, now, events)) passer(g, 'debate', now, events, k.debateMs);
    return events;
  }
  verifierFinAnticipee(g, now, events);
  return events;
}

// ------------------------------------------------------------------- lecture
// Rang de compétition sur le score (13, 13, 5 → 1, 1, 3). Les joueurs partis
// restent classés avec leurs points.
function ranking(g) {
  const lignes = g.order.map((id) => {
    const p = g.players.get(id);
    return { id, score: p.score, left: p.left };
  });
  lignes.sort((a, b) => b.score - a.score);
  lignes.forEach((l, i) => { l.rank = i > 0 && lignes[i - 1].score === l.score ? lignes[i - 1].rank : i + 1; });
  return lignes;
}

// CE QUE TOUT LE MONDE A LE DROIT DE VOIR. Pendant la manche : le titre, les
// questions déjà posées et celle en cours, qui parle, qui est prêt, QUI a voté
// (jamais pour qui), le verdict une fois rendu. À la révélation : tout.
function view(g, now) {
  const k = g.round;
  const v = {
    phase: g.phase,
    roundId: g.roundId,
    rounds: g.rounds,
    remainingMs: Number.isFinite(now) && g.endsAt != null ? Math.max(0, g.endsAt - now) : null,
    durationMs: g.durationMs,
    title: k ? k.title : null,
    question: null,
    asked: [],
    ready: [],
    voted: [],
    verdict: null,
    liar: null,
    reveal: null,
    players: g.order.map((id) => {
      const p = g.players.get(id);
      return { id, score: p.score, left: p.left };
    }),
    complete: g.phase === 'end' ? g.complete : null,
    ranking: g.phase === 'end' ? ranking(g) : null,
  };
  if (!k || g.phase === 'end') return v;
  const enCours = g.phase === 'question';
  // Les questions déjà ouvertes (pour le débat) : texte seul.
  const ouvertes = enCours ? k.qi + 1 : ['role', 'flash'].includes(g.phase) ? 0 : k.questions.length;
  v.asked = k.questions.slice(0, ouvertes).map((q) => q.text);
  if (enCours) {
    const q = k.questions[k.qi];
    v.question = {
      index: k.qi, count: k.questions.length, text: q.text, famille: q.famille,
      order: q.order.slice(), speaker: q.order[k.si], answered: k.answered.slice(),
    };
  }
  v.ready = [...k.ready];
  v.voted = [...k.votes.keys()].filter((id) => !g.players.get(id).left);
  if (['verdict', 'guess', 'reveal'].includes(g.phase) && k.verdict) v.verdict = { ...k.verdict };
  // Démasqué : son identité est publique dès le verdict (`verdict.accused`) ;
  // on la répète pendant la dernière chance pour l'affichage.
  if (g.phase === 'guess') v.liar = k.liar;
  if (g.phase === 'reveal') v.reveal = revelation(g);
  return v;
}

// Tout ce qui était caché, à la révélation.
function revelation(g) {
  const k = g.round;
  return {
    liar: k.liar,
    scene: k.scene,
    aborted: k.aborted,
    votes: [...k.votes].map(([id, target]) => ({ id, target })),
    verdict: k.verdict ? { ...k.verdict } : null,
    options: k.options ? k.options.versions : null,
    answer: k.options ? k.options.vraie : null,
    guess: k.guess,
    points: [...k.points].map(([id, points]) => ({ id, points })),
  };
}

// CE QU'UN JOUEUR SAIT DE SON RÔLE. Même forme pour tous.
function roleView(g, playerId) {
  const k = g.round;
  const id = String(playerId);
  if (!k || !g.players.has(id) || g.phase === 'end') return null;
  return { roundId: k.id, role: k.liar === id ? 'liar' : 'witness' };
}

// LA SCÈNE : aux témoins seulement, et seulement pendant le flash. Le Faux
// Témoin reçoit la même forme, `scene: null` (il a le titre, public).
function sceneView(g, playerId) {
  const k = g.round;
  const id = String(playerId);
  if (!k || g.phase !== 'flash' || !g.players.has(id)) return null;
  return { roundId: k.id, scene: k.liar === id ? null : k.scene };
}

// LES 4 VERSIONS : au Faux Témoin démasqué seul, pendant la dernière chance.
function optionsView(g, playerId) {
  const k = g.round;
  if (!k || g.phase !== 'guess' || String(playerId) !== k.liar) return null;
  return { roundId: k.id, options: k.options.versions };
}

module.exports = {
  shuffle, ordres, createGame, tick, nextDeadline, answered, ready, vote, guess, next, leave,
  view, roleView, sceneView, optionsView, ranking, compter,
  MIN_PLAYERS, MAX_PLAYERS, ROUNDS, DEFAULT_ROUNDS, FLASHES, DEFAULT_FLASH,
  ROLE_MS, ASK_MS, ANSWER_MS, DEBATE_MS, DEBATE_LONG_MS, DEBATE_LONG_FROM, VOTE_MS, VERDICT_MS, GUESS_MS, SMALL_TABLE,
  ESCAPE_POINTS, GUESS_POINTS, CATCH_POINTS, REFUS,
};
