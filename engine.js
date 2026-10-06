// Moteur PUR de « Faux Témoin ». Aucun réseau, aucun DOM, aucune minuterie :
// l'horloge (`now`, en ms) et le hasard (`random`) sont injectés. Même forme
// que engine.js de croquis-server : tout ce qui décide d'une affaire, d'un
// rôle ou d'un point est ici, et rien d'autre. Le serveur branche ce moteur
// sur ses sockets et sur UNE minuterie, posée à `nextDeadline()`.
//
// Le jeu : un tapissage de suspects dessinés par attributs (chapeau, manteau,
// visage, objet, carrure). Chaque témoin voit en flash UN ou DEUX attributs du
// coupable ; le Faux Témoin le voit en entier et ment. Deux tours de
// déclarations simultanées, révélées d'un bloc ; on verrouille un suspect,
// plus tôt = plus de points. À la fin, l'audit : qui a dit vrai, qui a menti.
//
// LE COUPABLE EST LE SECRET DE CE JEU, et les rôles aussi. Ils ne sortent que
// par `roleView()` (chacun le sien) et, aux résultats, par `view()`. Les
// déclarations d'un tour ne sortent qu'à sa révélation ; les verrous, jamais
// avant les résultats (seulement leur NOMBRE). Le Faux Témoin peut déclarer,
// verrouiller et accuser comme tout le monde (sans effet sur les points) :
// sinon son absence dans les compteurs le trahirait.
//
// Phases d'une affaire :
//   flash      3 s : chacun voit son fragment (rien d'autre ne se passe)
//   declare1   15 s : première déclaration, en silence
//   declare2   15 s : révélation 1 sous les yeux ; deuxième déclaration ;
//              verrou ouvert — un bon verrou ici vaut 5
//   deliberate 12 s : révélation 2 ; un bon verrou vaut 3
//   lastcall   8 s : dernier appel ; un bon verrou vaut 1
//   results    9 s : coupable, Faux Témoin(s), audit, points
//   … affaire suivante, puis `end`.
// declare1 finit plus tôt quand tous les présents ont déclaré ; les phases de
// verrou, quand tous les présents ont verrouillé. declare2, elle, ne finit pas
// plus tôt parce que tout le monde a déclaré : c'est aussi le temps de lire la
// révélation 1, et le seul où un bon verrou vaut 5 (le raccourcir dès que les
// plus rapides ont cliqué pénaliserait ceux qui réfléchissent).
//
// Toute transition automatique a lieu à SON échéance, pas à l'heure où la
// minuterie se réveille : une minuterie en retard ne donne de temps à personne.
'use strict';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 16;
const CASES = [3, 5, 7];
const DEFAULT_CASES = 5;

const FLASH_MS = 3000;
const DECLARE_MS = 15000;
const DELIBERATE_MS = 12000;
const LASTCALL_MS = 8000;
const RESULTS_MS = 9000;

// Points d'un bon verrou selon la phase où il a été posé.
const TIERS = { declare2: 5, deliberate: 3, lastcall: 1 };
const ACCUSE_POINTS = 2;
const LIAR_BASE = 5;          // × part des témoins trompés
const LIAR_HIDDEN = 2;        // si moins d'un tiers des témoins l'ont désigné
const LIAR_CAP = 7;           // = le maximum d'un témoin parfait (5 + 2)

// Le vocabulaire FERMÉ : le client ne déclare qu'une paire (attribut, valeur)
// de cette liste, et le dessin des suspects ne connaît que ça.
const ATTRS = [
  { id: 'chapeau', values: ['aucun', 'melon', 'casquette', 'bonnet', 'haut-de-forme'] },
  { id: 'manteau', values: ['rouge', 'bleu', 'vert', 'jaune', 'violet'] },
  { id: 'visage', values: ['rien', 'lunettes', 'moustache', 'barbe', 'cache-oeil'] },
  { id: 'objet', values: ['rien', 'parapluie', 'valise', 'journal', 'canne'] },
  { id: 'carrure', values: ['mince', 'moyenne', 'costaud'] },
];
const ATTR_IDS = ATTRS.map((a) => a.id);

