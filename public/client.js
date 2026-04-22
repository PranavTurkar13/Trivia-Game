const socket = io();
let roomCode = '';
let timerInterval = null;
let hasAnswered = false;
let myName = '';

// Drawing state
let isDrawer = false;
let drawTool = 'pen';
let drawIsDrawing = false;
let drawLastX = 0, drawLastY = 0;
let drawTimerInterval = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderLeaderboard(containerId, data) {
  const el = document.getElementById(containerId);
  el.innerHTML = data.map((p, i) => `
    <div class="lb-row" style="animation-delay:${i * 0.07}s">
      <span class="display font-black text-xl ${i===0?'text-lime-400':i===1?'text-white/50':i===2?'text-amber-500':'text-white/25'}">${i+1}</span>
      <span style="flex:1;font-weight:500;color:rgba(255,255,255,0.9)">${p.name}</span>
      <span class="display font-black text-lg" style="color:#a3e635">${p.score} pts</span>
    </div>`).join('');
}

// ══ JOIN ══
document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('inp-code').value.trim().toUpperCase();
  const name = document.getElementById('inp-name').value.trim();
  const err  = document.getElementById('join-error');
  if (!code || code.length < 4) { err.textContent = 'Enter a valid room code'; err.classList.remove('hidden'); return; }
  if (!name) { err.textContent = 'Enter your name'; err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  roomCode = code;
  myName = name;
  socket.emit('player-join', { roomCode: code, name });
});

