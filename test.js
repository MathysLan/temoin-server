// Test bout en bout du serveur : de vrais clients WebSocket, un vrai serveur
// (dans ce processus), de vraies minuteries — raccourcies.
//
//   node test.js
//
// 0. santé ; 1. salon, hôte, réglages (manches, flash 5/8/10 s), refus ;
// 2. une partie à TROIS pilotée à la main : rôle, scène (aux témoins
// seulement), tours de parole, débat, vote, verdict, dernière chance,
// révélation, points, puis la fin ; 3. revanche, snapshot et salon ; 4. une
// partie à CINQ jouée par des robots, 5 manches, points recalculés à part ;
// 5. les départs (Faux Témoin, sous 3 joueurs, onglet figé) ; 6. LE FIL :
// tout ce que chaque client a reçu, relu champ par champ contre la vérité
// relevée côté serveur.
process.env.PORT = process.env.PORT || '8796';
process.env.TEST_ROLE_MS = '80';
process.env.TEST_FLASH_MS = '150';
process.env.TEST_ASK_MS = '0';
process.env.TEST_ANSWER_MS = '400';
process.env.TEST_DEBATE_MS = '600';
process.env.TEST_VOTE_MS = '600';
process.env.TEST_VERDICT_MS = '80';
process.env.TEST_GUESS_MS = '600';
process.env.PRESENCE_MS = '150';
process.env.ABSENCE_MS = '700';
process.env.PRESENCE_KILL_MS = '300';
process.env.PRESENCE_QUIET = '1';
const http = require('node:http');
const { rooms } = require('./server.js');
const E = require('./engine.js');
const O = require('./test-outils.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const t = O.compteur();
const tous = [];

// LA VÉRITÉ, relevée CÔTÉ SERVEUR : par room, une entrée par partie (la
// revanche repart à la manche 1), et dans chacune, par manche : le Faux
// Témoin, la scène, les 4 versions s'il y en a eu.
const verites = new Map();      // code → [Map(roundId → { liar, scene, options })]
function relever(code) {
  const r = rooms.get(code);
  if (!r || !r.game || !r.game.round) return;
  const g = r.game;
  const parties = verites.get(code) || verites.set(code, []).get(code);
  let p = parties.find((x) => x.game === g);
  if (!p) { p = { game: g, manches: new Map() }; parties.push(p); }
  const k = g.round;
  const x = p.manches.get(k.id) || { liar: k.liar, scene: k.scene, options: null };
  if (k.options) x.options = k.options.versions;
  p.manches.set(k.id, x);
}
const verite = (code) => (roundId, id, partie) => {
  const p = (verites.get(code) || [])[partie - 1];
  return p ? p.manches.get(roundId) || null : null;
};

function nouveau(nom) {
  const c = O.client(URL, nom);
  tous.push(c);
  c.on(() => { if (c.code) relever(c.code); });
  return c;
}

async function table(n, prefixe, robots) {
  const cs = [];
  const mk = (i) => (robots ? O.robot(nouveau(prefixe + i), robots(i)) : nouveau(prefixe + i));
  const h = mk(0);
  const you = await O.joindre(h, prefixe + '0');
  cs.push(h);
  for (let i = 1; i < n; i++) {
    const c = mk(i);
    await O.joindre(c, prefixe + i, you.code);
    cs.push(c);
  }
  await O.attendre(() => h.dernier('lobby') && h.dernier('lobby').players.length === n);
  return { cs, h, code: you.code };
}
const fermer = (cs) => cs.forEach((c) => { try { c.ws.terminate(); } catch (_) {} });
const get = (path) => new Promise((res) => http.get(`http://127.0.0.1:${process.env.PORT}${path}`, (r) => {
  let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b }));
}).on('error', () => res({ status: 0, body: '' })));
const phase = (c, nom, ms = 4000, roundId) => c.wait((m) => m.type === 'phase' && m.phase === nom && (roundId == null || m.roundId === roundId), ms);