// L'indic : le faux joueur du mode à 2. Son id ne peut pas être celui d'un
// joueur (le serveur tire des ids en base 36, sans tiret).
const INDIC = 'indic';

const REFUS = {
  NOT_IN_GAME: "tu n'es pas dans cette partie",
  STALE_CASE: 'cette affaire est déjà passée',
  NOT_DECLARING: "ce n'est pas le moment de déclarer",
  ALREADY_DECLARED: 'tu as déjà déclaré pour ce tour',
  BAD_DECLARATION: 'déclaration invalide',
  NOT_LOCKING: "ce n'est pas le moment de verrouiller",
  ALREADY_LOCKED: 'ton verrou est déjà posé',
  BAD_SUSPECT: 'suspect invalide',
  BAD_ACCUSE: 'accusation invalide',
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
const pick = (arr, random) => arr[Math.floor(random() * arr.length)];

// Taille du tapissage selon le nombre de joueurs AU LANCEMENT.
function lineupSize(n) {
  if (n <= 5) return 12;
  if (n <= 10) return 16;
  return 20;
}

// Nombre de Faux Témoins d'une affaire. À 2 : aucun (l'indic les remplace).
// De 3 à 5 : un, dans 75 % des affaires (« y en a-t-il un ? » fait partie de
// la déduction). Au-delà : un pour cinq joueurs.
function liarsFor(n, random) {
  if (n <= 2) return 0;
  if (n <= 5) return random() < 0.75 ? 1 : 0;
  return Math.floor(n / 5);
}

// Ce que tout le monde sait d'avance sur le nombre de Faux Témoins.
function liarsRange(n) {
  if (n <= 2) return { min: 0, max: 0 };
  if (n <= 5) return { min: 0, max: 1 };
  const k = Math.floor(n / 5);
  return { min: k, max: k };
}

// ---------------------------------------------------------------- tapissage
// Un suspect = un tableau de valeurs, dans l'ordre d'ATTRS.
const cle = (s) => s.join('|');
const objetSuspect = (s) => Object.fromEntries(ATTRS.map((a, i) => [a.id, s[i]]));

// Génère un tapissage pour un ensemble d'attributs VUS (indices dans ATTRS)
// par les témoins honnêtes. Garanties (vérifiées, et testées sur des milliers
// de tirages) :
//   1. tous les suspects sont différents ;
//   2. les attributs vus, mis ensemble, n'isolent QUE le coupable ;
//   3. aucun attribut vu ne suffit seul : chaque valeur vue du coupable est
//      portée par au moins MIN_PARTAGE suspects ;
//   4. pour chaque attribut vu, au moins un LEURRE ne diffère du coupable que
//      par cet attribut : un mensonge sur lui désigne quelqu'un de crédible.
const MIN_PARTAGE = 3;

function genererTapissage(random, taille, vus) {
  for (let essai = 0; essai < 500; essai++) {
    const t = essayerTapissage(random, taille, vus);
    if (t && tapissageValide(t.suspects, t.coupable, vus)) return t;
  }
  throw new Error('tapissage impossible');   // jamais vu : le test le tire 5 000 fois
}

function essayerTapissage(random, taille, vus) {
  const coupable = ATTRS.map((a) => pick(a.values, random));
  const suspects = [coupable];
  const deja = new Set([cle(coupable)]);
  const ajouter = (s) => { if (deja.has(cle(s))) return false; deja.add(cle(s)); suspects.push(s); return true; };
  const commeCoupable = (s) => vus.every((i) => s[i] === coupable[i]);

  // Les leurres : identiques au coupable sauf sur UN attribut vu. Deux par
  // attribut dans les grands tapissages.
  const parAttr = taille >= 16 ? 2 : 1;
  for (const i of vus) {
    const autres = shuffle(ATTRS[i].values.filter((v) => v !== coupable[i]), random);
    for (let k = 0; k < parAttr && k < autres.length; k++) {
      const s = coupable.slice();
      s[i] = autres[k];
      ajouter(s);
    }
  }
  // Le reste : au hasard, avec un penchant pour les valeurs du coupable (sinon
  // un seul attribut vu suffirait trop souvent à l'isoler).
  for (let garde = 0; suspects.length < taille && garde < 5000; garde++) {
    const s = ATTRS.map((a, i) => (random() < 0.4 ? coupable[i] : pick(a.values, random)));
    if (commeCoupable(s)) continue;
    ajouter(s);
  }
  if (suspects.length < taille) return null;
  const ordre = shuffle(suspects, random);
  return { suspects: ordre, coupable: ordre.indexOf(coupable) };
}

function tapissageValide(suspects, coupable, vus) {
  if (new Set(suspects.map(cle)).size !== suspects.length) return false;
  const c = suspects[coupable];
  const candidats = suspects.filter((s) => vus.every((i) => s[i] === c[i]));
  if (candidats.length !== 1) return false;
  for (const i of vus) {
    if (suspects.filter((s) => s[i] === c[i]).length < MIN_PARTAGE) return false;
    const leurre = suspects.some((s) => s[i] !== c[i] && ATTRS.every((_, j) => j === i || s[j] === c[j]));
    if (!leurre) return false;
  }
  return true;
}

// Les fragments : `f` attributs par témoin honnête (2 s'ils sont 3 ou moins,
// sinon 1), distribués en tourniquet sur les attributs vus, pour que chaque
// attribut vu le soit par le plus de témoins possible (un mensonge est alors
// contredit).
function distribuerFragments(temoins, random) {
  const h = temoins.length;
  const f = h <= 3 ? 2 : 1;
  const nbVus = Math.max(2, Math.min(ATTRS.length, h * f));
  const vus = shuffle(ATTRS.map((_, i) => i), random).slice(0, nbVus);
  const fragments = new Map();
  temoins.forEach((id, w) => {
    const mes = [];
    for (let k = 0; k < f; k++) mes.push(vus[(w * f + k) % nbVus]);
    fragments.set(id, mes);
  });
  return { vus, fragments };
}

// ------------------------------------------------------------------ partie
function createGame(opts) {
  const o = opts || {};
  const ids = Array.isArray(o.players) ? o.players.map(String) : [];
  if (new Set(ids).size !== ids.length) throw new Error('joueur en double');
  if (ids.includes(INDIC)) throw new Error('id réservé');
  if (ids.length < MIN_PLAYERS) throw new Error(`il faut au moins ${MIN_PLAYERS} joueurs`);
  if (ids.length > MAX_PLAYERS) throw new Error(`${MAX_PLAYERS} joueurs maximum`);
  if (typeof o.random !== 'function') throw new Error('hasard non fourni');
  if (!Number.isFinite(o.now)) throw new Error('horloge non fournie');

  const r = o.regles || {};
  const players = new Map();
  for (const id of ids) players.set(id, { id, score: 0, left: false, liarTimes: 0, found: 0 });

  const g = {
    phase: null,
    order: ids.slice(),
    players,
    cases: CASES.includes(o.cases) ? o.cases : DEFAULT_CASES,
    size: lineupSize(ids.length),
    durations: {
      flash: r.flashMs || FLASH_MS,
      declare1: r.declareMs || DECLARE_MS,
      declare2: r.declareMs || DECLARE_MS,
      deliberate: r.deliberateMs || DELIBERATE_MS,
      lastcall: r.lastcallMs || LASTCALL_MS,
      results: r.resultsMs || RESULTS_MS,
    },
    caseId: 0,
    kase: null,
    endsAt: null,             // échéance de la phase : SECRÈTE (view donne un reste)
    complete: null,
    random: o.random,
  };
  const ev = [];
  nouvelleAffaire(g, o.now, ev);
  g.startEvents = ev;
  return g;
}

const presents = (g) => g.order.filter((id) => !g.players.get(id).left);

// Les Faux Témoins : ceux qui l'ont été le moins souvent, au hasard entre
// ex æquo (répartition à ±1 près sur la partie).
function tirerMenteurs(g, random) {
  const ici = presents(g);
  const k = liarsFor(ici.length, random);
  const melange = shuffle(ici, random);
  melange.sort((a, b) => g.players.get(a).liarTimes - g.players.get(b).liarTimes);
  return melange.slice(0, Math.min(k, Math.max(0, ici.length - 2)));
}

function nouvelleAffaire(g, at, ev) {
  if (g.caseId >= g.cases) return finir(g, true, ev);
  const random = g.random;
  g.caseId += 1;
  const menteurs = tirerMenteurs(g, random);
  menteurs.forEach((id) => { g.players.get(id).liarTimes += 1; });
  const temoins = shuffle(presents(g).filter((id) => !menteurs.includes(id)), random);
  const { vus, fragments } = distribuerFragments(temoins, random);
  const { suspects, coupable } = genererTapissage(random, g.size, vus);
  const n = presents(g).length;

  g.kase = {
    id: g.caseId,
    suspects,
    culprit: coupable,
    range: liarsRange(n),                  // public : combien de Faux Témoins possibles
    liars: new Set(menteurs),
    witnesses: new Set(temoins),           // honnêtes, au départ de l'affaire
    fragments,                             // id → [indices d'attributs]
    declarations: [new Map(), new Map()],  // tour → (id → {attr, value} | null)
    revealed: 0,                           // tours révélés
    locks: new Map(),                      // id → { suspect, accuse, phase }
    indic: n === 2 ? preparerIndic(suspects, coupable, random) : null,
    points: null,
  };
  ev.push({ type: 'case', caseId: g.caseId });
  passer(g, 'flash', at, ev);
}

// L'indic du mode à 2 : deux déclarations, une par révélation, dont UNE
// SEULE est fausse (on ne sait pas laquelle). La fausse désigne de préférence
// la valeur d'un leurre.
function preparerIndic(suspects, culprit, random) {
  const c = suspects[culprit];
  const attrs = shuffle(ATTRS.map((_, i) => i), random).slice(0, 2);
  const fausse = random() < 0.5 ? 0 : 1;
  return attrs.map((i, tour) => {
    if (tour !== fausse) return { attr: ATTRS[i].id, value: c[i] };
    // Un leurre ne diffère du coupable que par cet attribut : sa valeur rend
    // le mensonge crédible. Sans leurre sur cet attribut, une autre valeur.
    const leurres = suspects.filter((s) => s[i] !== c[i] && ATTRS.every((_, j) => j === i || s[j] === c[j]));
    const valeurs = leurres.length ? leurres.map((s) => s[i]) : ATTRS[i].values.filter((v) => v !== c[i]);
    return { attr: ATTRS[i].id, value: pick(valeurs, random) };
  });
}

function passer(g, phase, at, ev) {
  g.phase = phase;
  g.endsAt = at + g.durations[phase];
  const k = g.kase;
  if (phase === 'declare2' || phase === 'deliberate') reveler(g, phase === 'declare2' ? 0 : 1);
  if (phase === 'results') resoudre(g, ev);
  else if (phase !== 'flash') ev.push({ type: 'phase', caseId: k.id, phase });   // flash : annoncé par `case`
}

// Les déclarations d'un tour, révélées d'un bloc (et celle de l'indic avec).
function reveler(g, tour) {
  const k = g.kase;
  k.revealed = tour + 1;
  if (k.indic) k.declarations[tour].set(INDIC, k.indic[tour]);
}

function finir(g, complete, ev) {
  if (g.phase === 'end') return;
  g.phase = 'end';
  g.endsAt = null;
  g.complete = complete;
  ev.push({ type: 'end', complete, ranking: ranking(g) });
}

// ----------------------------------------------------------------- l'audit
const estVraie = (k, d) => {
  if (!d) return null;
  const i = ATTR_IDS.indexOf(d.attr);
  return k.suspects[k.culprit][i] === d.value;
};

function resoudre(g, ev) {
  const k = g.kase;
  const points = new Map();
  const temoins = [...k.witnesses].filter((id) => !g.players.get(id).left || k.locks.has(id));

  // Les témoins honnêtes.
  for (const id of temoins) {
    const v = k.locks.get(id);
    const menti = k.declarations.some((t) => estVraie(k, t.get(id)) === false);
    let p = 0;
    if (!menti && v) {
      if (v.suspect === k.culprit) { p += TIERS[v.phase]; g.players.get(id).found += 1; }
      if (v.accuse && k.liars.has(v.accuse)) p += ACCUSE_POINTS;
    }
    points.set(id, p);
  }
  // Les Faux Témoins : la part des témoins trompés, plus un bonus s'il est
  // passé inaperçu. Plafonné au maximum d'un témoin parfait.
  for (const id of k.liars) {
    let p = 0;
    if (temoins.length) {
      const trompes = temoins.filter((w) => { const v = k.locks.get(w); return !v || v.suspect !== k.culprit; }).length;
      const designe = temoins.filter((w) => { const v = k.locks.get(w); return v && v.accuse === id; }).length;
      p = Math.round(LIAR_BASE * trompes / temoins.length);
      if (designe * 3 < temoins.length) p += LIAR_HIDDEN;
    }
    points.set(id, Math.min(LIAR_CAP, p));
  }
  for (const [id, p] of points) g.players.get(id).score += p;
  k.points = points;
  ev.push({ type: 'results', caseId: k.id });
}

// ----------------------------------------------------------------- horloge
// L'échéance que le serveur doit attendre (une seule minuterie). Jamais envoyée.
function nextDeadline(g) {
  if (g.phase === 'end' || g.endsAt == null) return null;
  return g.endsAt;
}

const SUITE = { flash: 'declare1', declare1: 'declare2', declare2: 'deliberate', deliberate: 'lastcall', lastcall: 'results' };

// Fait avancer le jeu jusqu'à `now`. Rend les événements.
function tick(g, now, events) {
  const ev = events || [];
  for (let garde = 0; garde < 1000; garde++) {
    if (g.phase === 'end' || g.endsAt == null || now < g.endsAt) break;
    avancer(g, g.endsAt, ev);
  }
  return ev;
}

function avancer(g, at, ev) {
  if (g.phase === 'results') return nouvelleAffaire(g, at, ev);
  passer(g, SUITE[g.phase], at, ev);
}

// Fin anticipée : tout le monde a fait sa part. En declare1 : tous les
// présents ont déclaré. En verrou : tous les présents ont verrouillé — on va
// alors droit aux résultats (une révélation de plus ne servirait à rien).
function verifierFinAnticipee(g, at, ev) {
  const k = g.kase;
  if (!k) return;
  const ici = presents(g);
  if (!ici.length) return;
  const tousVerrous = ici.every((id) => k.locks.has(id));
  if (['declare2', 'deliberate', 'lastcall'].includes(g.phase) && tousVerrous) {
    return passer(g, 'results', at, ev);
  }
  if (g.phase === 'declare1' && ici.every((id) => k.declarations[0].has(id))) avancer(g, at, ev);
}

// ------------------------------------------------------------------ actions
const refus = (reason, events) => ({ ok: false, reason, message: REFUS[reason], events });

// Une déclaration : `decl` = { attr, value }, ou null pour « je ne dis rien ».
function declare(g, playerId, caseId, decl, now) {
  const events = tick(g, now);
  const id = String(playerId);
  const p = g.players.get(id);
  if (!p || p.left) return refus('NOT_IN_GAME', events);
  if (g.phase !== 'declare1' && g.phase !== 'declare2') return refus('NOT_DECLARING', events);
  if (caseId !== g.caseId) return refus('STALE_CASE', events);
  const tour = g.phase === 'declare1' ? 0 : 1;
  const k = g.kase;
  if (k.declarations[tour].has(id)) return refus('ALREADY_DECLARED', events);
  let d = null;
  if (decl != null) {
    if (typeof decl !== 'object') return refus('BAD_DECLARATION', events);
    const a = ATTRS.find((x) => x.id === decl.attr);
    if (!a || typeof decl.value !== 'string' || !a.values.includes(decl.value)) return refus('BAD_DECLARATION', events);
    d = { attr: a.id, value: decl.value };
  }
  k.declarations[tour].set(id, d);
  events.push({ type: 'declared', caseId: k.id, id });
  verifierFinAnticipee(g, now, events);
  return { ok: true, events };
}

// Un verrou : définitif. `accuse` (facultatif) désigne un Faux Témoin présumé.
function lock(g, playerId, caseId, suspect, accuse, now) {
  const events = tick(g, now);
  const id = String(playerId);
  const p = g.players.get(id);
  if (!p || p.left) return refus('NOT_IN_GAME', events);
  if (!TIERS[g.phase]) return refus('NOT_LOCKING', events);
  if (caseId !== g.caseId) return refus('STALE_CASE', events);
  const k = g.kase;
  if (k.locks.has(id)) return refus('ALREADY_LOCKED', events);
  if (!Number.isInteger(suspect) || suspect < 0 || suspect >= k.suspects.length) return refus('BAD_SUSPECT', events);
  let a = null;
  if (accuse != null && accuse !== '') {
    a = String(accuse);
    if (a === id || !g.players.has(a)) return refus('BAD_ACCUSE', events);
  }
  k.locks.set(id, { suspect, accuse: a, phase: g.phase });
  events.push({ type: 'locked', caseId: k.id });
  verifierFinAnticipee(g, now, events);
  return { ok: true, events };
}

// L'hôte passe les résultats d'une affaire.
function next(g, now) {
  const events = tick(g, now);
  if (g.phase === 'results') nouvelleAffaire(g, now, events);
  return events;
}

// Un départ est définitif pour la partie. Ses déclarations et son verrou
// restent ; il ne bloque plus les fins anticipées. Moins de 2 présents : la
// partie s'arrête, incomplète (aucun classement ne part au Hub).
function leave(g, playerId, now) {
  const events = tick(g, now);
  const p = g.players.get(String(playerId));
  if (!p || p.left || g.phase === 'end') return events;
  p.left = true;
  events.push({ type: 'left', id: p.id });
  if (presents(g).length < MIN_PLAYERS) {
    finir(g, false, events);
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
    return { id, score: p.score, found: p.found, left: p.left };
  });
  lignes.sort((a, b) => b.score - a.score);
  lignes.forEach((l, i) => { l.rank = i > 0 && lignes[i - 1].score === l.score ? lignes[i - 1].rank : i + 1; });
  return lignes;
}

