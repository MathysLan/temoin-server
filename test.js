// Test bout en bout du serveur : de vrais clients WebSocket, un vrai serveur
// (dans ce processus), de vraies minuteries — raccourcies.
//
//   node test.js
//
// 0. santé ; 1. salon, hôte, réglage, refus ; 2. une partie à trois pilotée à
// la main (rôles, déclarations, révélations, verrous, audit, `next`), finie à
// la minuterie ; 3. revanche et retour au salon ; 4. à deux : l'indic ;
// 5. les départs (en pleine affaire, partie incomplète, onglet figé) ;
// 6. LE FIL : tout ce que chaque client a reçu, relu champ par champ.
process.env.PORT = process.env.PORT || '8796';
process.env.TEST_FLASH_MS = '120';
process.env.TEST_DECLARE_MS = '500';
process.env.TEST_DELIBERATE_MS = '300';
process.env.TEST_LASTCALL_MS = '200';
process.env.TEST_RESULTS_MS = '200';
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
// Les rôles relevés CÔTÉ SERVEUR, par room, partie (la revanche repart à
// l'affaire 1) et affaire : la vérité contre laquelle on relit le fil.
const roles = new Map();         // code → [{ game, caseId, parId }]

function relever(code) {
  const r = rooms.get(code);
  if (!r || !r.game || !r.game.kase) return;
  const g = r.game;
  const liste = roles.get(code) || roles.set(code, []).get(code);
  if (liste.some((x) => x.game === g && x.caseId === g.caseId)) return;
  liste.push({ game: g, caseId: g.caseId, parId: new Map(g.order.map((id) => [id, E.roleView(g, id)])) });
}
// Le rôle de `id` à l'affaire `caseId` ; s'il y a eu plusieurs parties, celle
// dont le rôle correspond (le fil est relu dans l'ordre, une partie après l'autre).
const verite = (code) => {
  const vus = new Map();
  return (caseId, id) => {
    const liste = (roles.get(code) || []).filter((x) => x.caseId === caseId && x.parId.has(id));
    const cle = caseId + ':' + id;
    const n = vus.get(cle) || 0;
    vus.set(cle, n + 1);
    const e = liste[Math.min(n, liste.length - 1)];
    const r = e && e.parId.get(id);
    return r ? { role: r.role, fragment: r.fragment, culprit: r.culprit } : null;
  };
};

function nouveau(nom) {
  const c = O.client(URL, nom);
  tous.push(c);
  c.on((m) => { if (c.code && (m.type === 'case' || m.type === 'role')) relever(c.code); });
  return c;
}

