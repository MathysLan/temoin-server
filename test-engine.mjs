// Tests du moteur pur (engine.js) : aucun réseau, horloge et hasard injectés.
//
//   node test-engine.mjs
//
// 1. le tapissage (garanties sur 5 000 tirages) ; 2. les fragments et les
// rôles ; 3. les phases et leurs échéances ; 4. le barème ; 5. le mode à 2
// (l'indic) ; 6. les départs ; 7. LES SECRETS : ce que view() et roleView()
// ne doivent jamais rendre avant les résultats.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./engine.js');

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
const D = E;    // durées par défaut
const jeu = (n, seed = 1, cases = 3) => E.createGame({ players: ids(n), now: 0, random: graine(seed), cases });
const temoins = (g) => [...g.kase.witnesses];
const menteurs = (g) => [...g.kase.liars];
const suspectDe = (g, i) => g.kase.suspects[i];
const autreSuspect = (g) => (g.kase.culprit + 1) % g.kase.suspects.length;
const vrai = (g, attr) => ({ attr, value: suspectDe(g, g.kase.culprit)[E.ATTR_IDS.indexOf(attr)] });
const faux = (g, attr) => {
  const i = E.ATTR_IDS.indexOf(attr);
  return { attr, value: E.ATTRS[i].values.find((v) => v !== suspectDe(g, g.kase.culprit)[i]) };
};
// Amène l'affaire en cours jusqu'à `phase` à coups d'échéances.
const jusqua = (g, phase) => {
  for (let garde = 0; garde < 20 && g.phase !== phase; garde++) E.tick(g, g.endsAt);
  return g.phase === phase;
};

// ====================================================== 1. le tapissage
{
  let echecs = 0, essais = 0;
  const positions = new Map();
  for (let s = 1; s <= 5000; s++) {
    const r = graine(s);
    const taille = [12, 16, 20][s % 3];
    const nbVus = 2 + (s % 4);                       // 2 à 5 attributs vus
    const vus = E.shuffle([0, 1, 2, 3, 4], r).slice(0, nbVus);
    const tp = E.genererTapissage(r, taille, vus);
    essais++;
    if (tp.suspects.length !== taille || !E.tapissageValide(tp.suspects, tp.coupable, vus)) echecs++;
    if (taille === 12) positions.set(tp.coupable, (positions.get(tp.coupable) || 0) + 1);
  }
  t(`[1] ${essais} tapissages : tous valides (distincts, coupable isolé par les attributs vus, aucun attribut seul suffisant, un leurre par attribut vu)`, echecs === 0, `${echecs} échecs`);
  const min = Math.min(...[...Array(12).keys()].map((i) => positions.get(i) || 0));
  t('[1] le coupable n est pas à une place fixe (chacune des 12 places sort au moins 80 fois sur ~1 667)', positions.size === 12 && min >= 80, `min ${min}`);

  // Une validation qui ne valide rien ne prouverait rien : contre-épreuves.
  const r = graine(42);
  const vus = [0, 1, 2];
  const tp = E.genererTapissage(r, 12, vus);
  const c = tp.suspects[tp.coupable];
  const doublon = tp.suspects.slice(); doublon[(tp.coupable + 1) % 12] = c.slice();
  t('[1] contre-épreuve : un suspect en double est refusé', !E.tapissageValide(doublon, tp.coupable, vus));
  const jumeau = tp.suspects.slice();
  const j = (tp.coupable + 1) % 12; jumeau[j] = c.slice(); jumeau[j][4] = E.ATTRS[4].values.find((v) => v !== c[4]);
  t('[1] contre-épreuve : un second suspect identique sur les attributs vus est refusé', !E.tapissageValide(jumeau, tp.coupable, vus));
  t('[1] contre-épreuve : avec un seul attribut vu, on refuse (il ne peut pas isoler ET être partagé)', (() => {
    try { E.genererTapissage(graine(3), 12, [0]); return false; } catch (_) { return true; }
  })());
}