function declarationsRevelees(k, tour) {
  return [...k.declarations[tour]].map(([id, d]) => (d ? { id, attr: d.attr, value: d.value } : { id, pass: true }));
}

// Le décompte public d'un tour révélé : attribut → valeur → nombre.
function resume(k, tour) {
  const r = {};
  for (const d of k.declarations[tour].values()) {
    if (!d) continue;
    r[d.attr] = r[d.attr] || {};
    r[d.attr][d.value] = (r[d.attr][d.value] || 0) + 1;
  }
  return r;
}

// CE QUE TOUT LE MONDE A LE DROIT DE VOIR. Pendant l'affaire : le tapissage,
// QUI a déclaré (jamais quoi) pour le tour en cours, les tours révélés, le
// NOMBRE de verrous. Aux résultats : tout (coupable, rôles, audit, points).
function view(g, now) {
  const k = g.kase;
  const fini = g.phase === 'results' || g.phase === 'end';
  const tourEnCours = g.phase === 'declare1' ? 0 : g.phase === 'declare2' ? 1 : null;
  const v = {
    phase: g.phase,
    caseId: g.caseId,
    cases: g.cases,
    remainingMs: Number.isFinite(now) && g.endsAt != null ? Math.max(0, g.endsAt - now) : null,
    durationMs: g.endsAt != null ? g.durations[g.phase] : null,
    liars: k ? k.range : liarsRange(g.order.length),
    indic: !!(k && k.indic),
    lineup: k ? k.suspects.map(objetSuspect) : null,
    declared: k && tourEnCours != null ? [...k.declarations[tourEnCours].keys()].filter((id) => id !== INDIC) : [],
    rounds: k ? [0, 1].filter((t) => t < k.revealed).map((t) => ({ round: t + 1, declarations: declarationsRevelees(k, t), summary: resume(k, t) })) : [],
    locked: k ? k.locks.size : 0,
    players: g.order.map((id) => {
      const p = g.players.get(id);
      return { id, score: p.score, left: p.left };
    }),
    audit: null,
    complete: g.phase === 'end' ? g.complete : null,
    ranking: g.phase === 'end' ? ranking(g) : null,
  };
  if (fini && k && k.points) v.audit = audit(g);
  return v;
}