(async () => {
  // ============================================================ 0. santé
  const h = await get('/');
  t('[0] GET / → 200 « temoin-server ok »', h.status === 200 && /temoin-server ok/.test(h.body));

  // =================================================== 1. salon et réglages
  const A = nouveau('A');
  const youA = await O.joindre(A, 'Alice');
  t('[1] créer : code à 4 lettres, le créateur est l hôte', /^[A-Z]{4}$/.test(youA.code) && youA.host === true);
  const B = nouveau('B');
  const youB = await O.joindre(B, 'Bruno', youA.code.toLowerCase());
  t('[1] rejoindre (code en minuscules accepté) : pas hôte', youB.code === youA.code && youB.host === false);
  const l2 = await A.wait((m) => m.type === 'lobby' && m.players.length === 2);
  t('[1] salon : min 3, max 16, 3 manches et flash de 8 s par défaut', !!l2 && l2.min === 3 && l2.max === 16 && l2.rounds === 3 && l2.flashMs === 8000);
  A.send({ action: 'start' });
  t('[1] à deux : il faut 3 joueurs', /au moins 3/.test((await A.suite((m) => m.type === 'error')).message));
  const C = nouveau('C');
  await O.joindre(C, 'Chloé', youA.code);
  await A.wait((m) => m.type === 'lobby' && m.players.length === 3);

  const X = nouveau('X');
  await X.open;
  X.send({ action: 'vote', roundId: 1, target: 'x' });
  t('[1] action avant join : refusée', /pas encore dans une partie/.test((await X.wait((m) => m.type === 'error')).message));
  X.send({ action: 'join', name: 'X', code: 'ZZZZ' });
  t('[1] code inconnu : refusé', /aucune partie/.test((await X.wait((m) => m.type === 'error')).message));
  X.ws.send('pas du json');
  t('[1] message illisible : refusé', /illisible/.test((await X.wait((m) => m.type === 'error')).message));
  X.send({ action: 'resume', code: youA.code });
  t('[1] resume : refusé en V1', /reprise non disponible/.test((await X.wait((m) => m.type === 'error')).message));
  B.send({ action: 'danse' });
  t('[1] action inconnue : refusée', /action inconnue/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'start' });
  t('[1] un invité ne lance pas', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'settings', flashMs: 5000 });
  t('[1] un invité ne règle pas', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  A.send({ action: 'settings', rounds: 4 });
  t('[1] manches hors 3/5/7 : refusé', /3, 5, 7/.test((await A.suite((m) => m.type === 'error')).message));
  A.send({ action: 'settings', flashMs: 6000 });
  t('[1] flash hors 5/8/10 s : refusé', /5, 8, 10 s/.test((await A.suite((m) => m.type === 'error')).message));
  A.send({ action: 'settings', flashMs: 5000 });
  t('[1] l hôte règle le flash à 5 s : le salon le dit à tous', !!(await C.suite((m) => m.type === 'lobby' && m.flashMs === 5000)));
  A.send({ action: 'settings', flashMs: 10000, rounds: 3 });
  t('[1] puis à 10 s', !!(await C.suite((m) => m.type === 'lobby' && m.flashMs === 10000 && m.rounds === 3)));
  {
    const S = nouveau('S');
    await O.joindre(S, 'Solo');
    const N = nouveau('N');
    await O.joindre(N, '‮abc\u0007 ' + 'x'.repeat(30), S.code);
    const l = await S.wait((m) => m.type === 'lobby' && m.players.length === 2);
    t('[1] pseudo nettoyé (contrôles, sens d écriture) et coupé à 16', l.players[1].name === 'abc ' + 'x'.repeat(12));
    N.ws.close();
    t('[1] départ au salon : le salon est rediffusé', !!(await S.wait((m) => m.type === 'lobby' && m.players.length === 1)));
    S.ws.close();
    await O.attendre(() => !rooms.has(S.code));
    t('[1] dernier départ : la room est supprimée', !rooms.has(S.code));
  }

  // ======================================= 2. partie à trois, pas à pas
  const code = youA.code;
  const room = rooms.get(code);
  const cs = [A, B, C];
  const iDep = cs.map((c) => c.msgs.length);
  A.send({ action: 'start' });
  const games = await Promise.all(cs.map((c, i) => c.wait((m) => m.type === 'game', 3000, iDep[i])));
  t('[2] lancement : un `game` chacun (soi, hôte, 3 manches, flash 10 s, identités)', games.every((g, i) => g && g.you === cs[i].id && g.host === A.id
    && g.rounds === 3 && g.flashMs === 10000 && g.identities.length === 3 && g.identities.every((x) => x.name && x.avatar)));
  const g = room.game;
  t('[2] le flash réglé au salon est celui de la partie (moteur : 10 s)', g.flashMs === 10000);
  const r1 = await Promise.all(cs.map((c, i) => c.wait((m) => m.type === 'role', 3000, iDep[i])));
  const rd = await B.wait((m) => m.type === 'round', 3000, iDep[1]);
  t('[2] `round` 1/3 : le titre de la scène, public', !!rd && rd.roundId === 1 && rd.rounds === 3 && rd.title === g.round.scene.title);
  t('[2] `role` à chacun : un seul Faux Témoin, celui du serveur', r1.filter((r) => r.role === 'liar').length === 1
    && r1.every((r, i) => r.role === (g.round.liar === cs[i].id ? 'liar' : 'witness')));
  t('[2] `role` : même forme pour tous (roundId, role)', r1.every((r) => Object.keys(r).join() === 'type,roundId,role'));
  const L = cs.find((c) => c.id === g.round.liar);
  const W = cs.filter((c) => c !== L);

  const sc = await Promise.all(cs.map((c, i) => c.wait((m) => m.type === 'scene', 3000, iDep[i])));
  t('[2] au flash : la scène à chaque témoin, celle du serveur', W.every((w) => JSON.stringify(sc[cs.indexOf(w)].scene) === JSON.stringify(g.round.scene)));
  t('[2] au flash : `scene: null` au Faux Témoin (même message, même forme)', sc[cs.indexOf(L)].scene === null && Object.keys(sc[cs.indexOf(L)]).join() === 'type,roundId,scene');
  t('[2] un seul `scene` par joueur et par manche', cs.every((c) => c.tous((m) => m.type === 'scene' && m.roundId === 1).length === 1));
  const fl = await A.wait((m) => m.type === 'phase' && m.phase === 'flash', 3000, iDep[0]);
  t('[2] la phase flash ne porte que le titre (rien de la scène)', !!fl && fl.title === g.round.scene.title && !JSON.stringify(fl).includes('"items"'));

  // L'interrogatoire : 2 questions, les 3 répondent à chacune.
  const q1 = await phase(A, 'question');
  t('[2] question 1/2 : un texte, un ordre de 3, un répondant', !!q1 && q1.question.index === 0 && q1.question.count === 2 && q1.question.order.length === 3
    && q1.question.speaker === q1.question.order[0] && q1.question.text.length > 5);
  t('[2] le Faux Témoin n ouvre pas la question 1', q1.question.order[0] !== L.id);
  const parle = cs.find((c) => c.id === q1.question.speaker);
  const muet = cs.find((c) => c !== parle);
  muet.send({ action: 'answered', roundId: 1 });
  t('[2] « J ai répondu » de qui n a pas la parole : refusé', (await muet.suite((m) => m.type === 'refused')).reason === 'NOT_YOUR_TURN');
  parle.send({ action: 'answered', roundId: 9 });
  t('[2] manche périmée : refusée', (await parle.suite((m) => m.type === 'refused')).reason === 'STALE_ROUND');
  parle.send({ action: 'answered', roundId: 1 });
  const q1b = await A.suite((m) => m.type === 'phase' && m.phase === 'question');
  t('[2] « J ai répondu » : la parole passe au suivant', !!q1b && q1b.question.speaker === q1.question.order[1] && q1b.question.answered.join() === parle.id);
  // Les autres tours : on laisse filer (la minuterie avance).
  const q2 = await A.wait((m) => m.type === 'phase' && m.phase === 'question' && m.question.index === 1, 4000);
  t('[2] question 2/2 : ciblée, nouvel ordre des 3', !!q2 && q2.question.order.length === 3 && q2.question.text !== q1.question.text);
  const deb = await phase(A, 'debate');
  t('[2] puis le débat, avec les 2 questions posées', !!deb && deb.asked.length === 2 && deb.asked[0] === q1.question.text);
  A.send({ action: 'vote', roundId: 1, target: B.id });
  t('[2] voter pendant le débat : refusé', (await A.suite((m) => m.type === 'refused')).reason === 'NOT_VOTING');
  A.send({ action: 'ready', roundId: 1 });
  const rdy = await C.suite((m) => m.type === 'ready');
  t('[2] `ready` : QUI est prêt', !!rdy && rdy.ready.join() === A.id && Object.keys(rdy).join() === 'type,roundId,ready');
  B.send({ action: 'ready', roundId: 1 });
  C.send({ action: 'ready', roundId: 1 });
  const vo = await phase(A, 'vote');
  t('[2] tout le monde prêt : vote aussitôt', !!vo && vo.voted.length === 0);
  W[0].send({ action: 'vote', roundId: 1, target: W[0].id });
  t('[2] voter pour soi : refusé', (await W[0].suite((m) => m.type === 'refused')).reason === 'BAD_TARGET');
  W[0].send({ action: 'vote', roundId: 1, target: W[1].id });
  W[0].send({ action: 'vote', roundId: 1, target: L.id });       // il change d'avis
  const vt = await A.wait((m) => m.type === 'voted' && m.voted.length === 1);
  t('[2] `voted` : QUI a voté, jamais pour qui', !!vt && vt.voted.join() === W[0].id && Object.keys(vt).join() === 'type,roundId,voted' && !JSON.stringify(vt).includes(L.id));
  L.send({ action: 'vote', roundId: 1, target: W[0].id });
  W[1].send({ action: 'vote', roundId: 1, target: L.id });
  const ver = await phase(A, 'verdict');
  t('[2] tout le monde a voté : verdict, le Faux Témoin démasqué (2 voix)', !!ver && ver.verdict.accused === L.id && ver.verdict.caught === true && ver.verdict.tie === false);
  t('[2] le verdict ne dit pas qui a voté pour qui', !JSON.stringify(ver).includes('"votes"'));
  const gu = await phase(A, 'guess');
  t('[2] dernière chance : publique (`liar`), 15 s en production', !!gu && gu.liar === L.id);
  const op = await L.wait((m) => m.type === 'options', 3000);
  t('[2] les 4 versions au Faux Témoin, celles du serveur', !!op && op.options.length === 4 && JSON.stringify(op.options) === JSON.stringify(g.round.options.versions));
  t('[2] les témoins ne reçoivent pas les versions', W.every((w) => !w.tous((m) => m.type === 'options').length));
  W[0].send({ action: 'guess', roundId: 1, option: 0 });
  t('[2] un témoin ne choisit pas', (await W[0].suite((m) => m.type === 'refused')).reason === 'NOT_LIAR');
  L.send({ action: 'guess', roundId: 1, option: 7 });
  t('[2] version hors des 4 : refusée', (await L.suite((m) => m.type === 'refused')).reason === 'BAD_OPTION');
  const juste = op.options.findIndex((s) => JSON.stringify(s) === JSON.stringify(g.round.scene));
  L.send({ action: 'guess', roundId: 1, option: juste });
  const rv = await phase(A, 'reveal');
  t('[2] il retrouve la vraie : révélation aussitôt', !!rv && rv.reveal.guess === juste && rv.reveal.answer === juste);
  t('[2] révélation : scène, Faux Témoin, votes (3), versions, points', JSON.stringify(rv.reveal.scene) === JSON.stringify(g.round.scene) && rv.reveal.liar === L.id
    && rv.reveal.votes.length === 3 && rv.reveal.votes.find((v) => v.id === W[0].id).target === L.id && rv.reveal.options.length === 4);
  t('[2] démasqué mais juste : +2 au Faux Témoin, 0 aux témoins', rv.reveal.points.find((p) => p.id === L.id).points === 2
    && W.every((w) => rv.reveal.points.find((p) => p.id === w.id).points === 0) && rv.players.find((p) => p.id === L.id).score === 2);
  t('[2] révélation : pas de minuterie (on attend l hôte)', rv.remainingMs === null);
  B.send({ action: 'next' });
  t('[2] un invité ne passe pas la révélation', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  A.send({ action: 'next' });
  const rd2 = await C.wait((m) => m.type === 'round' && m.roundId === 2, 3000);
  t('[2] `next` (hôte) : manche 2, un autre Faux Témoin', !!rd2 && room.game.round.liar !== L.id);

  // Manche 2 : personne ne vote ; manche 3 : un témoin accusé à tort.
  const rv2 = await A.wait((m) => m.type === 'phase' && m.phase === 'reveal' && m.roundId === 2, 8000);
  t('[2] manche 2 sans vote : pas démasqué, +3 au Faux Témoin', !!rv2 && rv2.reveal.verdict.accused === null && rv2.reveal.points.find((p) => p.id === rv2.reveal.liar).points === 3);
  A.send({ action: 'next' });
  await phase(A, 'vote', 8000, 3);
  const L3 = room.game.round.liar;
  const [w3a, w3b] = cs.filter((c) => c.id !== L3);
  for (const c of cs) c.send({ action: 'vote', roundId: 3, target: c === w3a ? L3 : w3a.id });
  const rv3 = await phase(A, 'reveal', 4000, 3);
  t('[2] manche 3 : un témoin accusé à tort, +3 au Faux Témoin', !!rv3 && rv3.reveal.verdict.accused === w3a.id && rv3.reveal.points.find((p) => p.id === L3).points === 3 && w3b);
  A.send({ action: 'next' });
  const res = await A.wait((m) => m.type === 'results', 3000);
  t('[2] après la 3e : `results`, complet, 3 classés avec nom et avatar', !!res && res.complete === true
    && res.ranking.length === 3 && res.ranking.every((r) => r.name && r.avatar && Number.isInteger(r.rank)) && res.host === A.id);
  t('[2] chacun a été Faux Témoin une fois', new Set(verites.get(code)[0] ? [...verites.get(code)[0].manches.values()].map((x) => x.liar) : []).size === 3);
  const total = res.ranking.reduce((s, r) => s + r.score, 0);
  t('[2] total des points = 2 + 3 + 3', total === 8, String(total));
  t('[2] chaque manche a eu ses phases dans l ordre (manche 2)', (() => {
    const ph = C.tous((m) => m.type === 'phase' && m.roundId === 2).map((m) => m.phase).filter((p, i, a) => p !== a[i - 1]).join();
    return ph === 'role,flash,question,debate,vote,verdict,reveal';
  })(), C.tous((m) => m.type === 'phase' && m.roundId === 2).map((m) => m.phase).join());

  // =============================================== 3. revanche et salon
  C.send({ action: 'snapshot' });
  const snapFin = await C.suite((m) => m.type === 'snapshot');
  t('[3] snapshot à la fin : classement, plus de rôle ni de scène', !!snapFin && snapFin.phase === 'end' && snapFin.ranking.length === 3 && snapFin.role === null && snapFin.scene === null);
  A.send({ action: 'start', flashMs: 5000 });
  const g2 = await B.suite((m) => m.type === 'game', 3000);
  t('[3] revanche depuis la fin, flash changé à 5 s', !!g2 && g2.flashMs === 5000);
  const flB = await phase(B, 'flash');
  B.send({ action: 'snapshot' });
  const snap = await B.suite((m) => m.type === 'snapshot');
  const estL = room.game.round.liar === B.id;
  t('[3] snapshot au flash : son rôle, et la scène seulement s il est témoin', !!flB && !!snap && snap.role.role === (estL ? 'liar' : 'witness')
    && (estL ? snap.scene === null : JSON.stringify(snap.scene) === JSON.stringify(room.game.round.scene)) && snap.options === null);
  await phase(B, 'question');
  B.send({ action: 'snapshot' });
  const snap2 = await B.suite((m) => m.type === 'snapshot');
  t('[3] snapshot après le flash : plus de scène', !!snap2 && snap2.scene === null && snap2.phase === 'question');
  await A.wait((m) => m.type === 'phase' && m.phase === 'reveal', 8000, A.msgs.length - 1);
  A.send({ action: 'next' }); await phase(A, 'reveal', 8000, 2);
  A.send({ action: 'next' }); await phase(A, 'reveal', 8000, 3);
  A.send({ action: 'next' });
  await A.wait((m) => m.type === 'results', 3000, A.msgs.length - 1);
  A.send({ action: 'lobby' });
  const lob = await B.suite((m) => m.type === 'lobby' && m.phase === 'lobby');
  t('[3] retour au salon (hôte), réglages gardés', !!lob && lob.flashMs === 5000);

  // ======================== 4. à cinq, 5 manches, robots, points recalculés
  {
    // Les robots-témoins votent pour le Faux Témoin aux manches impaires
    // (soufflé par la vérité du serveur), au hasard aux manches paires ; le
    // Faux Témoin démasqué choisit la version 0 (juste une fois sur 4).
    let salle = null;
    const robots = (i) => ({
      suivant: i === 0 ? 1 : null,      // un seul `next` : celui de l'hôte
      vote: (m, c) => {
        const k = salle.game.round;
        const autres = m.players.filter((p) => !p.left && p.id !== c.id).map((p) => p.id);
        if (k.liar === c.id) return autres[0];
        return m.roundId % 2 ? k.liar : autres[Math.floor(Math.random() * autres.length)];
      },
    });
    const { cs: c5, h: H, code: code5 } = await table(5, 'Cinq', robots);
    salle = rooms.get(code5);
    H.send({ action: 'settings', rounds: 5, flashMs: 8000 });
    await H.wait((m) => m.type === 'lobby' && m.rounds === 5);
    H.send({ action: 'start' });
    const res5 = await H.wait((m) => m.type === 'results', 30000);
    t('[4] 5 joueurs, 5 manches jouées jusqu au bout', !!res5 && res5.complete === true && res5.ranking.length === 5);
    const reveals = H.tous((m) => m.type === 'phase' && m.phase === 'reveal');
    t('[4] 5 révélations, 5 Faux Témoins différents', reveals.length === 5 && new Set(reveals.map((r) => r.reveal.liar)).size === 5);
    // Les points recalculés à part, d'après les seules révélations.
    const attendu = new Map(res5.ranking.map((r) => [r.id, 0]));
    for (const { reveal: v } of reveals) {
      if (!v.verdict.caught) attendu.set(v.liar, attendu.get(v.liar) + 3);
      else if (v.guess === v.answer) attendu.set(v.liar, attendu.get(v.liar) + 2);
      else for (const x of v.votes) if (x.target === v.liar) attendu.set(x.id, attendu.get(x.id) + 1);
    }
    t('[4] classement = points recalculés depuis les révélations', res5.ranking.every((r) => r.score === attendu.get(r.id)), JSON.stringify([...attendu]));
    t('[4] manches impaires : démasqué (les témoins votent pour lui)', reveals.filter((r) => r.roundId % 2).every((r) => r.reveal.verdict.caught));
    t('[4] à 5 : 2 questions, chacun répond aux deux', H.tous((m) => m.type === 'phase' && m.phase === 'question').every((m) => m.question.count === 2 && m.question.order.length === 5));
    const rangs = res5.ranking.map((r) => r.rank);
    t('[4] rang de compétition cohérent avec les scores', res5.ranking.every((r, i) => i === 0 ? r.rank === 1 : (r.score === res5.ranking[i - 1].score ? r.rank === res5.ranking[i - 1].rank : r.rank === i + 1)), rangs.join());
    fermer(c5);
  }

  // ===================================================== 5. les départs
  {
    // Le Faux Témoin s'en va en plein débat : la manche s'arrête, sans points.
    const { cs: q4, h: H } = await table(4, 'Quat');
    H.send({ action: 'start' });
    await phase(H, 'debate', 8000);
    const salle = rooms.get(H.code);
    const Lq = q4.find((c) => c.id === salle.game.round.liar);
    const autre = q4.find((c) => c !== Lq && c !== H) || H;
    Lq.ws.close();
    const lf = await autre.wait((m) => m.type === 'left', 3000);
    t('[5] le Faux Témoin part : `left`', !!lf && lf.id === Lq.id);
    const ab = await phase(autre, 'reveal');
    t('[5] … révélation aussitôt, manche annulée, aucun point', !!ab && ab.reveal.aborted === 'liar-left' && ab.reveal.points.every((p) => p.points === 0));
    if (Lq === H) await O.attendre(() => salle.hostId !== H.id);
    const hote = q4.find((c) => c.id === salle.hostId);
    hote.send({ action: 'next' });
    t('[5] la partie continue à 3 (nouvel hôte si besoin)', !!(await autre.wait((m) => m.type === 'round' && m.roundId === 2, 3000)));
    fermer(q4);
  }
  {
    // Sous 3 présents : fin incomplète.
    const { cs: tr, h: H, code: c3 } = await table(3, 'Tri');
    H.send({ action: 'start' });
    await phase(tr[1], 'question', 4000);
    tr[0].ws.close();               // l'HÔTE part
    const lf = await tr[1].wait((m) => m.type === 'left', 3000);
    t('[5] départ de l hôte en pleine manche : `left`, nouvel hôte', !!lf && lf.id === tr[0].id && lf.host === tr[1].id && lf.players.find((p) => p.id === tr[0].id).left === true);
    const inc = await tr[1].wait((m) => m.type === 'results', 3000);
    t('[5] moins de 3 présents : `results` INCOMPLET (aucun classement pour le Hub)', !!inc && inc.complete === false);
    tr[1].ws.close(); tr[2].ws.close();
    await O.attendre(() => !rooms.has(c3));
    t('[5] room vidée : supprimée, minuterie coupée', !rooms.has(c3));
  }
  {
    // Celui qui a la parole s'en va : on passe au suivant.
    const { cs: q5, h: H } = await table(5, 'Parole');
    H.send({ action: 'start' });
    const q = await phase(H, 'question', 4000);
    const parleur = q5.find((c) => c.id === q.question.speaker);
    const temoin = q5.find((c) => c !== parleur && c !== H);
    parleur.ws.close();
    const suite = await temoin.wait((m) => m.type === 'phase' && m.phase === 'question' && m.question.speaker !== parleur.id, 3000);
    t('[5] celui qui parle s en va : la parole passe aussitôt au suivant', !!suite && suite.question.speaker === q.question.order[1]);
    fermer(q5);
  }
  {
    // Onglet figé : il ne répond plus à la présence → fermé, puis parti.
    const { cs: fz, h: H } = await table(4, 'Gel');
    H.send({ action: 'start' });
    await fz[3].wait((m) => m.type === 'round', 3000);
    fz[3].repond = false;
    const lf = await H.wait((m) => m.type === 'left' && m.id === fz[3].id, 4000);
    t('[5] onglet figé : fermé (4000 absent) puis `left`', !!lf && fz[3].ferme && fz[3].ferme.code === 4000);
    fermer(fz);
  }

  // ========================================================== 6. le fil
  await O.sleep(100);
  const ecarts = [];
  for (const c of tous) if (c.code) ecarts.push(...O.inspecterFil(c, verite(c.code)));
  t(`[6] fil de ${tous.length} clients : champs connus, aucun secret hors révélation, rôle, scène et versions conformes au serveur`, ecarts.length === 0, ecarts.slice(0, 6).join(' | '));
  // Contre-épreuves : l'inspecteur voit bien une fuite quand il y en a une.
  const faux = (msgs, v) => O.inspecterFil({ nom: 'faux', id: 'zz', msgs }, v || null).length > 0;
  t('[6] contre-épreuve : une `scene` glissée dans `phase` est vue', faux([{ type: 'phase', roundId: 1, phase: 'debate', scene: {} }]));
  t('[6] contre-épreuve : des `votes` glissés dans `voted` sont vus', faux([{ type: 'voted', roundId: 1, voted: [], votes: [] }]));
  t('[6] contre-épreuve : le Faux Témoin nommé en plein débat est vu', faux([{ type: 'phase', roundId: 1, phase: 'debate', liar: 'zz' }]));
  t('[6] contre-épreuve : la scène envoyée au Faux Témoin est vue',
    faux([{ type: 'game' }, { type: 'scene', roundId: 1, scene: { place: 'gare', title: 'x', items: [] } }], () => ({ liar: 'zz', scene: {} })));
  t('[6] contre-épreuve : des versions reçues par un témoin sont vues',
    faux([{ type: 'game' }, { type: 'options', roundId: 1, options: [] }], () => ({ liar: 'yy', scene: {}, options: [] })));

  fermer(tous);
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
