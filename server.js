// temoin-server — serveur arbitre de « Faux Témoin » (« l'Interrogatoire »).
//
// Même forme que les autres serveurs du portfolio (croquis, roquette,
// qui-ment…) : un seul WebSocket, du JSON, des rooms à code de 4 lettres, et
// une règle d'or — LE CLIENT N'A AUCUNE AUTORITÉ. Il envoie des intentions
// (« j'ai répondu », « prêt à voter », « je vote pour Bob ») ; engine.js
// décide de tout ce qui touche au jeu.
//
// Ce fichier ORCHESTRE le moteur, il ne recopie aucune de ses règles :
//   - une partie = E.createGame() ; tours de parole, votes, dernière chance et
//     départs passent par E.answered(), E.ready(), E.vote(), E.guess(), E.leave() ;
//   - UNE minuterie par room, posée sur E.nextDeadline() ; à l'échéance,
//     E.tick(Date.now()), puis on la repose ;
//   - les événements du moteur deviennent des messages, et c'est tout.
//
// LA SCÈNE ET LES RÔLES SONT LES SECRETS DE CE JEU. Le rôle part joueur par
// joueur (`role`, même forme pour tous) ; la scène aussi (`scene`, au flash :
// `scene: null` pour le Faux Témoin) ; les 4 versions de la dernière chance
// au seul Faux Témoin démasqué (`options`). Les votes ne sont diffusés qu'à
// la révélation (avant : QUI a voté). Aucun message ne porte d'horodatage ni
// d'échéance absolue : `remainingMs`. test.js relit TOUT le fil de chaque
// client pour le vérifier.
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
// en production ; sans elles, les valeurs du moteur s'appliquent). La durée du
// flash, elle, se règle au salon (5, 8 ou 10 s) : TEST_FLASH_MS ne sert qu'à
// raccourcir les tests.
const ms = (v) => (Number(v) > 0 ? Number(v) : undefined);
const REGLES = {
  roleMs: ms(process.env.TEST_ROLE_MS),
  flashMs: ms(process.env.TEST_FLASH_MS),
  askMs: process.env.TEST_ASK_MS != null ? Number(process.env.TEST_ASK_MS) : undefined,
  answerMs: ms(process.env.TEST_ANSWER_MS),
  debateMs: ms(process.env.TEST_DEBATE_MS),
  voteMs: ms(process.env.TEST_VOTE_MS),
  verdictMs: ms(process.env.TEST_VERDICT_MS),
  guessMs: ms(process.env.TEST_GUESS_MS),
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
function lobbyState(room) {
  return {
    type: 'lobby', code: room.code, phase: room.phase, min: E.MIN_PLAYERS, max: E.MAX_PLAYERS,
    rounds: room.rounds, flashMs: room.flashMs,
    players: room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, host: p.id === room.hostId })),
  };
}

const identites = (room) => [...room.roster].map(([id, x]) => ({ id, name: x.name, avatar: x.avatar, host: id === room.hostId }));

function classement(room, ranking) {
  return ranking.map((r) => {
    const p = room.roster.get(r.id);
    return { id: r.id, name: p.name, avatar: p.avatar, rank: r.rank, score: r.score, left: r.left };
  });
}

// L'état public de la manche en cours (sans rien de privé). Même forme à
// chaque phase : le client se redessine à partir de lui.
function etat(room) {
  const v = E.view(room.game, Date.now());
  return {
    roundId: v.roundId, rounds: v.rounds, phase: v.phase, remainingMs: v.remainingMs, durationMs: v.durationMs,
    title: v.title, question: v.question, asked: v.asked, ready: v.ready, voted: v.voted,
    verdict: v.verdict, liar: v.liar, reveal: v.reveal, players: v.players,
  };
}

// L'état complet, pour UN joueur, à la demande. Son rôle, et la scène ou les
// 4 versions seulement si le moteur les lui donnerait à cet instant.
function snapshot(room, p) {
  const g = room.game;
  const v = E.view(g, Date.now());
  const sc = E.sceneView(g, p.id);
  const op = E.optionsView(g, p.id);
  return {
    type: 'snapshot', code: room.code, you: p.id, host: room.hostId, flashMs: g.flashMs,
    identities: identites(room),
    ...etat(room),
    role: E.roleView(g, p.id),
    scene: sc ? sc.scene : null,
    options: op ? op.options : null,
    complete: v.complete,
    ranking: v.ranking ? classement(room, v.ranking) : null,
  };
}

