// Partie complète à 16 vrais clients WebSocket, joués par des robots.
//
//   node test-16.js
//
// Vérifie ce qui ne se voit qu'à 16 : 3 questions par manche, chacun ne
// répond qu'à une seule (groupes de 6, 5, 5), un débat de 90 s, la scène
// envoyée à 15 témoins et à personne d'autre, les 4 versions au seul Faux
// Témoin démasqué, une partie qui va au bout, des messages qui restent
// petits, et un fil propre chez les 16.
process.env.PORT = process.env.PORT || '8797';
process.env.TEST_ROLE_MS = '60';
process.env.TEST_FLASH_MS = '100';
process.env.TEST_ASK_MS = '0';
process.env.TEST_ANSWER_MS = '400';
process.env.TEST_DEBATE_MS = '700';
process.env.TEST_VOTE_MS = '700';
process.env.TEST_VERDICT_MS = '60';
process.env.TEST_GUESS_MS = '500';
process.env.PRESENCE_QUIET = '1';
const { rooms } = require('./server.js');
const E = require('./engine.js');
const O = require('./test-outils.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const t = O.compteur();
const N = 16;

(async () => {
  const cs = [];
  const manches = new Map();    // relevé côté serveur : roundId → { liar, scene, options, questions }
  let room = null;
  // Les témoins votent pour le Faux Témoin aux manches 1 et 3 (soufflé par la
  // vérité du serveur : un scénario), pour J1 à la manche 2. Démasqué, le
  // Faux Témoin choisit la version 0.
  const comportement = (i) => ({
    suivant: i === 0 ? 1 : null,
    vote: (m, c) => {
      const k = room.game.round;
      if (k.liar === c.id) return m.players.find((p) => p.id !== c.id && !p.left).id;
      if (m.roundId === 2) return c.id === cs[1].id ? cs[2].id : cs[1].id;
      return k.liar;
    },
  });
  const releve = () => {
    const g = room && room.game;
    if (!g || !g.round) return;
    const k = g.round;
    const x = manches.get(k.id) || { liar: k.liar, scene: k.scene, options: null, questions: k.questions };
    if (k.options) x.options = k.options.versions;
    manches.set(k.id, x);
  };
  const h = O.robot(O.client(URL, 'J0'), comportement(0));
  const you = await O.joindre(h, 'J0', null, { kind: 'emoji', emoji: '🎩' });
  room = rooms.get(you.code);
  cs.push(h);
  for (let i = 1; i < N; i++) {
    const c = O.robot(O.client(URL, 'J' + i), comportement(i));
    await O.joindre(c, 'J' + i, you.code);
    cs.push(c);
  }
  cs.forEach((c) => c.on(releve));
  await O.attendre(() => h.dernier('lobby') && h.dernier('lobby').players.length === N);
  t('[16] salon : 16 joueurs', h.dernier('lobby').players.length === N);

  const debut = Date.now();
  h.send({ action: 'start' });
  const res = await h.wait((m) => m.type === 'results', 30000);
  const duree = Date.now() - debut;
  t('[16] la partie va au bout : `results` complet, 16 classés', !!res && res.complete === true && res.ranking.length === N);
  t('[16] 3 manches, 3 Faux Témoins différents', manches.size === 3 && new Set([...manches.values()].map((x) => x.liar)).size === 3);

  // L'interrogatoire à 16 : 3 questions, chacun répond à UNE.
  const groupes = [...manches.values()].map((x) => x.questions.map((q) => q.order.length).join(','));
  t('[16] 3 questions par manche, groupes de 6, 5 et 5', groupes.every((g) => g === '6,5,5'), groupes.join(' | '));
  t('[16] chaque joueur répond à une seule question par manche', [...manches.values()].every((x) => {
    const tout = x.questions.flatMap((q) => q.order);
    return tout.length === N && new Set(tout).size === N;
  }));
  t('[16] le Faux Témoin n ouvre jamais la question 1', [...manches.values()].every((x) => x.questions[0].order[0] !== x.liar));
  const parleurs = h.tous((m) => m.type === 'phase' && m.phase === 'question' && m.roundId === 1).map((m) => m.question.speaker);
  t('[16] manche 1 : 16 tours de parole, un par joueur, dans l ordre du serveur', parleurs.length === N && parleurs.join() === manches.get(1).questions.flatMap((q) => q.order).join());
  const deb = h.tous((m) => m.type === 'phase' && m.phase === 'debate');
  t('[16] débat (raccourci ici) : tous prêts → vote sans attendre', deb.length === 3 && h.tous((m) => m.type === 'phase' && m.phase === 'vote').length === 3);
  t('[16] le moteur prévoit 90 s de débat dès 9 joueurs', E.DEBATE_LONG_MS === 90000 && E.DEBATE_LONG_FROM === 9);

  // La scène : 15 témoins la reçoivent, le Faux Témoin reçoit null.
  for (const [rid, x] of manches) {
    const recues = cs.map((c) => c.tous((m) => m.type === 'scene' && m.roundId === rid));
    const ok = recues.every((r, i) => r.length === 1 && (cs[i].id === x.liar ? r[0].scene === null : JSON.stringify(r[0].scene) === JSON.stringify(x.scene)));
    t(`[16] manche ${rid} : la scène à 15 témoins, null au Faux Témoin`, ok);
  }
  const reveals = h.tous((m) => m.type === 'phase' && m.phase === 'reveal');
  t('[16] manches 1 et 3 : démasqué à 15 voix', [0, 2].every((i) => reveals[i].reveal.verdict.caught && reveals[i].reveal.votes.filter((v) => v.target === reveals[i].reveal.liar).length === 15));
  t('[16] les 4 versions au seul Faux Témoin démasqué', [1, 3].every((rid) => cs.every((c) => c.tous((m) => m.type === 'options' && m.roundId === rid).length === (c.id === manches.get(rid).liar ? 1 : 0))));
  t('[16] manche 2 : un témoin accusé à tort, +3 au Faux Témoin', !reveals[1].reveal.verdict.caught && reveals[1].reveal.points.find((p) => p.id === reveals[1].reveal.liar).points === 3);
  const attendu = new Map(res.ranking.map((r) => [r.id, 0]));
  for (const { reveal: v } of reveals) {
    if (!v.verdict.caught) attendu.set(v.liar, attendu.get(v.liar) + 3);
    else if (v.guess === v.answer) attendu.set(v.liar, attendu.get(v.liar) + 2);
    else for (const x of v.votes) if (x.target === v.liar) attendu.set(x.id, attendu.get(x.id) + 1);
  }
  t('[16] classement = points recalculés depuis les révélations', res.ranking.every((r) => r.score === attendu.get(r.id)));
  t(`[16] durée raisonnable (${duree} ms pour 3 manches raccourcies)`, duree < 25000);
  const tailles = h.msgs.map((m) => JSON.stringify(m).length);
  t(`[16] messages petits : le plus gros fait ${Math.max(...tailles)} octets (< 16 Ko)`, Math.max(...tailles) < 16384);

  const verite = (roundId) => manches.get(roundId) || null;
  const ecarts = cs.flatMap((c) => O.inspecterFil(c, verite));
  t('[16] fil des 16 clients : propre, rôle, scène et versions conformes au serveur', ecarts.length === 0, ecarts.slice(0, 5).join(' | '));

  cs.forEach((c) => c.ws.terminate());
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