// L'audit d'une affaire résolue : tout ce qui était caché.
function audit(g) {
  const k = g.kase;
  return {
    culprit: k.culprit,
    liars: [...k.liars],
    fragments: [...k.fragments].map(([id, attrs]) => ({ id, attrs: attrs.map((i) => ATTRS[i].id) })),
    declarations: [0, 1].flatMap((t) => [...k.declarations[t]].map(([id, d]) => ({
      round: t + 1, id, attr: d ? d.attr : null, value: d ? d.value : null, truth: estVraie(k, d),
    }))),
    locks: [...k.locks].map(([id, l]) => ({
      id, suspect: l.suspect, phase: l.phase, accuse: l.accuse,
      correct: l.suspect === k.culprit, accuseCorrect: l.accuse ? k.liars.has(l.accuse) : null,
    })),
    points: [...k.points].map(([id, points]) => ({ id, points, liar: k.liars.has(id) })),
  };
}

// CE QU'UN JOUEUR SAIT DE SON RÔLE. Même forme pour tous (mêmes clés) :
// personne n'apprend son rôle — ni celui d'un autre — à la forme du message.
//   témoin : son fragment, `culprit: null` ;
//   Faux Témoin : le coupable entier (toutes les paires) et son index.
function roleView(g, playerId) {
  const k = g.kase;
  const id = String(playerId);
  if (!k || !g.players.has(id) || g.phase === 'end') return null;
  const c = k.suspects[k.culprit];
  if (k.liars.has(id)) {
    return { caseId: k.id, role: 'liar', fragment: ATTRS.map((a, i) => ({ attr: a.id, value: c[i] })), culprit: k.culprit };
  }
  const mes = k.fragments.get(id);
  if (!mes) return { caseId: k.id, role: 'none', fragment: [], culprit: null };   // arrivé… jamais : pas de join en cours
  return { caseId: k.id, role: 'witness', fragment: mes.map((i) => ({ attr: ATTRS[i].id, value: c[i] })), culprit: null };
}

module.exports = {
  shuffle, lineupSize, liarsFor, liarsRange, genererTapissage, tapissageValide, distribuerFragments,
  createGame, tick, nextDeadline, declare, lock, next, leave, view, roleView, ranking,
  MIN_PLAYERS, MAX_PLAYERS, CASES, DEFAULT_CASES, FLASH_MS, DECLARE_MS, DELIBERATE_MS, LASTCALL_MS, RESULTS_MS,
  TIERS, ACCUSE_POINTS, LIAR_BASE, LIAR_HIDDEN, LIAR_CAP, ATTRS, ATTR_IDS, INDIC, MIN_PARTAGE, REFUS,
};