// Les événements du moteur → les messages. Rien n'est inventé ici.
function diffuser(room, events) {
  const g = room.game;
  // Plusieurs phases dans un même lot (tours de parole enchaînés, fin
  // anticipée) : seule la DERNIÈRE est diffusée, avec l'état du moment.
  const dernierePhase = [...events].reverse().find((e) => e.type === 'phase');
  for (const e of events) {
    if (e.type === 'round') {
      if (g.roundId !== e.roundId) continue;
      broadcast(room, { type: 'round', roundId: g.roundId, rounds: g.rounds, title: g.round.title, players: E.view(g).players });
      // Le rôle : joueur par joueur. Même forme pour tous.
      room.players.forEach((p) => {
        const r = E.roleView(g, p.id);
        if (r) send(p.ws, { type: 'role', ...r });
      });
    } else if (e.type === 'phase') {
      if (e !== dernierePhase || g.roundId !== e.roundId || g.phase !== e.phase) continue;
      broadcast(room, { type: 'phase', ...etat(room) });
      // LA SCÈNE, joueur par joueur, au flash (le Faux Témoin : `scene: null`).
      if (g.phase === 'flash') {
        room.players.forEach((p) => {
          const sc = E.sceneView(g, p.id);
          if (sc) send(p.ws, { type: 'scene', ...sc });
        });
      }
      // LES 4 VERSIONS, au seul Faux Témoin démasqué.
      if (g.phase === 'guess') {
        room.players.forEach((p) => {
          const op = E.optionsView(g, p.id);
          if (op) send(p.ws, { type: 'options', ...op });
        });
      }
    } else if (e.type === 'ready') {
      if (g.roundId !== e.roundId || g.phase !== 'debate') continue;
      broadcast(room, { type: 'ready', roundId: e.roundId, ready: E.view(g).ready });
    } else if (e.type === 'voted') {
      if (g.roundId !== e.roundId || g.phase !== 'vote') continue;
      broadcast(room, { type: 'voted', roundId: e.roundId, voted: E.view(g).voted });
    } else if (e.type === 'left') {
      broadcast(room, { type: 'left', id: e.id, host: room.hostId, players: E.view(g).players });
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
    rounds: room.rounds,
    flashMs: room.flashMs,
    now: Date.now(),
    random: Math.random,
    regles: REGLES,
  });
  room.roster = new Map(room.players.map((p) => [p.id, { name: p.name, avatar: p.avatar }]));
  room.phase = 'playing';
  // L'identité de tous, une fois ; puis la première manche (et le rôle de
  // chacun, à lui seul).
  room.players.forEach((p) => send(p.ws, {
    type: 'game', code: room.code, you: p.id, host: room.hostId, rounds: room.game.rounds, flashMs: room.game.flashMs,
    identities: identites(room),
  }));
  diffuser(room, room.game.startEvents);
  planifier(room);
}

// Le réglage de l'hôte : rend un message d'erreur, ou null (et applique).
function regler(room, msg) {
  if (msg.rounds !== undefined && !E.ROUNDS.includes(msg.rounds)) return `nombre de manches : ${E.ROUNDS.join(', ')}`;
  if (msg.flashMs !== undefined && !E.FLASHES.includes(msg.flashMs)) return `durée du flash : ${E.FLASHES.map((x) => x / 1000).join(', ')} s`;
  if (msg.rounds !== undefined) room.rounds = msg.rounds;
  if (msg.flashMs !== undefined) room.flashMs = msg.flashMs;
  return null;
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
  const refuser = (action, roundId, reason) => send(ws, {
    type: 'refused', action: typeof action === 'string' ? action : null, roundId: Number.isInteger(roundId) ? roundId : null,
    reason, message: REFUS[reason] || reason,
  });
  // Une trame trop grosse fait émettre `error` au socket, puis `ws` le ferme ;
  // sans cet écouteur, l'erreur non traitée ferait tomber TOUT le serveur.
  ws.on('error', () => {});

  // Une action de jeu : le moteur répond { ok, reason, events }.
  const jouer = (a, roundId, r) => {
    diffuser(room, r.events);
    if (!r.ok) refuser(a, roundId, r.reason);
    planifier(room);
  };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return fail('message illisible'); }
    if (!msg || typeof msg !== 'object') return fail('message illisible');
    if (presence.consume(ws, msg)) return;   // { action: 'presence' } : jamais « pas encore dans une partie »
    if (!debit(ws)) return refuser(msg.action, msg.roundId, 'TOO_FAST');
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
        r = { code: c, players: [], hostId: null, phase: 'lobby', rounds: E.DEFAULT_ROUNDS, flashMs: E.DEFAULT_FLASH, game: null, roster: null, timer: null };
        rooms.set(c, r);
      }
      let id;
      do { id = Math.random().toString(36).slice(2, 9); } while (r.players.some((p) => p.id === id));
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

    if (a === 'settings') {
      if (me.id !== room.hostId) return fail("seul l'hôte règle la partie");
      if (room.phase === 'playing') return;
      const err = regler(room, msg);
      if (err) return fail(err);
      return broadcast(room, lobbyState(room));
    }

    if (a === 'start') {
      if (me.id !== room.hostId) return fail("seul l'hôte lance la partie");
      if (room.phase === 'playing') return fail('partie déjà en cours');
      if (room.players.length < E.MIN_PLAYERS) return fail(`il faut au moins ${E.MIN_PLAYERS} joueurs`);
      const err = regler(room, msg);
      if (err) return fail(err);
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

    if (['answered', 'ready', 'vote', 'guess'].includes(a)) {
      if (room.phase !== 'playing') return refuser(a, msg.roundId, 'NOT_PLAYING');
      const g = room.game, now = Date.now();
      if (a === 'answered') return jouer(a, msg.roundId, E.answered(g, me.id, msg.roundId, now));
      if (a === 'ready') return jouer(a, msg.roundId, E.ready(g, me.id, msg.roundId, msg.ready !== false, now));
      if (a === 'vote') return jouer(a, msg.roundId, E.vote(g, me.id, msg.roundId, msg.target, now));
      return jouer(a, msg.roundId, E.guess(g, me.id, msg.roundId, msg.option, now));
    }

    if (a === 'next') {
      if (me.id !== room.hostId) return fail("seul l'hôte fait avancer");
      if (room.phase !== 'playing') return;
      return jouer(a, room.game.roundId, E.next(room.game, Date.now()));
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