async function table(n, prefixe) {
  const cs = [];
  const h = nouveau(prefixe + '0');
  const you = await O.joindre(h, prefixe + '0');
  cs.push(h);
  for (let i = 1; i < n; i++) {
    const c = nouveau(prefixe + i);
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

(async () => {
  // ============================================================ 0. santé
  const h = await get('/');
  t('[0] GET / → 200 « temoin-server ok »', h.status === 200 && /temoin-server ok/.test(h.body));

  // ======================================================= 1. salon et hôte
  const A = nouveau('A');
  const youA = await O.joindre(A, 'Alice');
  t('[1] créer : code à 4 lettres, le créateur est l hôte', /^[A-Z]{4}$/.test(youA.code) && youA.host === true);
  const B = nouveau('B');
  const youB = await O.joindre(B, 'Bruno', youA.code.toLowerCase());
  t('[1] rejoindre (code en minuscules accepté) : pas hôte', youB.code === youA.code && youB.host === false);
  const C = nouveau('C');
  await O.joindre(C, 'Chloé', youA.code);
  const lob = await A.wait((m) => m.type === 'lobby' && m.players.length === 3);
  t('[1] salon à 3 : un seul hôte, max 16, 5 affaires par défaut', !!lob && lob.players.filter((p) => p.host).length === 1 && lob.max === 16 && lob.cases === 5);

  const X = nouveau('X');
  await X.open;
  X.send({ action: 'declare', caseId: 1, pass: true });
  t('[1] action avant join : refusée', /pas encore dans une partie/.test((await X.wait((m) => m.type === 'error')).message));
  X.send({ action: 'join', name: 'X', code: 'ZZZZ' });
  t('[1] code inconnu : refusé', /aucune partie/.test((await X.wait((m) => m.type === 'error')).message));
  X.ws.send('pas du json');
  t('[1] message illisible : refusé', /illisible/.test((await X.wait((m) => m.type === 'error')).message));
  X.send({ action: 'resume', code: youA.code });
  t('[1] resume : refusé en V1', /reprise non disponible/.test((await X.wait((m) => m.type === 'error')).message));
  B.send({ action: 'join', name: 'B2', code: youA.code });
  t('[1] join deux fois : refusé', /déjà dans une partie/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'danse' });
  t('[1] action inconnue : refusée', /action inconnue/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'start' });
  t('[1] un invité ne lance pas', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  B.send({ action: 'cases', cases: 3 });
  t('[1] un invité ne règle pas', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  A.send({ action: 'cases', cases: 4 });
  t('[1] nombre d affaires hors 3/5/7 : refusé', /3, 5, 7/.test((await A.suite((m) => m.type === 'error')).message));
  A.send({ action: 'cases', cases: 3 });
  t('[1] l hôte règle 3 affaires : le salon le dit à tous', !!(await C.suite((m) => m.type === 'lobby' && m.cases === 3)));
  {
    const S = nouveau('S');
    await O.joindre(S, 'Solo');
    S.send({ action: 'start' });
    t('[1] hôte seul : il faut 2 joueurs', /au moins 2/.test((await S.suite((m) => m.type === 'error')).message));
    const N = nouveau('N');
    await O.joindre(N, '‮abc\u0007 ' + 'x'.repeat(30), S.code);
    const l = await S.wait((m) => m.type === 'lobby' && m.players.length === 2);
    t('[1] pseudo nettoyé (contrôles, sens d écriture) et coupé à 16', l.players[1].name === 'abc ' + 'x'.repeat(12));
    N.ws.close();
    const l2 = await S.wait((m) => m.type === 'lobby' && m.players.length === 1);
    t('[1] départ au salon : le salon est rediffusé', !!l2);
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
  t('[2] lancement : un `game` chacun (soi, hôte, 3 affaires, vocabulaire, identités)', games.every((g, i) => g && g.you === cs[i].id && g.host === A.id && g.cases === 3
    && g.attrs.length === 5 && g.attrs[0].id === 'chapeau' && g.identities.length === 3 && g.identities.every((x) => x.name && x.avatar)));
  const k1 = await B.wait((m) => m.type === 'case', 3000, iDep[1]);
  t('[2] puis `case` 1/3 : flash, 12 suspects, Faux Témoin 0 ou 1, rien de privé', !!k1 && k1.caseId === 1 && k1.cases === 3 && k1.phase === 'flash'
    && k1.lineup.length === 12 && k1.liars.min === 0 && k1.liars.max === 1 && k1.indic === false && k1.locked === 0 && k1.rounds.length === 0);
  const r1 = await Promise.all(cs.map((c, i) => c.wait((m) => m.type === 'role', 3000, iDep[i])));
  const g = room.game;
  t('[2] puis `role`, à chacun le sien, juste (relevé côté serveur)', r1.every((r, i) => r && JSON.stringify({ ...r, type: undefined }) === JSON.stringify({ ...E.roleView(g, cs[i].id), type: undefined })));
  t('[2] un `role` par joueur, et AUCUN rôle d un autre', cs.every((c) => c.tous((m) => m.type === 'role').length === 1));
  const liar = cs.find((c, i) => r1[i].role === 'liar');
  const wit = cs.filter((c, i) => r1[i].role === 'witness');

  const d1 = await A.wait((m) => m.type === 'phase' && m.phase === 'declare1', 3000);
  t('[2] fin du flash → declare1, temps restant ≤ 500', !!d1 && d1.remainingMs <= 500 && d1.durationMs === 500);
  B.send({ action: 'lock', caseId: 1, suspect: 0 });
  t('[2] verrou en declare1 : refusé (NOT_LOCKING)', (await B.suite((m) => m.type === 'refused')).reason === 'NOT_LOCKING');
  B.send({ action: 'declare', caseId: 1, attr: 'chapeau', value: 'sombrero' });
  t('[2] déclaration hors vocabulaire : refusée', (await B.suite((m) => m.type === 'refused')).reason === 'BAD_DECLARATION');
  B.send({ action: 'declare', caseId: 9, pass: true });
  t('[2] mauvaise affaire : refusée (STALE_CASE)', (await B.suite((m) => m.type === 'refused')).reason === 'STALE_CASE');
  const fragB = r1[1].fragment[0];
  B.send({ action: 'declare', caseId: 1, attr: fragB.attr, value: fragB.value });
  const dB = await A.suite((m) => m.type === 'declared');
  t('[2] `declared` : QUI a déclaré, jamais quoi', !!dB && dB.declared.join() === B.id && !JSON.stringify(dB).includes(fragB.value));
  B.send({ action: 'declare', caseId: 1, pass: true });
  t('[2] deux fois au même tour : refusé', (await B.suite((m) => m.type === 'refused')).reason === 'ALREADY_DECLARED');
  A.send({ action: 'declare', caseId: 1, pass: true });
  C.send({ action: 'declare', caseId: 1, attr: r1[2].fragment[0].attr, value: r1[2].fragment[0].value });
  const d2 = await A.wait((m) => m.type === 'phase' && m.phase === 'declare2', 3000);
  t('[2] tous ont déclaré → declare2 aussitôt, révélation 1 d un bloc (3 lignes, dont 1 silence)', !!d2 && d2.rounds.length === 1
    && d2.rounds[0].declarations.length === 3 && d2.rounds[0].declarations.filter((d) => d.pass).length === 1
    && d2.rounds[0].declarations.find((d) => d.id === B.id).value === fragB.value && d2.rounds[0].summary[fragB.attr][fragB.value] >= 1);

  // Verrous : W (un témoin) sur le bon suspect — le test le lit côté serveur —,
  // Q (un autre) sur un mauvais, le troisième au hasard.
  const cul = g.kase.culprit;
  const W = wit[0];
  const [Q, R] = cs.filter((c) => c !== W);
  W.send({ action: 'lock', caseId: 1, suspect: cul, accuse: Q.id });
  const lk = await A.suite((m) => m.type === 'locked');
  t('[2] `locked` : le NOMBRE seulement', !!lk && lk.locked === 1 && Object.keys(lk).join() === 'type,caseId,locked');
  W.send({ action: 'lock', caseId: 1, suspect: 1 });
  t('[2] deux verrous : refusé', (await W.suite((m) => m.type === 'refused')).reason === 'ALREADY_LOCKED');
  Q.send({ action: 'lock', caseId: 1, suspect: 'trois' });
  t('[2] suspect invalide : refusé', (await Q.suite((m) => m.type === 'refused')).reason === 'BAD_SUSPECT');
  Q.send({ action: 'lock', caseId: 1, suspect: (cul + 1) % 12, accuse: Q.id });
  t('[2] s accuser soi-même : refusé', (await Q.suite((m) => m.type === 'refused')).reason === 'BAD_ACCUSE');
  Q.send({ action: 'lock', caseId: 1, suspect: (cul + 1) % 12 });
  R.send({ action: 'lock', caseId: 1, suspect: 5 });
  const fin1 = await A.wait((m) => m.type === 'case-end', 3000);
  t('[2] tous ont verrouillé → `case-end` aussitôt', !!fin1 && fin1.caseId === 1 && fin1.last === false);
  t('[2] audit : coupable, Faux Témoin, verrous, vérité de chaque déclaration', fin1.audit.culprit === cul
    && fin1.audit.liars.join() === (liar ? liar.id : '') && fin1.audit.locks.length === 3
    && fin1.audit.declarations.find((d) => d.id === B.id && d.round === 1).truth === true);
  const ptsW = fin1.audit.points.find((p) => p.id === W.id);
  const menti = fin1.audit.declarations.some((d) => d.id === W.id && d.truth === false);
  const attendu = menti ? 0 : 5 + (liar && liar.id === Q.id ? 2 : 0);
  t(`[2] points : un témoin, bon verrou en declare2${attendu === 7 ? ' + accusation juste' : ''} → ${attendu}`, ptsW && ptsW.points === attendu, JSON.stringify(ptsW));
  t('[2] scores : la même chose dans `players`', fin1.players.find((p) => p.id === W.id).score === attendu);

  B.send({ action: 'next' });
  t('[2] un invité ne passe pas les résultats', /seul l'hôte/.test((await B.suite((m) => m.type === 'error')).message));
  A.send({ action: 'next' });
  const k2 = await C.wait((m) => m.type === 'case' && m.caseId === 2, 3000);
  t('[2] `next` (hôte) : affaire 2 sans attendre, nouveau tapissage', !!k2 && JSON.stringify(k2.lineup) !== JSON.stringify(k1.lineup));
  // Affaires 2 et 3 : personne ne joue, la minuterie fait tout.
  const res = await A.wait((m) => m.type === 'results', 8000);
  t('[2] la minuterie mène seule au bout : `results`, complet, 3 classés avec nom et avatar', !!res && res.complete === true
    && res.ranking.length === 3 && res.ranking.every((r) => r.name && r.avatar && Number.isInteger(r.rank)) && res.host === A.id);
  t('[2] chaque affaire a eu ses phases dans l ordre', (() => {
    const ph = C.tous((m) => m.type === 'phase' && m.caseId === 3).map((m) => m.phase).join();
    return ph === 'declare1,declare2,deliberate,lastcall';
  })(), C.tous((m) => m.type === 'phase' && m.caseId === 3).map((m) => m.phase).join());
  t('[2] le témoin garde son affaire 1 au classement', res.ranking.find((r) => r.id === W.id).score >= attendu);

  // =============================================== 3. revanche et salon
  C.send({ action: 'snapshot' });
  const snapFin = await C.suite((m) => m.type === 'snapshot');
  t('[3] snapshot à la fin : classement, plus de rôle', !!snapFin && snapFin.phase === 'end' && snapFin.ranking.length === 3 && snapFin.role === null);
  A.send({ action: 'start' });
  const k1b = await B.suite((m) => m.type === 'case', 3000);
  t('[3] revanche depuis la fin : nouvelle partie, affaire 1', !!k1b && k1b.caseId === 1);
  B.send({ action: 'snapshot' });
  const snap = await B.suite((m) => m.type === 'snapshot');
  t('[3] snapshot en partie : son rôle, pas d audit', !!snap && snap.role && snap.role.caseId === 1 && snap.audit === null && snap.lineup.length === 12);
  await A.wait((m) => m.type === 'results', 8000, A.msgs.length - 1);
  A.send({ action: 'lobby' });
  t('[3] retour au salon (hôte)', !!(await B.suite((m) => m.type === 'lobby' && m.phase === 'lobby')));

  // ================================================== 4. à deux : l'indic
  {
    const { cs: dd, h: H } = await table(2, 'Duo');
    H.send({ action: 'start', cases: 3 });
    const kd = await dd[1].wait((m) => m.type === 'case', 3000);
    t('[4] à 2 : `indic: true`, aucun Faux Témoin possible', !!kd && kd.indic === true && kd.liars.max === 0);
    const rd = await dd[1].wait((m) => m.type === 'role', 3000);
    t('[4] à 2 : deux attributs vus chacun, rôle témoin', rd.role === 'witness' && rd.fragment.length === 2);
    const d2d = await H.wait((m) => m.type === 'phase' && m.phase === 'declare2', 3000);
    const ind = d2d.rounds[0].declarations.find((d) => d.id === E.INDIC);
    t('[4] révélation 1 : l indic a déclaré (attribut et valeur du vocabulaire)', !!ind && E.ATTR_IDS.includes(ind.attr));
    const fin = await H.wait((m) => m.type === 'case-end', 3000);
    const vInd = fin.audit.declarations.filter((d) => d.id === E.INDIC);
    t('[4] audit : deux déclarations de l indic, exactement une fausse', vInd.length === 2 && vInd.filter((d) => d.truth === false).length === 1);
    fermer(dd);
  }

  // ===================================================== 5. les départs
  {
    const { cs: tr, h: H, code: c3 } = await table(3, 'Tri');
    H.send({ action: 'start', cases: 3 });
    await tr[1].wait((m) => m.type === 'phase' && m.phase === 'declare1', 3000);
    tr[0].send({ action: 'declare', caseId: 1, pass: true });
    tr[1].send({ action: 'declare', caseId: 1, pass: true });
    await tr[1].wait((m) => m.type === 'declared' && m.declared.length === 2, 3000);
    tr[0].ws.close();               // l'HÔTE part ; il ne reste que des gens qui ont déclaré… sauf tr[2]
    const lf = await tr[1].wait((m) => m.type === 'left', 3000);
    t('[5] départ de l hôte en pleine affaire : `left`, nouvel hôte', !!lf && lf.id === tr[0].id && lf.host === tr[1].id && lf.players.find((p) => p.id === tr[0].id).left === true);
    tr[2].send({ action: 'declare', caseId: 1, pass: true });
    t('[5] la partie continue à 2 : fin anticipée de declare1 sans l absent', !!(await tr[1].wait((m) => m.type === 'phase' && m.phase === 'declare2', 3000)));
    tr[2].ws.close();
    const inc = await tr[1].wait((m) => m.type === 'results', 3000);
    t('[5] moins de 2 présents : `results` INCOMPLET (aucun classement pour le Hub)', !!inc && inc.complete === false);
    tr[1].ws.close();
    await O.attendre(() => !rooms.has(c3));
    t('[5] room vidée : supprimée, minuterie coupée', !rooms.has(c3));
  }
  {
    // Onglet figé : il ne répond plus à la présence → fermé, puis parti.
    const { cs: fz, h: H } = await table(3, 'Gel');
    H.send({ action: 'start', cases: 3 });
    await fz[2].wait((m) => m.type === 'case', 3000);
    fz[2].repond = false;
    const lf = await H.wait((m) => m.type === 'left' && m.id === fz[2].id, 4000);
    t('[5] onglet figé : fermé (4000 absent) puis `left`', !!lf && fz[2].ferme && fz[2].ferme.code === 4000);
    fermer(fz);
  }

  // ========================================================== 6. le fil
  await O.sleep(100);
  const ecarts = [];
  for (const c of tous) if (c.code) ecarts.push(...O.inspecterFil(c, verite(c.code)));
  t(`[6] fil de ${tous.length} clients : champs connus, aucun secret hors audit ou rôle, rôles conformes au serveur`, ecarts.length === 0, ecarts.slice(0, 6).join(' | '));
  // Contre-épreuve : l'inspecteur voit bien une fuite quand il y en a une.
  const faux = { nom: 'faux', id: 'zz', msgs: [{ type: 'phase', caseId: 1, phase: 'declare2', remainingMs: 10, durationMs: 10, rounds: [], locked: 0, culprit: 3 }] };
  t('[6] contre-épreuve : un `culprit` glissé dans `phase` est vu', O.inspecterFil(faux, null).length > 0);
  const faux2 = { nom: 'faux', id: 'zz', msgs: [{ type: 'locked', caseId: 1, locked: 1, suspect: 4 }] };
  t('[6] contre-épreuve : un `suspect` glissé dans `locked` est vu', O.inspecterFil(faux2, null).length > 0);

  fermer(tous);
  const { ok, ko } = t.bilan();
  console.log(`\n${ok} OK, ${ko} KO`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