// ================================================= 2. fragments et rôles
{
  const r = graine(7);
  const f2 = E.distribuerFragments(['a', 'b'], r);
  t('[2] 2 témoins : 2 attributs chacun, 4 attributs vus, aucun en double chez un même témoin',
    f2.vus.length === 4 && [...f2.fragments.values()].every((x) => x.length === 2 && x[0] !== x[1]));
  const f3 = E.distribuerFragments(['a', 'b', 'c'], r);
  t('[2] 3 témoins : 2 attributs chacun, les 5 attributs vus', f3.vus.length === 5 && [...f3.fragments.values()].every((x) => x.length === 2));
  const f13 = E.distribuerFragments(ids(13), r);
  const parAttr = new Map();
  for (const x of f13.fragments.values()) for (const i of x) parAttr.set(i, (parAttr.get(i) || 0) + 1);
  t('[2] 13 témoins : 1 attribut chacun, chaque attribut vu par 2 ou 3 témoins (un mensonge est contredit)',
    [...f13.fragments.values()].every((x) => x.length === 1) && parAttr.size === 5 && [...parAttr.values()].every((v) => v >= 2 && v <= 3));

  t('[2] Faux Témoins : 0 à 2, 0 ou 1 de 3 à 5, 1 de 6 à 9, 2 de 10 à 14, 3 à 15 et 16',
    E.liarsFor(2, () => 0) === 0 && E.liarsFor(3, () => 0) === 1 && E.liarsFor(5, () => 0.9) === 0
    && E.liarsFor(6, () => 0.9) === 1 && E.liarsFor(9, Math.random) === 1 && E.liarsFor(10, Math.random) === 2
    && E.liarsFor(14, Math.random) === 2 && E.liarsFor(16, Math.random) === 3);
  // 3 à 5 joueurs : un Faux Témoin dans ~75 % des affaires.
  let avec = 0;
  for (let s = 1; s <= 400; s++) if (jeu(4, s).kase.liars.size === 1) avec++;
  t(`[2] à 4 joueurs : un Faux Témoin dans ~75 % des affaires (${avec}/400)`, avec > 260 && avec < 340);

  // Répartition à ±1 près sur une partie de 7 affaires à 6 joueurs.
  const g = jeu(6, 11, 7);
  for (let k = 0; k < 7; k++) { jusqua(g, 'results'); if (k < 6) E.tick(g, g.endsAt); }
  const fois = [...g.players.values()].map((p) => p.liarTimes);
  t(`[2] 6 joueurs, 7 affaires : chacun Faux Témoin 1 ou 2 fois (${fois.join(',')})`, Math.max(...fois) - Math.min(...fois) <= 1 && fois.reduce((a, b) => a + b, 0) === 7);

  const g2 = jeu(8, 5);
  const vues = g2.order.map((id) => E.roleView(g2, id));
  t('[2] roleView : MÊMES clés pour tous (le rôle ne se lit pas à la forme)', vues.every((v) => JSON.stringify(Object.keys(v)) === JSON.stringify(Object.keys(vues[0]))));
  const m = vues.find((v) => v.role === 'liar');
  t('[2] Faux Témoin : le coupable entier (5 paires) et son index', !!m && m.fragment.length === 5 && m.culprit === g2.kase.culprit
    && m.fragment.every((f, i) => f.value === suspectDe(g2, g2.kase.culprit)[i]));
  t('[2] témoin : son fragment, juste, et `culprit: null`', vues.filter((v) => v.role === 'witness').every((v) => v.culprit === null && v.fragment.length >= 1
    && v.fragment.every((f) => vrai(g2, f.attr).value === f.value)));
  t('[2] taille du tapissage : 12 (≤ 5 joueurs), 16 (≤ 10), 20 (au-delà)', jeu(5).kase.suspects.length === 12 && jeu(10).kase.suspects.length === 16 && jeu(16).kase.suspects.length === 20);
}

