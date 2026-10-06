// Tests du moteur pur (engine.js, scenes.js, questions.js) : aucun réseau,
// horloge et hasard injectés.
//
//   node test-engine.mjs
//
// 1. les scènes et les 4 versions (garanties sur des milliers de tirages) ;
// 2. les questions ; 3. les tours de parole selon le nombre de joueurs ;
// 4. les phases et leurs échéances (flash réglable) ; 5. le vote et le
// verdict ; 6. les points ; 7. la rotation du Faux Témoin et le classement ;
// 8. les départs ; 9. LES SECRETS : ce que view(), roleView(), sceneView() et
// optionsView() ne doivent jamais rendre trop tôt, ni à la mauvaise personne.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./engine.js');
const S = require('./scenes.js');
const Q = require('./questions.js');

let ok = 0, ko = 0;
const t = (nom, cond, detail) => {
  if (cond) { ok++; console.log('OK   ' + nom); }
  else { ko++; console.log('KO   ' + nom + (detail ? ' — ' + detail : '')); }
};

// Hasard reproductible (mulberry32).
const graine = (s) => () => {
  s |= 0; s = (s + 0x6D2B79F5) | 0;
  let x = Math.imul(s ^ (s >>> 15), 1 | s);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const ids = (n) => Array.from({ length: n }, (_, i) => 'p' + i);
const jeu = (n, seed = 1, o = {}) => E.createGame({ players: ids(n), now: 0, random: graine(seed), rounds: 3, ...o });
// Amène la manche en cours jusqu'à `phase` à coups d'échéances.
const jusqua = (g, phase) => {
  for (let garde = 0; garde < 100 && g.phase !== phase && g.endsAt != null; garde++) E.tick(g, g.endsAt);
  return g.phase === phase;
};
const temoins = (g) => g.order.filter((id) => id !== g.round.liar && !g.players.get(id).left);
// Fait voter tout le monde (présents) : `choix(id)` → cible.
const voter = (g, choix) => {
  const now = g.endsAt - 1;
  for (const id of g.order.filter((x) => !g.players.get(x).left)) {
    if (g.phase !== 'vote') break;
    E.vote(g, id, g.roundId, choix(id), now);
  }
};
const autre = (g, id) => g.order.find((x) => x !== id && !g.players.get(x).left);

// ================================================= 1. scènes et versions
{
  const r = graine(7);
  let valides = true, humains = true, zones = true, vocab = true, lieux = new Set();
  for (let i = 0; i < 6000; i++) {
    const s = S.tirerScene(r);
    lieux.add(s.place);
    const lieu = S.LIEUX.find((l) => l.id === s.place);
    if (!S.sceneValide(lieu, s)) valides = false;
    if (s.items.filter((x) => S.estHumain(x.item)).length < 2) humains = false;
    if (!S.ZONES_NOMMEES.every((z) => s.items.some((x) => x.zone === z && x.item))) zones = false;
  }
  for (const l of S.LIEUX) for (const sl of l.slots) for (const v of sl.variants) if (!S.varianteValide(v)) { vocab = false; console.log('     variante hors vocabulaire', l.id, sl.id, JSON.stringify(v)); }
  t('[1] 6 000 scènes : toutes valides', valides);
  t('[1] chaque scène a au moins 2 personnages', humains);
  t('[1] gauche, droite, fond et premier plan jamais vides (questions de zone)', zones);
  t('[1] toutes les variantes sont dans le vocabulaire du dessin (KINDS)', vocab);
  t('[1] les 6 lieux sortent tous', lieux.size === S.LIEUX.length && S.LIEUX.length === 6);
  t('[1] chaque lieu : titre, 8 emplacements, ids uniques, zones connues',
    S.LIEUX.every((l) => l.title && l.slots.length === 8 && new Set(l.slots.map((s) => s.id)).size === 8 && l.slots.every((s) => S.ZONES.includes(s.zone))));
  t('[1] chaque emplacement a au moins 2 variantes', S.LIEUX.every((l) => l.slots.every((s) => s.variants.length >= 2)));

  let distinctes = true, trois = true, vraieOk = true, memeLieu = true, positions = [0, 0, 0, 0];
  for (let i = 0; i < 4000; i++) {
    const s = S.tirerScene(r);
    const { versions, vraie } = S.versions(r, s);
    if (new Set(versions.map((v) => JSON.stringify(v.items))).size !== 4) distinctes = false;
    if (versions[vraie] !== s) vraieOk = false;
    if (!versions.every((v, j) => j === vraie || S.ecarts(v, s) === S.CHANGES)) trois = false;
    if (!versions.every((v) => v.place === s.place && v.title === s.title && S.sceneValide(S.LIEUX.find((l) => l.id === s.place), v))) memeLieu = false;
    positions[vraie] += 1;
  }
  t('[1] 4 000 dernières chances : 4 versions toutes différentes', distinctes);
  t('[1] l index rendu est bien la vraie scène', vraieOk);
  t('[1] chaque leurre diffère de la vraie sur exactement 3 emplacements', trois);
  t('[1] même lieu, même titre, versions valides', memeLieu);
  t('[1] la vraie tombe à chaque place (pas de position favorite)', positions.every((n) => n > 800), positions.join('/'));
}

// ======================================================== 2. les questions
{
  const mots = (s) => s.replace(/[?.,!]/g, ' ').split(/\s+/).filter(Boolean).length;
  t('[2] une vingtaine de questions, ids uniques', Q.QUESTIONS.length >= 18 && new Set(Q.QUESTIONS.map((q) => q.id)).size === Q.QUESTIONS.length);
  t('[2] dix mots au plus', Q.QUESTIONS.every((q) => mots(q.text) <= 10), Q.QUESTIONS.filter((q) => mots(q.text) > 10).map((q) => q.id).join(','));
  t('[2] familles connues, ouvertes et ciblées présentes',
    Q.QUESTIONS.every((q) => [...Q.OUVERTES, ...Q.CIBLEES].includes(q.famille)) && Q.OUVERTES.every((f) => Q.QUESTIONS.some((q) => q.famille === f)) && Q.CIBLEES.every((f) => Q.QUESTIONS.some((q) => q.famille === f)));
  // Pas de quiz : aucune question ne compte un objet précis ni n'attend oui/non.
  t('[2] pas de question à réponse unique (« combien de chiens », « est-ce que »)', !Q.QUESTIONS.some((q) => /combien de (chiens|chats|v[ée]los)|^est-ce que|^y avait-il un/i.test(q.text)));
  const r = graine(3);
  let ouverteDabord = true, famillesDiff = true;
  for (let i = 0; i < 500; i++) {
    const n = i % 2 ? 2 : 3;
    const qs = Q.tirerQuestions(r, n, new Set());
    if (!Q.OUVERTES.includes(qs[0].famille)) ouverteDabord = false;
    const fam = qs.slice(1).map((q) => q.famille);
    if (!fam.every((f) => Q.CIBLEES.includes(f)) || new Set(fam).size !== fam.length) famillesDiff = false;
  }
  t('[2] la première question d une manche est toujours ouverte', ouverteDabord);
  t('[2] les suivantes sont ciblées, de familles différentes', famillesDiff);
  // Assez de questions pour la plus longue partie à 2 questions (7 manches)
  // et pour la partie par défaut à 3 questions (3 manches).
  let reposee = 0;
  for (let s = 1; s <= 200; s++) {
    for (const [manches, n] of [[7, 2], [3, 3]]) {
      const deja = new Set();
      const toutes = [];
      const rr = graine(s * 7 + n);
      for (let m = 0; m < manches; m++) toutes.push(...Q.tirerQuestions(rr, n, deja).map((q) => q.id));
      if (new Set(toutes).size !== toutes.length) reposee++;
    }
  }
  t('[2] 7 manches à 2 questions, 3 manches à 3 : aucune question reposée (400 parties)', reposee === 0, String(reposee));
}

// ==================================================== 3. tours de parole
{
  let jamaisPremier = true;
  for (const n of [3, 4, 5, 6, 7, 10, 16]) {
    for (let s = 1; s <= 300; s++) {
      const r = graine(s * 31 + n);
      const ici = ids(n);
      const liar = ici[Math.floor(r() * n)];
      const gr = E.ordres(ici, liar, r);
      if (gr[0][0] === liar) jamaisPremier = false;
    }
  }
  t('[3] le Faux Témoin n ouvre jamais la première question (3 à 16 joueurs, 2 100 tirages)', jamaisPremier);
  for (const n of [3, 4, 5, 6]) {
    const gr = E.ordres(ids(n), 'p0', graine(n));
    t(`[3] ${n} joueurs : 2 questions, tout le monde répond aux deux`, gr.length === 2 && gr.every((x) => x.length === n && new Set(x).size === n));
  }
  for (const [n, tailles] of [[7, '3,2,2'], [9, '3,3,3'], [16, '6,5,5']]) {
    const gr = E.ordres(ids(n), 'p3', graine(n));
    const tout = gr.flat();
    t(`[3] ${n} joueurs : 3 questions, une chacun (${tailles})`, gr.length === 3 && gr.map((x) => x.length).join(',') === tailles && new Set(tout).size === n && tout.length === n);
  }
  // L'ordre change d'une question à l'autre (petite table).
  let change = 0;
  for (let s = 1; s <= 50; s++) { const gr = E.ordres(ids(5), 'p0', graine(s)); if (gr[0].join() !== gr[1].join()) change++; }
  t('[3] petite table : l ordre est retiré pour la 2e question', change > 40, String(change));
}

// ====================================================== 4. phases et durées
{
  const g = jeu(4, 11);
  t('[4] la partie commence au rôle (3 s)', g.phase === 'role' && g.endsAt === E.ROLE_MS);
  t('[4] 3 manches par défaut, flash de 8 s par défaut', g.rounds === 3 && g.flashMs === 8000);
  E.tick(g, E.ROLE_MS - 1);
  t('[4] pas d avance avant l échéance', g.phase === 'role');
  E.tick(g, E.ROLE_MS);
  t('[4] puis le flash : 8 s', g.phase === 'flash' && g.endsAt - E.ROLE_MS === 8000);
  for (const f of E.FLASHES) {
    const h = E.createGame({ players: ids(3), now: 0, random: graine(2), flashMs: f });
    E.tick(h, E.ROLE_MS);
    t(`[4] flash réglé à ${f / 1000} s`, h.flashMs === f && h.endsAt - E.ROLE_MS === f);
  }
  let refuse = false;
  try { E.createGame({ players: ids(3), now: 0, random: graine(2), flashMs: 6000 }); } catch (_) { refuse = true; }
  t('[4] flash hors 5/8/10 s : refusé', refuse);
  let trois = false;
  try { E.createGame({ players: ids(2), now: 0, random: graine(2) }); } catch (_) { trois = true; }
  t('[4] moins de 3 joueurs : refusé', trois);

  const debut = g.endsAt;
  E.tick(g, debut);
  const q = g.round.questions[0];
  t('[4] interrogatoire : le premier tour dure 8 s + 3 s de lecture', g.phase === 'question' && g.endsAt - debut === E.ANSWER_MS + E.ASK_MS);
  t('[4] la question 1 est posée au premier de son ordre', E.view(g, debut).question.speaker === q.order[0] && E.view(g, debut).question.index === 0);
  const t2 = g.endsAt;
  E.tick(g, t2);
  t('[4] tour suivant à l échéance : 8 s, au 2e répondant', g.phase === 'question' && g.endsAt - t2 === E.ANSWER_MS && E.view(g, t2).question.speaker === q.order[1]);
  const pasLui = q.order.find((id) => id !== q.order[1]);
  const r1 = E.answered(g, pasLui, g.roundId, t2 + 10);
  t('[4] « J ai répondu » d un autre que celui qui parle : refusé', !r1.ok && r1.reason === 'NOT_YOUR_TURN');
  const r2 = E.answered(g, q.order[1], g.roundId, t2 + 10);
  t('[4] « J ai répondu » de celui qui parle : passe au suivant tout de suite', r2.ok && E.view(g, t2 + 10).question.speaker === q.order[2] && g.endsAt === t2 + 10 + E.ANSWER_MS);
  const r3 = E.answered(g, q.order[2], 99, t2 + 20);
  t('[4] manche périmée : refusé', !r3.ok && r3.reason === 'STALE_ROUND');
  jusqua(g, 'debate');
  t('[4] après les 2 questions (4 répondants chacune) : le débat, 60 s', g.phase === 'debate' && g.durationMs === E.DEBATE_MS);
  t('[4] le débat voit les 2 questions posées', E.view(g, g.endsAt - 1).asked.length === 2);
  const big = jeu(9, 4);
  jusqua(big, 'debate');
  t('[4] dès 9 joueurs : débat de 90 s', big.durationMs === E.DEBATE_LONG_MS);
  // Prêt à voter : tout le monde → vote tout de suite.
  const now = g.endsAt - 30000;
  for (const id of g.order.slice(0, 3)) E.ready(g, id, g.roundId, true, now);
  t('[4] 3 prêts sur 4 : toujours le débat', g.phase === 'debate' && E.view(g, now).ready.length === 3);
  E.ready(g, g.order[0], g.roundId, false, now);
  t('[4] « plus prêt » retire le joueur', E.view(g, now).ready.length === 2);
  for (const id of g.order) E.ready(g, id, g.roundId, true, now);
  t('[4] tout le monde prêt : le vote commence (20 s)', g.phase === 'vote' && g.endsAt === now + E.VOTE_MS);
  const r4 = E.ready(g, g.order[0], g.roundId, true, now);
  t('[4] « prêt » hors débat : refusé', !r4.ok && r4.reason === 'NOT_DEBATING');
}

// ===================================================== 5. vote et verdict
{
  const g = jeu(5, 21);
  jusqua(g, 'vote');
  const liar = g.round.liar;
  const now = g.endsAt - 1000;
  t('[5] vote pour soi : refusé', E.vote(g, 'p0', g.roundId, 'p0', now).reason === 'BAD_TARGET');
  t('[5] vote pour un inconnu : refusé', E.vote(g, 'p0', g.roundId, 'zz', now).reason === 'BAD_TARGET');
  t('[5] vote sans cible : refusé', E.vote(g, 'p0', g.roundId, undefined, now).reason === 'BAD_TARGET');
  E.vote(g, 'p0', g.roundId, 'p1', now);
  E.vote(g, 'p0', g.roundId, 'p2', now);
  t('[5] un vote se change : le dernier compte, un seul votant', g.round.votes.get('p0') === 'p2' && E.view(g, now).voted.length === 1);
  t('[5] le vote attend les autres', g.phase === 'vote');
  // Le Faux Témoin vote comme tout le monde (sinon son absence le trahirait).
  voter(g, (id) => (id === liar ? autre(g, liar) : liar));
  t('[5] tout le monde a voté : verdict tout de suite', g.phase === 'verdict');
  t('[5] le Faux Témoin, seul en tête : démasqué', g.round.verdict.caught === true && g.round.verdict.accused === liar && g.round.verdict.tie === false);
  E.tick(g, g.endsAt);
  t('[5] démasqué : la dernière chance (15 s)', g.phase === 'guess' && g.durationMs === E.GUESS_MS);

  // Égalité en tête : personne n'est accusé, le Faux Témoin s'en sort.
  const h = jeu(4, 22);
  jusqua(h, 'vote');
  const L = h.round.liar, [w1, w2, w3] = temoins(h);
  const n2 = h.endsAt - 1;
  E.vote(h, w1, h.roundId, L, n2); E.vote(h, w2, h.roundId, L, n2);
  E.vote(h, w3, h.roundId, w1, n2); E.vote(h, L, h.roundId, w1, n2);
  t('[5] égalité en tête (2 / 2) : personne d accusé, pas démasqué', h.phase === 'verdict' && h.round.verdict.accused === null && h.round.verdict.tie === true && h.round.verdict.caught === false);
  E.tick(h, h.endsAt);
  t('[5] pas démasqué : droit à la révélation (pas de dernière chance)', h.phase === 'reveal');

  // Personne ne vote : fin à l'échéance, personne d'accusé.
  const k = jeu(3, 23);
  jusqua(k, 'vote');
  E.tick(k, k.endsAt);
  t('[5] aucun vote à l échéance : verdict sans accusé', k.phase === 'verdict' && k.round.verdict.accused === null && k.round.verdict.tie === false);

  // Un témoin accusé à tort.
  const m = jeu(5, 24);
  jusqua(m, 'vote');
  const LL = m.round.liar, cible = temoins(m)[0];
  voter(m, (id) => (id === cible ? LL : cible));
  t('[5] un témoin seul en tête : accusé, le Faux Témoin s en sort', m.round.verdict.accused === cible && m.round.verdict.caught === false);
}

// ============================================================ 6. les points
{
  // a) Le Faux Témoin s'en sort : +3 pour lui, rien pour les autres.
  const a = jeu(4, 31);
  jusqua(a, 'vote');
  const La = a.round.liar, ca = temoins(a)[0];
  voter(a, (id) => (id === ca ? La : ca));
  jusqua(a, 'reveal');
  t('[6] pas démasqué : +3 au Faux Témoin, 0 aux autres',
    a.players.get(La).score === E.ESCAPE_POINTS && a.order.filter((id) => id !== La).every((id) => a.players.get(id).score === 0));

  // b) Démasqué, il retrouve la vraie scène : +2 pour lui.
  const b = jeu(4, 32);
  jusqua(b, 'vote');
  const Lb = b.round.liar;
  voter(b, (id) => (id === Lb ? autre(b, Lb) : Lb));
  jusqua(b, 'guess');
  const tard = b.endsAt - 1;
  t('[6] un témoin ne choisit pas à sa place', E.guess(b, temoins(b)[0], b.roundId, 0, tard).reason === 'NOT_LIAR');
  t('[6] choix hors des 4 : refusé', E.guess(b, Lb, b.roundId, 4, tard).reason === 'BAD_OPTION');
  const rb = E.guess(b, Lb, b.roundId, b.round.options.vraie, tard);
  t('[6] il retrouve la vraie scène : révélation tout de suite', rb.ok && b.phase === 'reveal');
  t('[6] démasqué mais juste : +2 au Faux Témoin, 0 aux témoins',
    b.players.get(Lb).score === E.GUESS_POINTS && temoins(b).every((id) => b.players.get(id).score === 0));

  // c) Démasqué, il se trompe : +1 à chaque témoin qui a voté contre lui.
  const c = jeu(5, 33);
  jusqua(c, 'vote');
  const Lc = c.round.liar, [x1] = temoins(c);
  voter(c, (id) => (id === Lc ? x1 : id === x1 ? temoins(c)[1] : Lc));
  t('[6] (c) démasqué', c.round.verdict.caught);
  jusqua(c, 'guess');
  E.guess(c, Lc, c.roundId, (c.round.options.vraie + 1) % 4, c.endsAt - 1);
  t('[6] il se trompe : +1 aux témoins qui ont voté contre lui, 0 aux autres',
    c.players.get(Lc).score === 0 && c.players.get(x1).score === 0 && temoins(c).filter((id) => id !== x1).every((id) => c.players.get(id).score === E.CATCH_POINTS));
  t('[6] la révélation dit tout : scène, Faux Témoin, votes, versions, choix, points', (() => {
    const v = E.view(c, c.endsAt == null ? 0 : c.endsAt).reveal;
    return v && v.liar === Lc && v.scene === c.round.scene && v.votes.length === 5 && v.options.length === 4 && Number.isInteger(v.answer) && v.guess === (v.answer + 1) % 4
      && v.points.find((p) => p.id === x1).points === 0;
  })());

  // d) Démasqué, il ne choisit rien : comme une erreur.
  const d = jeu(3, 34);
  jusqua(d, 'vote');
  const Ld = d.round.liar;
  voter(d, (id) => (id === Ld ? autre(d, Ld) : Ld));
  jusqua(d, 'guess');
  E.tick(d, d.endsAt);
  t('[6] pas de choix à l échéance : +1 à chaque témoin qui l a désigné', d.phase === 'reveal' && temoins(d).every((id) => d.players.get(id).score === 1) && d.players.get(Ld).score === 0);
  t('[6] révélation : aucune minuterie, on attend l hôte', E.nextDeadline(d) == null);
  t('[6] « suivant » hors révélation refusé, puis accepté', E.next(jeu(3, 1), 0).reason === 'NOT_REVEAL' && E.next(d, 999999).ok && d.phase === 'role' && d.roundId === 2);
}

// ============================================ 7. rotation et classement
{
  for (const n of [3, 5]) {
    const g = jeu(n, 41, { rounds: n === 3 ? 3 : 5 });
    const vus = [];
    while (g.phase !== 'end') {
      vus.push(g.round.liar);
      jusqua(g, 'reveal');
      E.next(g, (g.endsAt || 0) + 1e6);
    }
    t(`[7] ${n} joueurs, ${n} manches : chacun Faux Témoin une fois`, new Set(vus).size === n && vus.length === n, vus.join(','));
    t(`[7] ${n} joueurs : fin complète, un classement`, g.complete === true && E.view(g).ranking.length === n);
  }
  const g = jeu(4, 42);
  g.players.get('p0').score = 5; g.players.get('p1').score = 5; g.players.get('p2').score = 2;
  const r = E.ranking(g);
  t('[7] rang de compétition : 5, 5, 2, 0 → 1, 1, 3, 4', r.map((x) => x.rank).join(',') === '1,1,3,4');
}

// ============================================================ 8. départs
{
  // Celui qui a la parole s'en va : on passe au suivant.
  const a = jeu(5, 51);
  jusqua(a, 'question');
  const q = a.round.questions[0];
  const parle = q.order[0];
  const quitteur = parle === a.round.liar ? q.order[1] : parle;   // jamais le Faux Témoin ici
  jusqua(a, 'question');
  while (E.view(a, a.endsAt - 1).question.speaker !== quitteur) E.tick(a, a.endsAt);
  const t0 = a.endsAt - 5000;
  E.leave(a, quitteur, t0);
  const v = E.view(a, t0);
  t('[8] celui qui parle s en va : la parole passe au suivant', a.phase === 'question' && v.question.speaker !== quitteur && a.endsAt === t0 + E.ANSWER_MS);
  let sautee = true;
  while (a.phase === 'question') { if (E.view(a, a.endsAt - 1).question.speaker === quitteur) sautee = false; E.tick(a, a.endsAt); }
  t('[8] il ne reprend jamais la parole (2e question comprise)', sautee && a.phase === 'debate');
  // Un parti ne bloque pas le débat ni le vote.
  const now = a.endsAt - 1;
  for (const id of a.order) if (id !== quitteur) E.ready(a, id, a.roundId, true, now);
  t('[8] tous les PRÉSENTS prêts : vote', a.phase === 'vote');
  t('[8] voter pour un parti : refusé', E.vote(a, a.round.liar, a.roundId, quitteur, now).reason === 'BAD_TARGET');

  // Un votant s'en va pendant le vote : son vote ne compte plus.
  const b = jeu(5, 52);
  jusqua(b, 'vote');
  const Lb = b.round.liar, [y1, y2, y3, y4] = temoins(b);
  const nb = b.endsAt - 1;
  E.vote(b, y1, b.roundId, Lb, nb); E.vote(b, y2, b.roundId, Lb, nb); E.vote(b, y3, b.roundId, y4, nb); E.vote(b, Lb, b.roundId, y4, nb);
  E.leave(b, y1, nb);
  E.vote(b, y4, b.roundId, y3, nb);
  t('[8] un votant parti : son vote ne compte plus (1 / 2 → y4 accusé)', b.phase === 'verdict' && b.round.verdict.accused === y4);

  // Le Faux Témoin s'en va : la manche s'arrête, sans points.
  const c = jeu(4, 53);
  jusqua(c, 'debate');
  const Lc = c.round.liar;
  E.leave(c, Lc, c.endsAt - 1);
  t('[8] le Faux Témoin s en va : révélation tout de suite, manche annulée', c.phase === 'reveal' && c.round.aborted === 'liar-left');
  t('[8] manche annulée : aucun point', [...c.players.values()].every((p) => p.score === 0));
  E.next(c, 1e7);
  t('[8] la manche suivante repart avec les présents', c.phase === 'role' && c.round.liar !== Lc);

  // Le Faux Témoin s'en va pendant la dernière chance.
  const d = jeu(4, 54);
  jusqua(d, 'vote');
  const Ld = d.round.liar;
  voter(d, (id) => (id === Ld ? autre(d, Ld) : Ld));
  jusqua(d, 'guess');
  E.leave(d, Ld, d.endsAt - 1);
  t('[8] parti pendant sa dernière chance : manche annulée, aucun point', d.phase === 'reveal' && d.round.aborted === 'liar-left' && [...d.players.values()].every((p) => p.score === 0));

  // Sous 3 présents : la partie s'arrête, incomplète.
  const e = jeu(3, 55);
  jusqua(e, 'debate');
  const ev = E.leave(e, temoins(e)[0], e.endsAt - 1);
  t('[8] 2 présents : fin incomplète', e.phase === 'end' && e.complete === false && ev.some((x) => x.type === 'end' && x.complete === false));
  t('[8] après la fin : plus aucune action', E.vote(e, 'p0', e.roundId, 'p1', 1e7).reason === 'NOT_IN_GAME');
}

// ============================================================ 9. les secrets
{
  const SECRETS = /"(scene|items|options|answer|votes|guess|points)":/;
  for (const n of [3, 5, 16]) {
    const g = jeu(n, 60 + n);
    const L = g.round.liar;
    const T = temoins(g)[0];
    let fuite = '';
    const relire = (etape) => {
      const v = JSON.stringify(E.view(g, (g.endsAt || 0) - 1));
      if (g.phase !== 'reveal' && SECRETS.test(v)) fuite += `${etape}:${g.phase} `;
      if (g.phase !== 'reveal' && g.phase !== 'guess' && v.includes('"liar":"')) fuite += `${etape}:${g.phase}:liar `;
    };
    relire('début');
    t(`[9] ${n} joueurs : roleView, même forme pour tous, chacun le sien`,
      JSON.stringify(Object.keys(E.roleView(g, L))) === JSON.stringify(Object.keys(E.roleView(g, T))) && E.roleView(g, L).role === 'liar' && E.roleView(g, T).role === 'witness');
    t(`[9] ${n} joueurs : pas de scène avant le flash`, E.sceneView(g, T) === null);
    E.tick(g, g.endsAt);
    t(`[9] ${n} joueurs : au flash, la scène au témoin, null au Faux Témoin (même forme)`,
      E.sceneView(g, T).scene === g.round.scene && E.sceneView(g, L).scene === null && JSON.stringify(Object.keys(E.sceneView(g, L))) === JSON.stringify(Object.keys(E.sceneView(g, T))));
    t(`[9] ${n} joueurs : le titre est public dès le rôle`, E.view(g, 0).title === g.round.scene.title);
    relire('flash');
    E.tick(g, g.endsAt);
    t(`[9] ${n} joueurs : après le flash, plus de scène pour personne`, E.sceneView(g, T) === null);
    while (g.phase !== 'vote') { relire('avant vote'); E.tick(g, g.endsAt); }
    voter(g, (id) => (id === L ? autre(g, L) : L));
    relire('verdict');
    t(`[9] ${n} joueurs : verdict = qui, égalité, démasqué ; pas les votes`, g.phase === 'verdict' && !('votes' in E.view(g, 0).verdict));
    E.tick(g, g.endsAt);
    t(`[9] ${n} joueurs : les 4 versions au seul Faux Témoin démasqué`, E.optionsView(g, L).options.length === 4 && E.optionsView(g, T) === null);
    relire('guess');
    E.tick(g, g.endsAt);
    t(`[9] ${n} joueurs : aucune scène, version ni vote dans view() avant la révélation`, fuite === '', fuite);
    t(`[9] ${n} joueurs : plus de versions après la dernière chance`, E.optionsView(g, L) === null);
  }
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
