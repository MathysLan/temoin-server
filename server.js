// temoin-server — serveur arbitre de « Faux Témoin ».
//
// Même forme que les autres serveurs du portfolio (croquis, roquette,
// qui-ment…) : un seul WebSocket, du JSON, des rooms à code de 4 lettres, et
// une règle d'or — LE CLIENT N'A AUCUNE AUTORITÉ. Il envoie des intentions
// (« je déclare : manteau rouge », « je verrouille le suspect 7 ») ;
// engine.js décide de tout ce qui touche au jeu.
//
// Ce fichier ORCHESTRE le moteur, il ne recopie aucune de ses règles :
//   - une partie = E.createGame() ; déclarations, verrous et départs passent
//     par E.declare(), E.lock(), E.leave() ;
//   - UNE minuterie par room, posée sur E.nextDeadline() ; à l'échéance,
//     E.tick(Date.now()), puis on la repose ;
//   - les événements du moteur deviennent des messages, et c'est tout.
//
// LE COUPABLE ET LES RÔLES SONT LES SECRETS DE CE JEU. Le rôle part joueur par
// joueur (`role`, même forme pour tous) ; le coupable n'est dans aucun message
// diffusé avant `case-end`. Les déclarations d'un tour ne sont diffusées qu'à
// sa révélation, les verrous jamais avant `case-end` (seulement leur nombre).
// Aucun message ne porte d'horodatage ni d'échéance absolue : `remainingMs`.
// test.js relit TOUT le fil de chaque client pour le vérifier.
//
// Pas de reprise en pleine partie en V1 (comme croquis) : un joueur qui perd
// sa connexion est parti, le moteur décide de la suite.
'use strict';
const http = require('node:http');
const { WebSocketServer } = require('ws');
const E = require('./engine.js');
const { cleanAvatar } = require('./avatar.js');
const presenceJoueurs = require('./presence.js');

const PORT = process.env.PORT || 8096;
const AVATAR_DEFAUT = '🕵️';

// Délais raccourcis : POUR LES TESTS SEULEMENT (personne ne pose ces variables
// en production ; sans elles, les valeurs du moteur s'appliquent).
const ms = (v) => (Number(v) > 0 ? Number(v) : undefined);
const REGLES = {
  flashMs: ms(process.env.TEST_FLASH_MS),
  declareMs: ms(process.env.TEST_DECLARE_MS),
  deliberateMs: ms(process.env.TEST_DELIBERATE_MS),
  lastcallMs: ms(process.env.TEST_LASTCALL_MS),
  resultsMs: ms(process.env.TEST_RESULTS_MS),
};

// Débit par connexion, sur une fenêtre d'une seconde.
const DEBIT = 30;

const REFUS = { ...E.REFUS, NOT_PLAYING: 'aucune partie en cours', TOO_FAST: 'trop vite' };

const rooms = new Map();

const nouveauCode = () => {
  let c;
  do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join(''); }
  while (rooms.has(c));
  return c;
};

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcast = (room, obj) => room.players.forEach((p) => send(p.ws, obj));

// Un pseudo relayé aux autres : sans caractère de contrôle ni forçage du sens
// d'écriture (qui retourneraient l'affichage chez les autres). Le ZWJ reste.
const INVISIBLES = new RegExp('[' + [[0x00, 0x1f], [0x7f, 0x9f], [0x200e, 0x200f], [0x061c, 0x061c], [0x202a, 0x202e], [0x2066, 0x2069], [0x2028, 0x2029]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
const nettoyer = (s) => String(s == null ? '' : s).replace(INVISIBLES, '').trim();

// ------------------------------------------------------------- ce qui se dit
const joueur = (room, id) => room.players.find((p) => p.id === id) || null;
const scores = (v) => v.players;

function lobbyState(room) {
  return {
    type: 'lobby', code: room.code, phase: room.phase, max: E.MAX_PLAYERS, cases: room.cases,
    players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, host: p.id === room.hostId })),
  };
}

const identites = (room) => [...room.roster].map(([id, x]) => ({ id, name: x.name, avatar: x.avatar, host: id === room.hostId }));

function classement(room, ranking) {
  return ranking.map((r) => {
    const p = room.roster.get(r.id);
    return { id: r.id, name: p.name, avatar: p.avatar, rank: r.rank, score: r.score, found: r.found, left: r.left };
  });
}

// L'état public de l'affaire en cours (sans rien de privé).
function etat(room) {
  const v = E.view(room.game, Date.now());
  return {
    caseId: v.caseId, cases: v.cases, phase: v.phase, remainingMs: v.remainingMs, durationMs: v.durationMs,
    liars: v.liars, indic: v.indic, lineup: v.lineup, declared: v.declared, rounds: v.rounds, locked: v.locked,
    players: scores(v),
  };
}