// ========================================= 3. phases, échéances, refus
{
  const g = jeu(4, 3);
  t('[3] lancement : affaire 1/3, flash, 3 s', g.caseId === 1 && g.cases === 3 && g.phase === 'flash' && g.endsAt === D.FLASH_MS);
  t('[3] événements de départ : `case` seul (le flash est annoncé par lui)', g.startEvents.length === 1 && g.startEvents[0].type === 'case');
  t('[3] déclarer pendant le flash : refusé', E.declare(g, 'p0', 1, null, 100).reason === 'NOT_DECLARING');
  t('[3] verrouiller avant la révélation 1 : refusé', E.lock(g, 'p0', 1, 0, null, 100).reason === 'NOT_LOCKING');
  let ev = E.tick(g, D.FLASH_MS);
  t('[3] échéance du flash → declare1 (15 s), à SON échéance', g.phase === 'declare1' && g.endsAt === D.FLASH_MS + D.DECLARE_MS && ev.some((e) => e.type === 'phase' && e.phase === 'declare1'));
  t('[3] déclaration hors vocabulaire : refusée', E.declare(g, 'p0', 1, { attr: 'chapeau', value: 'sombrero' }, 4000).reason === 'BAD_DECLARATION'
    && E.declare(g, 'p0', 1, { attr: 'nez', value: 'rouge' }, 4000).reason === 'BAD_DECLARATION'
    && E.declare(g, 'p0', 1, 'chapeau', 4000).reason === 'BAD_DECLARATION');
  t('[3] mauvaise affaire : refusée', E.declare(g, 'p0', 2, null, 4000).reason === 'STALE_CASE');
  t('[3] inconnu : refusé', E.declare(g, 'zz', 1, null, 4000).reason === 'NOT_IN_GAME');
  const r1 = E.declare(g, 'p0', 1, { attr: 'manteau', value: 'rouge' }, 4000);
  t('[3] déclaration valide : `declared` (qui, jamais quoi)', r1.ok && r1.events.some((e) => e.type === 'declared' && e.id === 'p0' && !('attr' in e)));
  t('[3] deux déclarations au même tour : refusé', E.declare(g, 'p0', 1, null, 4100).reason === 'ALREADY_DECLARED');
  E.declare(g, 'p1', 1, null, 5000);
  E.declare(g, 'p2', 1, null, 5000);
  ev = E.declare(g, 'p3', 1, null, 6000).events;
  t('[3] tous ont déclaré → declare2 tout de suite (à 6 000, pas à l échéance)', g.phase === 'declare2' && g.endsAt === 6000 + D.DECLARE_MS);
  t('[3] révélation 1 : le tour 1 est public, avec son décompte', (() => {
    const v = E.view(g, 6000);
    return v.rounds.length === 1 && v.rounds[0].declarations.length === 4 && v.rounds[0].summary.manteau.rouge === 1
      && v.rounds[0].declarations.filter((d) => d.pass).length === 3;
  })());
  const l = E.lock(g, 'p0', 1, 3, null, 7000);
  t('[3] verrou en declare2 : accepté, `locked` sans le suspect', l.ok && l.events.some((e) => e.type === 'locked' && !('suspect' in e)) && E.view(g, 7000).locked === 1);
  t('[3] verrou deux fois : refusé', E.lock(g, 'p0', 1, 4, null, 7100).reason === 'ALREADY_LOCKED');
  t('[3] suspect hors tapissage : refusé', E.lock(g, 'p1', 1, 12, null, 7100).reason === 'BAD_SUSPECT' && E.lock(g, 'p1', 1, '3', null, 7100).reason === 'BAD_SUSPECT');
  t('[3] s accuser soi-même, ou l indic, ou un inconnu : refusé', E.lock(g, 'p1', 1, 3, 'p1', 7100).reason === 'BAD_ACCUSE'
    && E.lock(g, 'p1', 1, 3, 'indic', 7100).reason === 'BAD_ACCUSE' && E.lock(g, 'p1', 1, 3, 'zz', 7100).reason === 'BAD_ACCUSE');
  g.order.forEach((id) => E.declare(g, id, 1, null, 7200));
  t('[3] tous ont déclaré au tour 2 : declare2 continue jusqu à son échéance (temps de lecture, verrou à 5)', g.phase === 'declare2');
  E.tick(g, g.endsAt);
  t('[3] échéance de declare2 → deliberate (12 s), révélation 2', g.phase === 'deliberate' && E.view(g).rounds.length === 2);
  E.tick(g, g.endsAt);
  t('[3] → lastcall (8 s)', g.phase === 'lastcall' && g.endsAt - (6000 + D.DECLARE_MS + D.DELIBERATE_MS) === D.LASTCALL_MS);
  E.tick(g, g.endsAt);
  t('[3] → results (9 s), avec l audit', g.phase === 'results' && E.view(g).audit && E.view(g).audit.culprit === g.kase.culprit);
  ev = E.tick(g, g.endsAt);
  t('[3] → affaire 2, flash', g.caseId === 2 && g.phase === 'flash' && ev.some((e) => e.type === 'case' && e.caseId === 2));
  const enRetard = E.tick(g, g.endsAt + D.DECLARE_MS + D.DECLARE_MS + 10);
  t('[3] minuterie en retard : tick rattrape plusieurs phases, dans l ordre', g.phase === 'deliberate'
    && enRetard.filter((e) => e.type === 'phase').map((e) => e.phase).join() === 'declare1,declare2,deliberate');
  // Tous verrouillés → résultats directs.
  g.order.forEach((id) => E.lock(g, id, 2, 0, null, g.endsAt - 1));
  t('[3] tous ont verrouillé → résultats tout de suite', g.phase === 'results');
  E.next(g, g.endsAt - 100);
  t('[3] `next` (hôte) : affaire suivante sans attendre', g.caseId === 3 && g.phase === 'flash');
  jusqua(g, 'results');
  const fin = E.tick(g, g.endsAt);
  t('[3] après la dernière affaire : `end`, complète, classement', g.phase === 'end' && fin.some((e) => e.type === 'end' && e.complete === true) && E.view(g).ranking.length === 4);
  t('[3] fin : nextDeadline null, plus aucune action', E.nextDeadline(g) === null && !E.declare(g, 'p0', 3, null, 1e9).ok);
}

