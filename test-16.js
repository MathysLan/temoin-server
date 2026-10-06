// Partie complète à 16 vrais clients WebSocket, joués par des robots.
//
//   node test-16.js
//
// Vérifie ce qui ne se voit qu'à 16 : 3 Faux Témoins par affaire, 20 suspects,
// chaque attribut vu par plusieurs témoins, une partie qui va au bout sans
// attente, des messages qui restent petits, et un fil propre chez les 16.
process.env.PORT = process.env.PORT || '8797';
process.env.TEST_FLASH_MS = '100';
process.env.TEST_DECLARE_MS = '700';
process.env.TEST_DELIBERATE_MS = '300';
process.env.TEST_LASTCALL_MS = '200';
process.env.TEST_RESULTS_MS = '150';
process.env.PRESENCE_QUIET = '1';
const { rooms } = require('./server.js');
const E = require('./engine.js');
const O = require('./test-outils.js');

const URL = `ws://127.0.0.1:${process.env.PORT}`;
const t = O.compteur();
const N = 16;

(async () => {
  const cs = [];
  const roles = [];             // relevé côté serveur, une entrée par affaire
  const h = O.robot(O.client(URL, 'J0'));
  const you = await O.joindre(h, 'J0', null, { kind: 'emoji', emoji: '🎩' });
  cs.push(h);
  for (let i = 1; i < N; i++) {
    const c = O.robot(O.client(URL, 'J' + i));
    await O.joindre(c, 'J' + i, you.code);
    cs.push(c);
  }
  await O.attendre(() => h.dernier('lobby') && h.dernier('lobby').players.length === N);
  t('[16] salon : 16 joueurs', h.dernier('lobby').players.length === N);
  const room = rooms.get(you.code);
  h.on((m) => {
    if (m.type !== 'case') return;
    const g = room.game;
    roles.push({ caseId: g.caseId, kase: g.kase, parId: new Map(g.order.map((id) => [id, E.roleView(g, id)])) });
  });

  const debut = Date.now();
  h.send({ action: 'start', cases: 3 });
  const res = await h.wait((m) => m.type === 'results', 20000);
  const duree = Date.now() - debut;
  t('[16] la partie va au bout : `results` complet, 16 classés', !!res && res.complete === true && res.ranking.length === N);
  t('[16] 3 affaires, 3 Faux Témoins et 13 témoins chacune', roles.length === 3 && roles.every((r) => r.kase.liars.size === 3 && r.kase.witnesses.size === 13));
  const k = h.tous((m) => m.type === 'case');
  t('[16] 20 suspects, `liars` annoncé 3–3', k.every((m) => m.lineup.length === 20 && m.liars.min === 3 && m.liars.max === 3));
  t('[16] chaque attribut vu par 2 ou 3 témoins', roles.every((r) => {
    const n = new Map();
    for (const a of r.kase.fragments.values()) for (const i of a) n.set(i, (n.get(i) || 0) + 1);
    return n.size === 5 && [...n.values()].every((v) => v >= 2 && v <= 3);
  }));
  // Les robots témoins déclarent vrai et verrouillent à la révélation 1 :
  // tout le monde a verrouillé → aucune affaire n'attend deliberate ni lastcall.
  const fins = h.tous((m) => m.type === 'case-end');
  t('[16] tous verrouillent en declare2 : chaque affaire finit sans deliberate', fins.length === 3
    && h.tous((m) => m.type === 'phase' && m.phase === 'deliberate').length === 0);
  // Résoluble, relu sur le fil : les déclarations VRAIES des témoins (l'audit
  // le dit) suffisent, ensemble, à isoler le coupable dans le tapissage reçu.
  t('[16] chaque affaire se résout avec les seules déclarations vraies des témoins', fins.every((f) => {
    const lineup = k.find((m) => m.caseId === f.caseId).lineup;
    const vraies = f.audit.declarations.filter((d) => d.truth === true && !f.audit.liars.includes(d.id));
    return lineup.filter((s) => vraies.every((d) => s[d.attr] === d.value)).length === 1;
  }));
  const justes = fins.flatMap((f) => f.audit.locks.filter((l) => !f.audit.liars.includes(l.id) && l.correct)).length;
  console.log(`     (info : ${justes}/39 verrous de robots témoins justes ; les 3 robots menteurs mentent tous sur le même attribut)`);
  t('[16] aucun Faux Témoin au-dessus de 7, aucun témoin au-dessus de 7', fins.every((f) => f.audit.points.every((p) => p.points >= 0 && p.points <= 7)));
  t(`[16] durée raisonnable (${duree} ms pour 3 affaires raccourcies)`, duree < 8000);
  const tailles = h.msgs.map((m) => JSON.stringify(m).length);
  t(`[16] messages petits : le plus gros fait ${Math.max(...tailles)} octets (< 16 Ko)`, Math.max(...tailles) < 16384);

  const verite = (caseId, id) => {
    const r = roles.find((x) => x.caseId === caseId);
    const v = r && r.parId.get(id);
    return v ? { role: v.role, fragment: v.fragment, culprit: v.culprit } : null;
  };
  const ecarts = cs.flatMap((c) => O.inspecterFil(c, verite));
  t('[16] fil des 16 clients : propre, rôles conformes', ecarts.length === 0, ecarts.slice(0, 5).join(' | '));

  cs.forEach((c) => c.ws.terminate());
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
