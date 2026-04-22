require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // later replace with your Vercel URL
    methods: ["GET", "POST"]
  }
});
const gm = new GameManager();

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('host-create-room', () => {
    const room = gm.createRoom(socket.id);
    socket.join(room.code);
    socket.emit('room-created', { code: room.code });
  });

  socket.on('player-join', ({ roomCode, name }) => {
    const result = gm.addPlayer(roomCode, socket.id, name);
    if (!result.success) return socket.emit('join-error', result.message);
    socket.join(roomCode);
    socket.emit('join-success', { name });
    io.to(roomCode).emit('player-list', gm.getPlayers(roomCode));
  });

  socket.on('host-start-game', ({ roomCode }) => {
    const room = gm.startGame(roomCode);
    if (!room) return;
    io.to(roomCode).emit('game-started');
    sendQuestion(roomCode);
  });

  socket.on('submit-answer', ({ roomCode, answer }) => {
    const result = gm.submitAnswer(roomCode, socket.id, answer);
    if (result) socket.emit('answer-received', { correct: result.correct, points: result.points });
  });

  socket.on('host-next-question', ({ roomCode }) => {
    const hasMore = gm.nextQuestion(roomCode);
    if (hasMore) {
      sendQuestion(roomCode);
    } else {
      io.to(roomCode).emit('game-over', { leaderboard: gm.getLeaderboard(roomCode) });
    }
  });

  // ── Drawing round ──

  socket.on('host-start-drawing', ({ roomCode }) => {
    const info = gm.startDrawingRound(roomCode);
    if (!info) return console.log('startDrawingRound failed');

    const room = gm.rooms[roomCode];
    const totalPlayers = Object.keys(room.players).length;
    const drawerNumber = room.drawerIndex; // already incremented
    const totalDrawers = Object.keys(room.players).length;

    // Step 1 — everyone switches to drawing screen
    io.to(roomCode).emit('drawing-round-start', {
      drawerName:   info.drawerName,
      drawerId:     info.drawerId,
      timeLimit:    60,
      drawerNumber, // e.g. "Drawer 2 of 4"
      totalDrawers,
    });

    // Step 2 — tell drawer their word (after screen is set up)
    setTimeout(() => {
      io.to(info.drawerId).emit('you-are-drawer', { word: info.word });
    }, 300);

    console.log(`Drawing — room:${roomCode} drawer:${info.drawerName} word:${info.word}`);
  });

  socket.on('host-end-drawing', ({ roomCode }) => {
    const result = gm.endDrawingRound(roomCode);
    if (!result) return;
    io.to(roomCode).emit('drawing-scores', {
      leaderboard: result.leaderboard,
      word:        result.word,
    });
  });

  socket.on('draw-stroke', ({ roomCode, stroke }) => {
    socket.to(roomCode).emit('canvas-stroke', stroke);
  });

  socket.on('canvas-clear', ({ roomCode }) => {
    socket.to(roomCode).emit('canvas-cleared');
  });

  socket.on('submit-guess', ({ roomCode, guess }) => {
    const result = gm.checkGuess(roomCode, socket.id, guess);
    if (!result) return;

    const player = gm.rooms[roomCode]?.players[socket.id];
    const name   = player?.name || 'Someone';

    if (result.correct) {
      io.to(roomCode).emit('guess-correct', {
        name,
        points: result.points,
        word:   gm.rooms[roomCode]?.currentWord,
      });

      // If ALL non-drawer players guessed correctly → auto end round
      if (result.allGuessed) {
        const ended = gm.endDrawingRound(roomCode);
        if (ended) {
          io.to(roomCode).emit('drawing-scores', {
            leaderboard: ended.leaderboard,
            word:        ended.word,
            autoEnded:   true,
          });
        }
      }
    } else {
      io.to(roomCode).emit('guess-message', { name, text: guess });
    }
  });

  socket.on('host-force-end', ({ roomCode }) => {
    io.to(roomCode).emit('game-over', { leaderboard: gm.getLeaderboard(roomCode) });
  });

  socket.on('disconnect', () => {
    const info = gm.removePlayer(socket.id);
    if (info?.roomCode) {
      io.to(info.roomCode).emit('player-list', gm.getPlayers(info.roomCode));
    }
  });
});

function sendQuestion(roomCode) {
  const q = gm.getCurrentQuestion(roomCode);
  if (!q) return;
  io.to(roomCode).emit('new-question', {
    text:      q.question,
    options:   q.options,
    number:    q.number,
    total:     q.total,
    timeLimit: 20,
  });
  setTimeout(() => {
    io.to(roomCode).emit('round-over', {
      correctAnswer: q.answer,
      leaderboard:   gm.getLeaderboard(roomCode),
    });
  }, 20000);
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));