// ===================================================== 4. le barème
{
  // 6 joueurs : 1 Faux Témoin, 5 témoins.
  const g = jeu(6, 21);
  const M = menteurs(g)[0];
  const [a, b, c, d, e] = temoins(g);
  jusqua(g, 'declare1');
  E.declare(g, a, 1, vrai(g, 'manteau'), g.endsAt - 1);
  E.declare(g, b, 1, faux(g, 'manteau'), g.endsAt - 1);       // b se trompe (ou ment)
  E.declare(g, M, 1, faux(g, 'chapeau'), g.endsAt - 1);
  jusqua(g, 'declare2');
  E.lock(g, a, 1, g.kase.culprit, M, g.endsAt - 1);           // 5 + 2
  E.lock(g, b, 1, g.kase.culprit, M, g.endsAt - 1);           // déclaration fausse → 0
  E.lock(g, M, 1, autreSuspect(g), a, g.endsAt - 1);          // le menteur verrouille aussi : sans effet
  jusqua(g, 'deliberate');
  E.lock(g, c, 1, g.kase.culprit, null, g.endsAt - 1);        // 3
  jusqua(g, 'lastcall');
  E.lock(g, d, 1, autreSuspect(g), M, g.endsAt - 1);          // mauvais verrou, accusation juste → 2
  jusqua(g, 'results');                                        // e : rien
  const pts = Object.fromEntries(E.view(g).audit.points.map((x) => [x.id, x.points]));
  t('[4] bon verrou en declare2 + accusation juste : 7', pts[a] === 7, pts[a]);
  t('[4] une déclaration fausse : affaire à 0, même avec un bon verrou et une bonne accusation', pts[b] === 0, pts[b]);
  t('[4] bon verrou en deliberate : 3', pts[c] === 3, pts[c]);
  t('[4] mauvais verrou, accusation juste : 2', pts[d] === 2, pts[d]);
  t('[4] pas de verrou : 0', pts[e] === 0, pts[e]);
  // Menteur : trompés = b ? non — b a le bon suspect ; trompés = d, e → 2/5 → round(2) = 2 ; désigné par a, b, d = 3/5 ≥ 1/3 → pas de bonus.
  t('[4] Faux Témoin : round(5 × 2/5) = 2, pas de bonus (désigné par 3 sur 5)', pts[M] === 2, pts[M]);
  const au = E.view(g).audit;
  t('[4] audit : chaque déclaration avec sa vérité', au.declarations.find((x) => x.id === a && x.round === 1).truth === true
    && au.declarations.find((x) => x.id === b && x.round === 1).truth === false && au.declarations.find((x) => x.id === M).truth === false);
  t('[4] audit : verrous (phase, juste ou non), Faux Témoins, fragments', au.locks.find((x) => x.id === a).phase === 'declare2' && au.locks.find((x) => x.id === d).correct === false
    && au.liars.join() === M && au.fragments.length === 5);
  t('[4] le score total suit', g.players.get(a).score === 7 && g.players.get(M).score === 2);
}
{
  // Plafond : tout le monde trompé, personne ne l'accuse → 5 + 2 = 7, pas plus.
  const g = jeu(6, 22);
  const M = menteurs(g)[0];
  jusqua(g, 'lastcall');
  temoins(g).forEach((w) => E.lock(g, w, 1, autreSuspect(g), null, g.endsAt - 1));
  jusqua(g, 'results');
  const p = E.view(g).audit.points.find((x) => x.id === M).points;
  t('[4] Faux Témoin parfait : 7 (= le maximum d un témoin parfait)', p === E.LIAR_CAP && p === 7, p);
}
{
  // Personne trompé, mais personne ne l'accuse : 0 + 2.
  const g = jeu(7, 23);
  const M = menteurs(g)[0];
  jusqua(g, 'declare2');
  temoins(g).forEach((w) => E.lock(g, w, 1, g.kase.culprit, null, g.endsAt - 1));
  E.lock(g, M, 1, 0, null, g.endsAt - 1);
  const p = E.view(g).audit.points.find((x) => x.id === M).points;
  t('[4] Faux Témoin démasqué par la logique mais jamais accusé : 2', p === 2, p);
}
{
  // 16 joueurs, 3 Faux Témoins : chacun noté pour lui (accusations par personne).
  const g = jeu(16, 24);
  const [M1, M2, M3] = menteurs(g);
  t('[4] 16 joueurs : 3 Faux Témoins, 13 témoins', menteurs(g).length === 3 && temoins(g).length === 13);
  jusqua(g, 'declare2');
  temoins(g).forEach((w, i) => E.lock(g, w, 1, g.kase.culprit, i < 5 ? M1 : null, g.endsAt - 1));
  [M1, M2, M3].forEach((m) => E.lock(g, m, 1, 0, null, g.endsAt - 1));
  const pts = Object.fromEntries(E.view(g).audit.points.map((x) => [x.id, x.points]));
  t('[4] accusé par 5/13 (≥ 1/3) : 0 ; jamais accusés : 2', pts[M1] === 0 && pts[M2] === 2 && pts[M3] === 2, JSON.stringify([pts[M1], pts[M2], pts[M3]]));
  t('[4] les accusateurs de M1 : 5 + 2', temoins(g).slice(0, 5).every((w) => pts[w] === 7) && pts[temoins(g)[5]] === 5);
}
{
  // Le classement : rang de compétition.
  const g = jeu(4, 25);
  const sc = [13, 13, 5, 0];
  g.order.forEach((id, i) => { g.players.get(id).score = sc[i]; });
  t('[4] rang de compétition : 13, 13, 5, 0 → 1, 1, 3, 4', E.ranking(g).map((r) => r.rank).join() === '1,1,3,4');
}