// L'état complet, pour UN joueur : au lancement et à la demande. Le rôle (son
// fragment, ou le coupable pour un Faux Témoin) n'est que le sien.
function snapshot(room, p) {
  const v = E.view(room.game, Date.now());
  return {
    type: 'snapshot', code: room.code, you: p.id, host: room.hostId,
    attrs: E.ATTRS.map((a) => ({ id: a.id, values: a.values.slice() })),
    identities: identites(room),
    ...etat(room),
    role: E.roleView(room.game, p.id),
    audit: v.audit,
    complete: v.complete,
    ranking: v.ranking ? classement(room, v.ranking) : null,
  };
}

// Les événements du moteur → les messages. Rien n'est inventé ici.
function diffuser(room, events) {
  const g = room.game;
  for (const e of events) {
    if (e.type === 'case') {
      if (g.caseId !== e.caseId) continue;       // affaire déjà dépassée dans ce même lot
      const s = etat(room);
      broadcast(room, { type: 'case', ...s });
      // Le rôle : joueur par joueur. C'est LE message à ne jamais diffuser.
      room.players.forEach((p) => {
        const r = E.roleView(g, p.id);
        if (r) send(p.ws, { type: 'role', ...r });
      });
    } else if (e.type === 'phase') {
      if (g.caseId !== e.caseId || g.phase !== e.phase) continue;
      const s = etat(room);
      broadcast(room, { type: 'phase', caseId: s.caseId, phase: s.phase, remainingMs: s.remainingMs, durationMs: s.durationMs, rounds: s.rounds, locked: s.locked });
    } else if (e.type === 'declared') {
      if (g.caseId !== e.caseId || !['declare1', 'declare2'].includes(g.phase)) continue;
      broadcast(room, { type: 'declared', caseId: e.caseId, declared: E.view(g).declared });
    } else if (e.type === 'locked') {
      if (g.caseId !== e.caseId || g.phase === 'results' || g.phase === 'end') continue;
      broadcast(room, { type: 'locked', caseId: e.caseId, locked: E.view(g).locked });
    } else if (e.type === 'results') {
      if (g.caseId !== e.caseId || g.phase !== 'results') continue;
      const v = E.view(g, Date.now());
      broadcast(room, {
        type: 'case-end', caseId: v.caseId, cases: v.cases, audit: v.audit, rounds: v.rounds,
        players: scores(v), remainingMs: v.remainingMs, last: v.caseId >= v.cases,
      });
    } else if (e.type === 'left') {
      broadcast(room, { type: 'left', id: e.id, host: room.hostId, players: scores(E.view(g)) });
    } else if (e.type === 'end') {
      terminer(room, e);
    }
  }
}

function terminer(room, e) {
  clearTimeout(room.timer);
  room.timer = null;
  room.phase = 'end';
  broadcast(room, { type: 'results', complete: e.complete, host: room.hostId, ranking: classement(room, e.ranking) });
}

// ------------------------------------------------------------- la minuterie
function planifier(room) {
  clearTimeout(room.timer);
  room.timer = null;
  if (room.phase !== 'playing' || !room.game) return;
  const d = E.nextDeadline(room.game);
  if (d == null) return;
  room.timer = setTimeout(() => echeance(room), Math.max(0, d - Date.now()));
}

function echeance(room) {
  room.timer = null;
  if (rooms.get(room.code) !== room || room.phase !== 'playing') return;
  diffuser(room, E.tick(room.game, Date.now()));
  planifier(room);
}

// ------------------------------------------------------------------ partie
function lancer(room) {
  room.game = E.createGame({
    players: room.players.map((p) => p.id),
    cases: room.cases,
    now: Date.now(),
    random: Math.random,
    regles: REGLES,
  });
  room.roster = new Map(room.players.map((p) => [p.id, { name: p.name, avatar: p.avatar }]));
  room.phase = 'playing';
  // L'identité de tous et le vocabulaire, une fois ; puis la première affaire
  // (et le rôle de chacun, à lui seul).
  room.players.forEach((p) => send(p.ws, {
    type: 'game', code: room.code, you: p.id, host: room.hostId, cases: room.game.cases,
    attrs: E.ATTRS.map((a) => ({ id: a.id, values: a.values.slice() })),
    identities: identites(room),
  }));
  diffuser(room, room.game.startEvents);
  planifier(room);
}

function debit(ws) {
  const now = Date.now();
  const x = ws.debit || (ws.debit = { depuis: now, n: 0 });
  if (now - x.depuis >= 1000) { x.depuis = now; x.n = 0; }
  x.n += 1;
  return x.n <= DEBIT;
}

// ---------------------------------------------------------------- transport
const server = http.createServer((req, res) => {
  // Render veut une réponse HTTP pour son health check.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('temoin-server ok\n');
});
// 64 Ko : un join avec une photo de profil (≤ 12 Ko décodés) tient largement.
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
// Présence applicative : un onglet gelé ne reste pas compté dans sa room (voir
// presence.js). Le module ne fait que fermer le socket ; le départ habituel fait le reste.
const presence = presenceJoueurs.attach(wss);