document.getElementById('inp-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('inp-name').focus();
});
document.getElementById('inp-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

socket.on('join-success', ({ name }) => {
  document.getElementById('lobby-name').textContent = `Playing as ${name}`;
  showScreen('screen-lobby');
});

socket.on('join-error', msg => {
  const err = document.getElementById('join-error');
  err.textContent = msg;
  err.classList.remove('hidden');
});

socket.on('player-list', players => {
  document.getElementById('player-list').innerHTML = players.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-radius:10px;background:rgba(255,255,255,0.04)">
      <span style="color:rgba(255,255,255,0.7);font-size:14px">${p.name}</span>
      <span style="color:#a3e635;font-size:12px;font-family:'Space Grotesk',sans-serif;font-weight:700">${p.score} pts</span>
    </div>`).join('');
});

// ══ QUESTION ══
socket.on('new-question', ({ text, options, number, total, timeLimit }) => {
  hasAnswered = false;
  showScreen('screen-question');
  document.getElementById('q-counter').textContent = `Q${number} / ${total}`;
  document.getElementById('q-text').textContent = text;
  document.getElementById('answer-feedback').classList.add('hidden');

  const ring = document.getElementById('timer-ring');
  const timerText = document.getElementById('timer-text');
  ring.style.stroke = '#a3e635';
  timerText.style.color = '#a3e635';

  const colors = ['border-blue-500/30','border-purple-500/30','border-amber-500/30','border-pink-500/30'];
  const labels = ['A','B','C','D'];

  document.getElementById('options-grid').innerHTML = options.map((opt, i) => `
    <button class="ans-btn ${colors[i]} rounded-xl px-5 py-4 text-sm flex items-center gap-3"
      onclick="submitAnswer(this, '${opt.replace(/'/g,"\\'").replace(/"/g,'&quot;')}')">
      <span class="display font-black text-white/30 text-base" style="min-width:20px">${labels[i]}</span>
      <span>${opt}</span>
    </button>`).join('');

  const circumference = 125.6;
  let t = timeLimit;
  clearInterval(timerInterval);
  ring.style.strokeDashoffset = 0;
  timerText.textContent = t;

  timerInterval = setInterval(() => {
    t--;
    timerText.textContent = t;
    ring.style.strokeDashoffset = circumference * ((timeLimit - t) / timeLimit);
    if (t <= 5) { ring.style.stroke = '#ef4444'; timerText.style.color = '#ef4444'; }
    if (t <= 0) { clearInterval(timerInterval); disableAnswers(); }
  }, 1000);
});

function submitAnswer(btn, answer) {
  if (hasAnswered) return;
  hasAnswered = true;
  clearInterval(timerInterval);
  btn.classList.add('selected');
  disableAnswers();
  socket.emit('submit-answer', { roomCode, answer });
}
window.submitAnswer = submitAnswer;

function disableAnswers() {
  document.querySelectorAll('.ans-btn').forEach(b => b.disabled = true);
}

socket.on('answer-received', ({ correct, points }) => {
  const fb = document.getElementById('answer-feedback');
  document.getElementById('feedback-icon').textContent = correct ? '🎉' : '😬';
  document.getElementById('feedback-text').textContent = correct ? 'Correct!' : 'Wrong!';
  document.getElementById('feedback-text').className = `display font-black text-xl ${correct ? 'text-lime-400' : 'text-red-400'}`;
  document.getElementById('feedback-points').textContent = correct ? `+${points} points` : 'No points this round';
  fb.classList.remove('hidden');
});

// ══ ROUND OVER ══
socket.on('round-over', ({ correctAnswer, leaderboard }) => {
  clearInterval(timerInterval);
  document.getElementById('correct-answer-text').textContent = correctAnswer;
  renderLeaderboard('result-leaderboard', leaderboard);
  showScreen('screen-result');
});

// ══ GAME OVER ══
socket.on('game-over', ({ leaderboard }) => {
  clearInterval(timerInterval);
  clearInterval(drawTimerInterval);
  renderLeaderboard('final-leaderboard', leaderboard);
  showScreen('screen-gameover');
});

// ══════════════════════════════════════════════
//  DRAWING ROUND
//  Both events arrive in order:
//  1. drawing-round-start  → sets up screen for everyone
//  2. you-are-drawer       → arrives 300ms later, applies drawer UI on top
// ══════════════════════════════════════════════

socket.on('drawing-round-start', ({ drawerName, timeLimit }) => {
  // Reset drawer flag — you-are-drawer will set it to true if needed
  isDrawer = false;
  setupDrawScreen(drawerName, timeLimit);
});

socket.on('you-are-drawer', ({ word }) => {
  // This fires 300ms after drawing-round-start, so screen is already set up
  isDrawer = true;

  // Show the secret word prominently
  const secretEl = document.getElementById('draw-secret-word');
  secretEl.textContent = word;
  secretEl.classList.remove('hidden');

  // Update label
  document.getElementById('draw-status-label').textContent = 'Your word to draw:';
  document.getElementById('draw-word-hint').textContent = '';

  // Show drawing tools
  document.getElementById('draw-tools').style.display = 'flex';

  // Disable guess input — drawer can't guess their own word
  const inp = document.getElementById('guess-input');
  inp.disabled = true;
  inp.placeholder = 'You are drawing!';
});

function setupDrawScreen(drawerName, timeLimit) {
  // Reset all state
  isDrawer = false;

  // Clear canvas
  const canvas = document.getElementById('draw-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

  // Clear chat
  document.getElementById('chat-box').innerHTML = '';

  // Hide round-over overlay
  document.getElementById('draw-over-overlay').style.display = 'none';

  // Reset header: hide secret word, show "X is drawing..."
  document.getElementById('draw-secret-word').classList.add('hidden');
  document.getElementById('draw-secret-word').textContent = '';
  document.getElementById('draw-status-label').textContent = drawerName + ' is drawing...';
  document.getElementById('draw-word-hint').textContent = 'Guess the word below!';

  // Hide tools — you-are-drawer will reveal them for the drawer
  document.getElementById('draw-tools').style.display = 'none';

  // Enable guess input for everyone (drawer's event will disable it)
  const inp = document.getElementById('guess-input');
  inp.disabled = false;
  inp.placeholder = 'Type your guess and press Enter';

  // Start countdown timer
  clearInterval(drawTimerInterval);
  let t = timeLimit;
  const timerEl = document.getElementById('draw-timer');
  timerEl.style.color = '#a3e635';
  timerEl.textContent = t;

  drawTimerInterval = setInterval(() => {
    t--;
    timerEl.textContent = Math.max(t, 0);
    if (t <= 10) timerEl.style.color = '#ef4444';
    if (t <= 0)  clearInterval(drawTimerInterval);
  }, 1000);

  // Switch to drawing screen
  showScreen('screen-draw');

  // Wire up canvas events
  initCanvas(canvas);
}

// ── Canvas ──
function initCanvas(canvas) {
  // Remove old listeners by replacing the element's event handlers
  canvas.onmousedown  = null;
  canvas.onmousemove  = null;
  canvas.onmouseup    = null;
  canvas.onmouseleave = null;
  canvas.ontouchstart = null;
  canvas.ontouchmove  = null;
  canvas.ontouchend   = null;

  const ctx = canvas.getContext('2d');

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }

  function doStroke(x0, y0, x1, y1) {
    const color  = drawTool === 'eraser'
      ? '#ffffff'
      : document.getElementById('color-picker').value;
    const size   = parseInt(document.getElementById('brush-size').value);
    const stroke = { x0, y0, x1, y1, color, size };
    applyStroke(ctx, stroke);
    socket.emit('draw-stroke', { roomCode, stroke });
  }

  canvas.onmousedown = e => {
    if (!isDrawer) return;
    drawIsDrawing = true;
    const p = getPos(e);
    drawLastX = p.x;
    drawLastY = p.y;
  };

  canvas.onmousemove = e => {
    if (!drawIsDrawing || !isDrawer) return;
    const p = getPos(e);
    doStroke(drawLastX, drawLastY, p.x, p.y);
    drawLastX = p.x;
    drawLastY = p.y;
  };

  canvas.onmouseup    = () => { drawIsDrawing = false; };
  canvas.onmouseleave = () => { drawIsDrawing = false; };

  canvas.ontouchstart = e => {
    if (!isDrawer) return;
    e.preventDefault();
    drawIsDrawing = true;
    const p = getPos(e);
    drawLastX = p.x;
    drawLastY = p.y;
  };

  canvas.ontouchmove = e => {
    if (!drawIsDrawing || !isDrawer) return;
    e.preventDefault();
    const p = getPos(e);
    doStroke(drawLastX, drawLastY, p.x, p.y);
    drawLastX = p.x;
    drawLastY = p.y;
  };

  canvas.ontouchend = () => { drawIsDrawing = false; };
}

function applyStroke(ctx, stroke) {
  ctx.beginPath();
  ctx.moveTo(stroke.x0, stroke.y0);
  ctx.lineTo(stroke.x1, stroke.y1);
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth   = stroke.size;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.stroke();
}

// Receive strokes from the drawer
socket.on('canvas-stroke', stroke => {
  const ctx = document.getElementById('draw-canvas').getContext('2d');
  applyStroke(ctx, stroke);
});

socket.on('canvas-cleared', () => {
  const canvas = document.getElementById('draw-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
});

// Tool controls
function setTool(t) {
  drawTool = t;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('btn-' + t);
  if (el) el.classList.add('active');
}
window.setTool = setTool;

function clearCanvas() {
  document.getElementById('draw-canvas').getContext('2d')
    .clearRect(0, 0, 680, 460);
  socket.emit('canvas-clear', { roomCode });
}
window.clearCanvas = clearCanvas;

// ── Guesses ──
document.getElementById('guess-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const val = e.target.value.trim();
  if (!val || isDrawer) return;
  socket.emit('submit-guess', { roomCode, guess: val });
  e.target.value = '';
});

function addChat(name, text, correct) {
  const box = document.getElementById('chat-box');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (correct ? ' correct' : '');
  div.innerHTML = `<span class="sender">${name}</span>${text}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

socket.on('guess-message', ({ name, text }) => addChat(name, text, false));

socket.on('guess-correct', ({ name, points, word }) => {
  addChat(name, `guessed it! +${points} pts`, true);
  document.getElementById('draw-word-hint').textContent = 'The word was: ' + word;
  if (name === myName) {
    const inp = document.getElementById('guess-input');
    inp.disabled = true;
    inp.placeholder = 'You got it!';
  }
});

// ── Drawing round over ──
socket.on('drawing-scores', ({ leaderboard, word }) => {
  clearInterval(drawTimerInterval);
  document.getElementById('draw-over-word').textContent = word ? `The word was: "${word}"` : '';
  document.getElementById('draw-over-leaderboard').innerHTML = leaderboard.map((p, i) => `
    <div class="lb-row" style="animation-delay:${i*0.07}s">
      <span class="display font-black text-xl ${i===0?'text-lime-400':i===1?'text-white/50':i===2?'text-amber-500':'text-white/25'}">${i+1}</span>
      <span style="flex:1;font-weight:500;color:rgba(255,255,255,0.9)">${p.name}</span>
      <span class="display font-black text-lg" style="color:#a3e635">${p.score} pts</span>
    </div>`).join('');
  const overlay = document.getElementById('draw-over-overlay');
  overlay.style.display = 'flex';
});