// ================================================ 5. mode à 2 : l'indic
{
  let unSeulFaux = 0, total = 0;
  for (let s = 1; s <= 300; s++) {
    const g = jeu(2, s);
    if (g.kase.liars.size !== 0) continue;
    jusqua(g, 'deliberate');
    const v = E.view(g);
    const ind = v.rounds.map((r) => r.declarations.find((d) => d.id === E.INDIC));
    total++;
    const verites = ind.map((d) => vrai(g, d.attr).value === d.value);
    if (ind.every(Boolean) && verites.filter((x) => !x).length === 1) unSeulFaux++;
  }
  t(`[5] à 2 : aucun Faux Témoin, l indic déclare à chaque révélation, UNE fois sur deux faux (${unSeulFaux}/${total})`, total === 300 && unSeulFaux === 300);
  const g = jeu(2, 9);
  const v = E.view(g);
  t('[5] à 2 : `indic: true`, `liars: 0–0`, 2 fragments chacun, 12 suspects', v.indic === true && v.liars.max === 0
    && g.order.every((id) => E.roleView(g, id).fragment.length === 2) && v.lineup.length === 12);
  jusqua(g, 'declare1');
  E.declare(g, 'p0', 1, null, g.endsAt - 1);
  E.declare(g, 'p1', 1, null, g.endsAt - 1);
  t('[5] à 2 : l indic ne bloque pas la fin anticipée, et n apparaît pas dans `declared`', g.phase === 'declare2' && !E.view(g).declared.includes(E.INDIC));
  t('[5] l indic n est pas dans la vue avant sa révélation', (() => {
    const g3 = jeu(2, 10);
    jusqua(g3, 'declare1');
    return !JSON.stringify(E.view(g3)).includes(`"id":"${E.INDIC}"`);
  })());
}