wss.on('connection', (ws) => {
  let room = null, me = null;
  const fail = (message) => send(ws, { type: 'error', message });
  const refuser = (action, caseId, reason) => send(ws, {
    type: 'refused', action, caseId: Number.isInteger(caseId) ? caseId : null, reason, message: REFUS[reason] || reason,
  });
  // Une trame trop grosse fait émettre `error` au socket, puis `ws` le ferme ;
  // sans cet écouteur, l'erreur non traitée ferait tomber TOUT le serveur.
  ws.on('error', () => {});

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return fail('message illisible'); }
    if (!msg || typeof msg !== 'object') return fail('message illisible');
    if (presence.consume(ws, msg)) return;   // { action: 'presence' } : jamais « pas encore dans une partie »
    if (!debit(ws)) return refuser(msg.action, msg.caseId, 'TOO_FAST');
    const a = msg.action;

    if (a === 'join') {
      if (me) return fail('déjà dans une partie');
      const name = nettoyer(msg.name).slice(0, 16) || 'Joueur';
      // Emoji, ou photo de profil revalidée : voir avatar.js.
      const avatar = cleanAvatar(msg.avatar, AVATAR_DEFAUT);
      let r;
      if (msg.code) {
        r = rooms.get(String(msg.code).toUpperCase().trim());
        if (!r) return fail('aucune partie avec ce code');
        if (r.phase !== 'lobby') return fail('partie déjà commencée');
        if (r.players.length >= E.MAX_PLAYERS) return fail('partie complète');
      } else {
        const c = nouveauCode();
        r = { code: c, players: [], hostId: null, phase: 'lobby', cases: E.DEFAULT_CASES, game: null, roster: null, timer: null };
        rooms.set(c, r);
      }
      let id;
      do { id = Math.random().toString(36).slice(2, 9); } while (id === E.INDIC || r.players.some((p) => p.id === id));
      room = r;
      me = { id, ws, name, avatar };
      room.players.push(me);
      if (!room.hostId) room.hostId = me.id;
      send(ws, { type: 'you', id: me.id, code: room.code, host: room.hostId === me.id });
      broadcast(room, lobbyState(room));
      return;
    }

    if (a === 'resume') return fail('reprise non disponible : rejoins une nouvelle partie');

    if (!room || !me) return fail('pas encore dans une partie');

    if (a === 'cases') {
      if (me.id !== room.hostId) return fail("seul l'hôte règle la partie");
      if (room.phase === 'playing') return;
      if (!E.CASES.includes(msg.cases)) return fail(`nombre d'affaires : ${E.CASES.join(', ')}`);
      room.cases = msg.cases;
      return broadcast(room, lobbyState(room));
    }

    if (a === 'start') {
      if (me.id !== room.hostId) return fail("seul l'hôte lance la partie");
      if (room.phase === 'playing') return fail('partie déjà en cours');
      if (room.players.length < E.MIN_PLAYERS) return fail(`il faut au moins ${E.MIN_PLAYERS} joueurs`);
      if (msg.cases !== undefined) {
        if (!E.CASES.includes(msg.cases)) return fail(`nombre d'affaires : ${E.CASES.join(', ')}`);
        room.cases = msg.cases;
      }
      return lancer(room);                  // depuis le salon, ou la fin (revanche)
    }

    if (a === 'lobby') {
      if (me.id !== room.hostId) return fail("seul l'hôte ramène au salon");
      if (room.phase !== 'end') return;
      room.phase = 'lobby';
      room.game = null;
      room.roster = null;
      return broadcast(room, lobbyState(room));
    }

    if (a === 'snapshot') {
      if (!room.game) return send(ws, lobbyState(room));
      return send(ws, snapshot(room, me));
    }

    if (a === 'declare') {
      if (room.phase !== 'playing') return refuser(a, msg.caseId, 'NOT_PLAYING');
      const decl = msg.pass === true ? null : { attr: msg.attr, value: msg.value };
      const r = E.declare(room.game, me.id, msg.caseId, decl, Date.now());
      diffuser(room, r.events);
      if (!r.ok) refuser(a, msg.caseId, r.reason);
      return planifier(room);
    }

    if (a === 'lock') {
      if (room.phase !== 'playing') return refuser(a, msg.caseId, 'NOT_PLAYING');
      const r = E.lock(room.game, me.id, msg.caseId, msg.suspect, msg.accuse, Date.now());
      diffuser(room, r.events);
      if (!r.ok) refuser(a, msg.caseId, r.reason);
      return planifier(room);
    }

    if (a === 'next') {
      if (me.id !== room.hostId) return fail("seul l'hôte fait avancer");
      if (room.phase !== 'playing') return;
      diffuser(room, E.next(room.game, Date.now()));
      return planifier(room);
    }

    fail('action inconnue');
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.players = room.players.filter((p) => p !== me);
    if (!room.players.length) {
      clearTimeout(room.timer);
      room.timer = null;
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === me.id) room.hostId = room.players[0].id;
    if (room.phase === 'playing') {
      diffuser(room, E.leave(room.game, me.id, Date.now()));
      return planifier(room);
    }
    broadcast(room, lobbyState(room));     // salon, ou écran de fin (`phase: 'end'`)
  });
});

server.listen(PORT, () => console.log(`temoin-server à l'écoute sur :${PORT}`));

module.exports = { server, wss, rooms, DEBIT };
