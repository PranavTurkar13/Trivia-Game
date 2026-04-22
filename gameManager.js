const questions = require('./questions.json');

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const DRAW_WORDS = [
  'elephant', 'pizza', 'rocket', 'guitar', 'volcano', 'submarine',
  'cactus', 'rainbow', 'robot', 'castle', 'bicycle', 'umbrella',
  'diamond', 'penguin', 'tornado', 'popcorn', 'dragon', 'trophy',
  'lighthouse', 'snowman'
];

class GameManager {
  constructor() {
    this.rooms = {};
    this.playerRoom = {};
  }

  createRoom(hostId) {
    const code = generateCode();
    this.rooms[code] = {
      code,
      hostId,
      players: {},       // socketId -> { name, id, joinOrder }
      scores: {},        // socketId -> number
      questionIndex: 0,
      phase: 'lobby',
      answers: {},
      // Drawing
      drawerIndex: 0,    // increments sequentially through join order
      currentWord: null,
      drawerId: null,
      drawerName: null,
      correctGuessers: [],
      drawStartTime: null,
      drawTimeLimit: 60,
      playerJoinOrder: [], // ordered list of socketIds
    };
    this.playerRoom[hostId] = code;
    return this.rooms[code];
  }

  addPlayer(roomCode, socketId, name) {
    const room = this.rooms[roomCode];
    if (!room) return { success: false, message: 'Room not found' };
    if (room.phase !== 'lobby') return { success: false, message: 'Game already started' };
    if (Object.values(room.players).find(p => p.name === name))
      return { success: false, message: 'Name already taken' };
    room.players[socketId] = { name, id: socketId };
    room.scores[socketId] = 0;
    room.playerJoinOrder.push(socketId);
    this.playerRoom[socketId] = roomCode;
    return { success: true };
  }

  getPlayers(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return [];
    return Object.values(room.players).map(p => ({
      name: p.name,
      score: room.scores[p.id] || 0,
    }));
  }

  startGame(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;
    room.phase = 'playing';
    room.questionIndex = 0;
    room.answers = {};
    return room;
  }

  getCurrentQuestion(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;
    const q = questions[room.questionIndex];
    if (!q) return null;
    return { ...q, number: room.questionIndex + 1, total: questions.length };
  }

  submitAnswer(roomCode, socketId, answer) {
    const room = this.rooms[roomCode];
    if (!room || room.answers[socketId]) return null;
    const q = questions[room.questionIndex];
    const correct = answer === q.answer;
    room.answers[socketId] = answer;
    if (correct) room.scores[socketId] = (room.scores[socketId] || 0) + 100;
    return { correct, points: correct ? 100 : 0 };
  }

  nextQuestion(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return false;
    room.questionIndex++;
    room.answers = {};
    if (room.questionIndex >= questions.length) {
      room.phase = 'over';
      return false;
    }
    return true;
  }

  getLeaderboard(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return [];
    return Object.values(room.players)
      .map(p => ({ name: p.name, score: room.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
  }

  // ── Drawing round ──

  startDrawingRound(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;

    // Use playerJoinOrder for sequential rotation
    const orderIds = room.playerJoinOrder.filter(id => room.players[id]);
    if (orderIds.length === 0) return null;

    const drawerSocketId = orderIds[room.drawerIndex % orderIds.length];
    const drawer = room.players[drawerSocketId];
    if (!drawer) return null;

    const word = DRAW_WORDS[Math.floor(Math.random() * DRAW_WORDS.length)];

    room.currentWord     = word;
    room.drawerId        = drawerSocketId;
    room.drawerName      = drawer.name;
    room.drawerIndex     += 1;           // advance for next drawing round
    room.correctGuessers = [];
    room.drawStartTime   = Date.now();
    room.phase           = 'drawing';

    return { drawerId: drawerSocketId, drawerName: drawer.name, word };
  }

  // Returns { correct, points, allGuessed }
  checkGuess(roomCode, socketId, guess) {
    const room = this.rooms[roomCode];
    if (!room || room.phase !== 'drawing') return null;

    const guesser = room.players[socketId];
    if (!guesser) return null;

    // Drawer can't guess their own word
    if (socketId === room.drawerId) return null;

    // Already guessed correctly
    if (room.correctGuessers.includes(socketId)) return null;

    const correct = guess.trim().toLowerCase() === room.currentWord.toLowerCase();

    if (correct) {
      room.correctGuessers.push(socketId);

      // Speed-based scoring:
      // 1st correct = 1000 pts, 2nd = 800, 3rd = 600, minimum 200
      const points = Math.max(1000 - (room.correctGuessers.length - 1) * 200, 200);
      room.scores[socketId] = (room.scores[socketId] || 0) + points;

      // Drawer earns 80 pts per correct guesser
      room.scores[room.drawerId] = (room.scores[room.drawerId] || 0) + 80;

      // Check if ALL non-drawer players have guessed correctly
      const nonDrawers = Object.keys(room.players).filter(id => id !== room.drawerId);
      const allGuessed = nonDrawers.every(id => room.correctGuessers.includes(id));

      return { correct: true, points, allGuessed };
    }

    return { correct: false, allGuessed: false };
  }

  endDrawingRound(roomCode) {
    const room = this.rooms[roomCode];
    if (!room) return null;
    room.phase = 'playing';
    const word = room.currentWord;
    room.currentWord     = null;
    room.correctGuessers = [];
    return { leaderboard: this.getLeaderboard(roomCode), word };
  }

  removePlayer(socketId) {
    const roomCode = this.playerRoom[socketId];
    delete this.playerRoom[socketId];
    if (!roomCode) return null;
    const room = this.rooms[roomCode];
    if (!room) return null;
    if (room.hostId === socketId) return null;
    if (room.players[socketId]) {
      delete room.players[socketId];
      // Remove from join order too
      room.playerJoinOrder = room.playerJoinOrder.filter(id => id !== socketId);
    }
    return { roomCode };
  }
}

module.exports = GameManager;