// ===================================================== 6. les départs
{
  const g = jeu(3, 31);
  jusqua(g, 'declare1');
  E.declare(g, 'p0', 1, null, g.endsAt - 1);
  E.declare(g, 'p1', 1, null, g.endsAt - 1);
  const ev = E.leave(g, 'p2', g.endsAt - 1);
  t('[6] un départ : `left`, et les présents ont tous déclaré → phase suivante', ev.some((e) => e.type === 'left' && e.id === 'p2') && g.phase === 'declare2');
  t('[6] l absent ne déclare plus', E.declare(g, 'p2', 1, null, g.endsAt - 1).reason === 'NOT_IN_GAME');
  const ev2 = E.leave(g, 'p1', g.endsAt - 1);
  t('[6] moins de 2 présents : fin INCOMPLÈTE', g.phase === 'end' && ev2.some((e) => e.type === 'end' && e.complete === false));
  t('[6] partir deux fois : rien', E.leave(g, 'p1', g.endsAt).length === 0);
}
{
  // Un témoin parti APRÈS son verrou compte encore ; parti sans verrou, il ne
  // compte plus dans la part des trompés.
  const g = jeu(6, 32);
  const M = menteurs(g)[0];
  const [a, b, c, d, e] = temoins(g);
  jusqua(g, 'declare2');
  E.lock(g, a, 1, g.kase.culprit, null, g.endsAt - 1);
  E.leave(g, a, g.endsAt - 1);
  E.leave(g, b, g.endsAt - 1);
  [c, d, e].forEach((w) => E.lock(g, w, 1, autreSuspect(g), M, g.endsAt - 1));
  E.lock(g, M, 1, 0, null, g.endsAt - 1);
  t('[6] tous les PRÉSENTS ont verrouillé → résultats', g.phase === 'results');
  const pts = Object.fromEntries(E.view(g).audit.points.map((x) => [x.id, x.points]));
  t('[6] parti après son verrou : ses points comptent (5)', pts[a] === 5, pts[a]);
  t('[6] parti sans verrou : hors barème', !(b in pts));
  t('[6] Faux Témoin : 3 trompés sur 4 → round(3,75) = 4, accusé par 3/4 → pas de bonus', pts[M] === 4, pts[M]);
  // La partie continue à 4 présents ; l'affaire suivante tire ses rôles parmi eux.
  E.tick(g, g.endsAt);
  t('[6] affaire suivante : les partis n ont ni rôle ni fragment', !g.kase.witnesses.has(a) && !g.kase.liars.has(a) && !g.kase.witnesses.has(b));
}

// ===================================================== 7. les secrets
{
  for (const n of [2, 3, 6, 16]) {
    const g = jeu(n, 40 + n);
    const fuites = [];
    const verifier = (quand) => {
      const v = E.view(g, 0);
      const j = JSON.stringify(v);
      if (v.audit) fuites.push(`${quand} : audit`);
      if (/culprit|liar(?!s":\{)|fragment|truth|suspect"|accuse|endsAt|witness/i.test(j)) fuites.push(`${quand} : ${j.match(/culprit|liar(?!s":\{)|fragment|truth|suspect"|accuse|endsAt|witness/i)[0]}`);
      if (g.kase.indic && g.phase === 'declare1' && j.includes(`"id":"${E.INDIC}"`)) fuites.push(`${quand} : indic`);
    };
    for (const ph of ['flash', 'declare1', 'declare2', 'deliberate', 'lastcall']) {
      jusqua(g, ph);
      if (ph === 'declare1') g.order.slice(0, 1).forEach((id) => E.declare(g, id, 1, vrai(g, 'manteau'), g.endsAt - 1));
      if (ph === 'declare2') g.order.slice(0, 1).forEach((id) => E.lock(g, id, 1, 2, null, g.endsAt - 1));
      verifier(ph);
    }
    t(`[7] ${n} joueurs : view() ne rend ni coupable, ni rôles, ni fragments, ni verrous avant les résultats`, fuites.length === 0, fuites.join(' ; '));
    const v = E.view(g, 0);
    t(`[7] ${n} joueurs : la déclaration du tour EN COURS ne sort pas (seulement qui a déclaré)`, (() => {
      const g2 = jeu(n, 50 + n);
      jusqua(g2, 'declare2');
      E.declare(g2, 'p0', 1, vrai(g2, 'objet'), g2.endsAt - 1);
      const w = E.view(g2, 0);
      return w.declared.includes('p0') && w.rounds.length === 1 && !w.rounds.some((r) => r.round === 2);
    })());
    void v;
  }
  const g = jeu(5, 60);
  jusqua(g, 'results');
  t('[7] aux résultats : tout est public (coupable, Faux Témoins, verrous)', E.view(g).audit.culprit === g.kase.culprit && Array.isArray(E.view(g).audit.liars));
  const gEnd = jeu(2, 61, 3);
  for (let k = 0; k < 3; k++) { jusqua(gEnd, 'results'); E.tick(gEnd, gEnd.endsAt); }
  t('[7] à la fin : roleView ne rend plus rien', gEnd.phase === 'end' && E.roleView(gEnd, 'p0') === null);
}

// ====================================================== 8. création
{
  const jette = (o) => { try { E.createGame(o); return false; } catch (_) { return true; } };
  t('[8] createGame refuse : 1 joueur, 17 joueurs, doublon, id « indic », sans hasard, sans horloge',
    jette({ players: ['a'], now: 0, random: Math.random }) && jette({ players: ids(17), now: 0, random: Math.random })
    && jette({ players: ['a', 'a'], now: 0, random: Math.random }) && jette({ players: ['a', 'indic'], now: 0, random: Math.random })
    && jette({ players: ['a', 'b'], now: 0 }) && jette({ players: ['a', 'b'], random: Math.random }));
  t('[8] nombre d affaires : 3, 5 ou 7 ; sinon 5', jeu(3, 1, 7).cases === 7 && jeu(3, 1, 4).cases === 5
    && E.createGame({ players: ids(3), now: 0, random: Math.random }).cases === 5);
}

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
