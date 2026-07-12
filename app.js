let game = new Chess();
let selectedSquare = null;
let playerColor = "w";
let maiaThinking = false;
let engine = null;
let boardFlipped = false;
let lastMoveFrom = null;
let lastMoveTo = null;
let gameResigned = false;
let resignedBy = null;
let gameTimedOut = false;
let timedOutColor = null;
let historyRecorded = false;

const MY_ELO = 250;
const MAIA_ELO = 250;
const STARTING_CLOCK_SECONDS = 600;

function freshStats() {
  return { brilliant: 0, great: 0, book: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0 };
}
let playerMoveStats = freshStats();
let maiaMoveStatsObj = freshStats();
let pendingMaiaGrading = null; // { preMoveValue, color, moveNumber }

let whiteTime = STARTING_CLOCK_SECONDS;
let blackTime = STARTING_CLOCK_SECONDS;
let whiteClockStarted = false;
let blackClockStarted = false;

function humanDelay() {
  const ms = 600 + Math.random() * 1600;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let currentMode = localStorage.getItem("chess_active_mode") || "unrated";
let gameToken = 0;

const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const whiteTurnTag = document.getElementById("white-turn-tag");
const blackTurnTag = document.getElementById("black-turn-tag");
const overlayEl = document.getElementById("game-over-overlay");
const overlayTitleEl = document.getElementById("overlay-title");
const overlaySubEl = document.getElementById("overlay-sub");
const yourStatsEl = document.getElementById("your-stats");
const maiaStatsEl = document.getElementById("maia-stats");
const yourAccuracyEl = document.getElementById("your-accuracy");
const maiaAccuracyEl = document.getElementById("maia-accuracy");
const historyEl = document.getElementById("history");
const yourClockEl = document.getElementById("your-clock");
const maiaClockEl = document.getElementById("maia-clock");
const moveListEl = document.getElementById("move-list");
const gameControlsEl = document.getElementById("game-controls");
const puzzleControlsEl = document.getElementById("puzzle-controls");

const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareId(file, rank) {
  return files[file] + rank;
}

function isGameLocked() {
  return game.game_over() || gameResigned || gameTimedOut;
}

// ---------- Puzzle mode ----------

let PUZZLES = []; // loaded from data/puzzles.json (real Lichess-sourced puzzles + a few starter mates)
let lastPuzzleFen = null; // avoid immediately repeating the same puzzle

let inPuzzleMode = false;
let puzzleGame = null;
let puzzleSolution = [];
let puzzleSolutionIndex = 0;
let puzzlePlayerColor = "w";
let puzzleRating = parseInt(localStorage.getItem("chess_puzzle_rating") || "400", 10);
let puzzleAwaitingReply = false;
let puzzleLocked = false; // true once solved or given up, until "Next" is clicked
let puzzleMissedAlready = false; // only penalize rating once per puzzle

async function loadPuzzleData() {
  try {
    const res = await fetch("./data/puzzles.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Empty or invalid puzzle data");
    PUZZLES = data;
    PUZZLES.sort((a, b) => a.rating - b.rating);
  } catch (err) {
    console.error("Failed to load puzzles.json — puzzle mode will be unavailable:", err);
    PUZZLES = [];
  }
}

// Picks the easiest puzzle whose rating is >= your current rating (so you always
// progress forward through increasing difficulty), skipping the one you just did.
function selectPuzzle() {
  let candidates = PUZZLES.filter((p) => p.rating >= puzzleRating && p.fen !== lastPuzzleFen);
  if (candidates.length === 0) candidates = PUZZLES.filter((p) => p.rating >= puzzleRating);
  if (candidates.length === 0) candidates = PUZZLES.filter((p) => p.fen !== lastPuzzleFen);
  if (candidates.length === 0) candidates = PUZZLES;
  return candidates[0]; // already sorted ascending, so first candidate is the nearest-hardest
}

function savePuzzleRating() {
  localStorage.setItem("chess_puzzle_rating", String(puzzleRating));
}

function loadNextPuzzle() {
  const puzzle = selectPuzzle();
  lastPuzzleFen = puzzle.fen;
  puzzleGame = new Chess(puzzle.fen);
  puzzleSolution = puzzle.solution.slice();
  puzzleSolutionIndex = 0;
  lastMoveFrom = null;
  lastMoveTo = null;
  puzzlePlayerColor = puzzleGame.turn();
  puzzleAwaitingReply = false;
  puzzleLocked = false;
  puzzleMissedAlready = false;
  selectedSquare = null;

  boardFlipped = puzzlePlayerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  // "You" shows your accumulating puzzle rating; "Maia" shows this puzzle's difficulty rating
  document.getElementById("your-rating").textContent = puzzleRating;
  document.getElementById("maia-rating").textContent = puzzle.rating;

  clearTurnTags();
  renderBoard();
  renderMoveList();
  updatePuzzleActionButton();
  statusEl.textContent = `Puzzle Rating ${puzzleRating} — find the best move for ${puzzlePlayerColor === "w" ? "White" : "Black"}.`;
  statusEl.classList.remove("status-hidden");
}

function updatePuzzleActionButton() {
  const btn = document.getElementById("puzzle-action-btn");
  if (!btn) return;
  btn.textContent = puzzleLocked ? "Next" : "Give Up";
}

function handlePuzzleAction() {
  if (puzzleLocked) {
    loadNextPuzzle();
  } else {
    giveUpPuzzle();
  }
}
window.handlePuzzleAction = handlePuzzleAction;

function enterPuzzleMode() {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  if (maiaThinking) return;
  if (PUZZLES.length === 0) {
    statusEl.textContent = "Puzzles failed to load — check that data/puzzles.json exists next to index.html.";
    statusEl.classList.remove("status-hidden");
    return;
  }
  inPuzzleMode = true;
  gameControlsEl.classList.add("hidden");
  puzzleControlsEl.classList.remove("hidden");
  loadNextPuzzle();
}
window.enterPuzzleMode = enterPuzzleMode;

function exitPuzzleMode() {
  inPuzzleMode = false;
  puzzleControlsEl.classList.add("hidden");
  gameControlsEl.classList.remove("hidden");
  selectedSquare = null;
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);

  document.getElementById("your-rating").textContent = MY_ELO;
  document.getElementById("maia-rating").textContent = MAIA_ELO;
  restoreLastMoveFromRealGame();

  renderBoard();
  renderMoveList();
  updateClockDisplays();
  if (isGameLocked()) {
    // popup will show if they reopen it; just leave board as-is
  } else {
    updateStatusForTurn();
  }
}

// Recomputes lastMoveFrom/lastMoveTo from the real game's move history (used when
// resuming a game or returning from puzzle mode, so the highlight is correct again).
function restoreLastMoveFromRealGame() {
  const verboseHistory = game.history({ verbose: true });
  if (verboseHistory.length > 0) {
    const last = verboseHistory[verboseHistory.length - 1];
    lastMoveFrom = last.from;
    lastMoveTo = last.to;
  } else {
    lastMoveFrom = null;
    lastMoveTo = null;
  }
}

function giveUpPuzzle() {
  if (!inPuzzleMode || puzzleLocked) return;
  puzzleLocked = true;
  // Play out the remaining solution moves so they can see the answer
  const sanParts = [];
  for (let i = puzzleSolutionIndex; i < puzzleSolution.length; i++) {
    const uci = puzzleSolution[i];
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4) : "q";
    const mv = puzzleGame.move({ from, to, promotion });
    if (mv) {
      sanParts.push(mv.san);
      lastMoveFrom = from;
      lastMoveTo = to;
    }
  }
  renderBoard();
  renderMoveList();
  updatePuzzleActionButton();
  statusEl.textContent = "Solution: " + sanParts.join(" ");
  statusEl.classList.remove("status-hidden");
}
window.giveUpPuzzle = giveUpPuzzle;

async function onPuzzleSquareClick(sq) {
  if (puzzleLocked || puzzleAwaitingReply) return;
  if (puzzleGame.turn() !== puzzlePlayerColor) return;

  if (selectedSquare === null) {
    const piece = puzzleGame.get(sq);
    if (piece && piece.color === puzzlePlayerColor) {
      selectedSquare = sq;
      renderBoard();
    }
    return;
  }
  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const from = selectedSquare;
  const to = sq;
  selectedSquare = null;

  const preFen = puzzleGame.fen();
  const moveResult = puzzleGame.move({ from, to, promotion: "q" });

  if (!moveResult) {
    const piece = puzzleGame.get(sq);
    if (piece && piece.color === puzzlePlayerColor) selectedSquare = sq;
    renderBoard();
    return;
  }

  const promotion = moveResult.promotion ? moveResult.promotion : "";
  const playedUci = from + to + promotion;
  const expectedUci = puzzleSolution[puzzleSolutionIndex];

  if (playedUci !== expectedUci) {
    // Wrong — undo, penalize once, let them try again
    puzzleGame.load(preFen);
    renderBoard();
    if (!puzzleMissedAlready) {
      puzzleMissedAlready = true;
      puzzleRating = Math.max(100, puzzleRating - 20);
      savePuzzleRating();
      document.getElementById("your-rating").textContent = puzzleRating;
    }
    statusEl.textContent = `Not quite — try again, or Give Up to see the answer. (Puzzle Rating ${puzzleRating})`;
    return;
  }

  // Correct!
  lastMoveFrom = from;
  lastMoveTo = to;
  renderBoard();
  renderMoveList();
  puzzleSolutionIndex++;

  if (puzzleSolutionIndex >= puzzleSolution.length) {
    puzzleLocked = true;
    if (!puzzleMissedAlready) {
      puzzleRating += 15;
      savePuzzleRating();
      document.getElementById("your-rating").textContent = puzzleRating;
    }
    statusEl.textContent = `Solved! Puzzle Rating ${puzzleRating}`;
    updatePuzzleActionButton();
    return;
  }

  // Auto-play the opponent's scripted reply
  puzzleAwaitingReply = true;
  await humanDelay();
  const replyUci = puzzleSolution[puzzleSolutionIndex];
  const rFrom = replyUci.slice(0, 2), rTo = replyUci.slice(2, 4);
  const rPromo = replyUci.length > 4 ? replyUci.slice(4) : "q";
  puzzleGame.move({ from: rFrom, to: rTo, promotion: rPromo });
  lastMoveFrom = rFrom;
  lastMoveTo = rTo;
  puzzleSolutionIndex++;
  renderBoard();
  renderMoveList();
  puzzleAwaitingReply = false;

  if (puzzleSolutionIndex >= puzzleSolution.length) {
    puzzleLocked = true;
    if (!puzzleMissedAlready) {
      puzzleRating += 15;
      savePuzzleRating();
      document.getElementById("your-rating").textContent = puzzleRating;
    }
    statusEl.textContent = `Solved! Puzzle Rating ${puzzleRating}`;
    updatePuzzleActionButton();
  } else {
    statusEl.textContent = `Puzzle Rating ${puzzleRating} — find the best move.`;
  }
}

// ---------- Status / turn tags ----------

function updateStatusForTurn() {
  if (inPuzzleMode || isGameLocked()) return;
  if (game.turn() === playerColor) {
    statusEl.textContent = "Your move.";
    statusEl.classList.remove("status-hidden");
  } else {
    statusEl.classList.add("status-hidden");
  }
  whiteTurnTag.classList.toggle("active", game.turn() === "w");
  blackTurnTag.classList.toggle("active", game.turn() === "b");
}

function clearTurnTags() {
  whiteTurnTag.classList.remove("active");
  blackTurnTag.classList.remove("active");
}

function toggleFlip() {
  boardFlipped = !boardFlipped;
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
  renderBoard();
}
window.toggleFlip = toggleFlip;

// ---------- Clocks ----------

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function updateClockDisplays() {
  const yourTime = playerColor === "w" ? whiteTime : blackTime;
  const maiaTime = playerColor === "w" ? blackTime : whiteTime;
  yourClockEl.textContent = formatClock(yourTime);
  maiaClockEl.textContent = formatClock(maiaTime);
}

function resetClocks() {
  whiteTime = STARTING_CLOCK_SECONDS;
  blackTime = STARTING_CLOCK_SECONDS;
  whiteClockStarted = false;
  blackClockStarted = false;
  updateClockDisplays();
}

function updateClockUnlocks() {
  const len = game.history().length;
  if (len >= 2) whiteClockStarted = true;
  if (len >= 3) blackClockStarted = true;
}

function tickClock() {
  if (inPuzzleMode || isGameLocked()) return;
  const turn = game.turn();
  if (turn === "w") {
    if (!whiteClockStarted) return;
    whiteTime = Math.max(0, whiteTime - 1);
    if (whiteTime === 0) return handleTimeout("w");
  } else {
    if (!blackClockStarted) return;
    blackTime = Math.max(0, blackTime - 1);
    if (blackTime === 0) return handleTimeout("b");
  }
  updateClockDisplays();
  saveCurrentGame();
}

function handleTimeout(loserColor) {
  if (isGameLocked()) return;
  gameTimedOut = true;
  timedOutColor = loserColor;
  maiaThinking = false;
  updateClockDisplays();
  saveCurrentGame();
  clearTurnTags();
  statusEl.classList.add("status-hidden");
  showGameOverPopup();
}

// ---------- Color assignment ----------

function assignNextColor() {
  let n = parseInt(localStorage.getItem("chess_games_started") || "0", 10);
  const color = n % 2 === 0 ? "w" : "b";
  localStorage.setItem("chess_games_started", String(n + 1));
  return color;
}

// ---------- Save / load ----------

function saveKey(mode) {
  return "chess_game_" + mode;
}

function saveCurrentGame() {
  localStorage.setItem(
    saveKey(currentMode),
    JSON.stringify({
      pgn: game.pgn(),
      resigned: gameResigned,
      resignedBy,
      timedOut: gameTimedOut,
      timedOutColor,
      historyRecorded,
      playerColor,
      whiteTime,
      blackTime,
      whiteClockStarted,
      blackClockStarted,
    })
  );
  localStorage.setItem("chess_active_mode", currentMode);
}

function loadGame(mode) {
  const raw = localStorage.getItem(saveKey(mode));
  const blank = {
    game: new Chess(), resigned: false, resignedBy: null, timedOut: false, timedOutColor: null,
    historyRecorded: false, playerColor: null,
    whiteTime: STARTING_CLOCK_SECONDS, blackTime: STARTING_CLOCK_SECONDS,
    whiteClockStarted: false, blackClockStarted: false,
  };
  if (!raw) return blank;
  try {
    const d = JSON.parse(raw);
    const loaded = new Chess();
    if (d.pgn && loaded.load_pgn(d.pgn)) {
      return {
        game: loaded, resigned: !!d.resigned, resignedBy: d.resignedBy || null,
        timedOut: !!d.timedOut, timedOutColor: d.timedOutColor || null,
        historyRecorded: !!d.historyRecorded, playerColor: d.playerColor || "w",
        whiteTime: typeof d.whiteTime === "number" ? d.whiteTime : STARTING_CLOCK_SECONDS,
        blackTime: typeof d.blackTime === "number" ? d.blackTime : STARTING_CLOCK_SECONDS,
        whiteClockStarted: !!d.whiteClockStarted, blackClockStarted: !!d.blackClockStarted,
      };
    }
  } catch (e) {
    console.warn("Couldn't restore saved " + mode + " game, starting fresh.", e);
  }
  return blank;
}

function resetForNewGame(mode) {
  currentMode = mode;
  gameToken++;
  maiaThinking = false;
  selectedSquare = null;
  gameResigned = false;
  resignedBy = null;
  gameTimedOut = false;
  timedOutColor = null;
  historyRecorded = false;
  playerMoveStats = freshStats();
  maiaMoveStatsObj = freshStats();
  pendingMaiaGrading = null;
}

function applyLoadedState(loaded) {
  game = loaded.game;
  gameResigned = loaded.resigned;
  resignedBy = loaded.resignedBy;
  gameTimedOut = loaded.timedOut;
  timedOutColor = loaded.timedOutColor;
  historyRecorded = loaded.historyRecorded;
  whiteTime = loaded.whiteTime;
  blackTime = loaded.blackTime;
  whiteClockStarted = loaded.whiteClockStarted;
  blackClockStarted = loaded.blackClockStarted;
  playerColor = loaded.playerColor !== null ? loaded.playerColor : assignNextColor();
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
  restoreLastMoveFromRealGame();
  document.getElementById("your-rating").textContent = MY_ELO;
  document.getElementById("maia-rating").textContent = MAIA_ELO;
}

function selectMode(mode) {
  document.querySelectorAll(".menu-item.open").forEach((item) => item.classList.remove("open"));
  if (inPuzzleMode) exitPuzzleMode();
  if (mode === currentMode) return;

  saveCurrentGame();
  const loaded = loadGame(mode);
  resetForNewGame(mode);
  applyLoadedState(loaded);
  saveCurrentGame();

  closeOverlay();
  clearTurnTags();
  renderBoard();
  renderMoveList();
  updateClockDisplays();

  if (isGameLocked()) {
    showGameOverPopup();
  } else {
    updateStatusForTurn();
    if (game.turn() !== playerColor) runMaiaTurn();
  }
}
window.selectMode = selectMode;

function newGameCurrentMode() {
  resetForNewGame(currentMode);
  game = new Chess();
  playerColor = assignNextColor();
  boardFlipped = playerColor === "b";
  document.getElementById("board-wrap").classList.toggle("flipped", boardFlipped);
  lastMoveFrom = null;
  lastMoveTo = null;
  resetClocks();
  saveCurrentGame();

  closeOverlay();
  clearTurnTags();
  renderBoard();
  renderMoveList();
  updateStatusForTurn();
  updateClockDisplays();

  if (game.turn() !== playerColor) runMaiaTurn();
}
window.newGameCurrentMode = newGameCurrentMode;

function resign() {
  if (inPuzzleMode || isGameLocked()) return;
  gameResigned = true;
  resignedBy = playerColor;
  maiaThinking = false;
  saveCurrentGame();
  statusEl.classList.add("status-hidden");
  clearTurnTags();
  showGameOverPopup();
}
window.resign = resign;

// ---------- Board rendering ----------

function pieceImage(piece) {
  return `./${piece.type}${piece.color}.png`;
}

let draggingSquare = null; // square whose piece is currently being visually dragged

function renderBoard() {
  const activeGame = inPuzzleMode ? puzzleGame : game;
  boardEl.innerHTML = "";
  const boardData = activeGame.board();

  const legalTargets = selectedSquare
    ? activeGame.moves({ square: selectedSquare, verbose: true }).map((m) => m.to)
    : [];

  const rankOrder = boardFlipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const fileOrder = boardFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  for (const displayRank of rankOrder) {
    for (const fileIdx of fileOrder) {
      const sq = squareId(fileIdx, displayRank);
      const rowIdx = 8 - displayRank;
      const piece = boardData[rowIdx][fileIdx];

      const cell = document.createElement("div");
      cell.className = "square " + (((fileIdx + displayRank) % 2 === 0) ? "dark" : "light");
      cell.dataset.square = sq;
      if (sq === selectedSquare) cell.classList.add("selected");
      if (sq === lastMoveFrom || sq === lastMoveTo) cell.classList.add("last-move");
      if (legalTargets.includes(sq)) {
        cell.classList.add("legal-target");
        if (piece) cell.classList.add("has-piece");
      }

      if (piece && sq !== draggingSquare) {
        const img = document.createElement("img");
        img.src = pieceImage(piece);
        img.className = "piece";
        img.draggable = false;
        cell.appendChild(img);
      }

      boardEl.appendChild(cell);
    }
  }
}

function onBoardClick(sq) {
  if (inPuzzleMode) return onPuzzleSquareClick(sq);
  return onSquareClick(sq);
}

// ---------- Drag to move (touch-first, works with mouse too via Pointer Events) ----------

const DRAG_THRESHOLD_PX = 8; // how far the finger must move before it counts as a drag, not a tap

let pointerTrack = null; // { pointerId, startSq, startX, startY, isDraggable, dragging }
let ghostEl = null;
let dragHoverSq = null;

function pieceIsDraggableAt(sq) {
  if (inPuzzleMode) {
    if (puzzleLocked || puzzleAwaitingReply || !puzzleGame) return false;
    const piece = puzzleGame.get(sq);
    return !!piece && piece.color === puzzlePlayerColor && puzzleGame.turn() === puzzlePlayerColor;
  }
  if (maiaThinking || isGameLocked()) return false;
  const piece = game.get(sq);
  return !!piece && piece.color === playerColor && game.turn() === playerColor;
}

function squareFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest(".square") : null;
  return cell ? cell.dataset.square : null;
}

function createGhost(sq, x, y) {
  const activeGame = inPuzzleMode ? puzzleGame : game;
  const piece = activeGame.get(sq);
  if (!piece) return;

  ghostEl = document.createElement("img");
  ghostEl.src = pieceImage(piece);
  ghostEl.className = "drag-ghost";
  const size = boardEl.getBoundingClientRect().width / 8;
  ghostEl.style.width = size + "px";
  ghostEl.style.height = size + "px";
  document.body.appendChild(ghostEl);
  moveGhost(x, y);
}

function moveGhost(x, y) {
  if (!ghostEl) return;
  const half = ghostEl.getBoundingClientRect().width / 2;
  ghostEl.style.transform = `translate(${x - half}px, ${y - half}px)`;
}

function removeGhost() {
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
}

function setDragHover(sq) {
  if (dragHoverSq === sq) return;
  const prev = boardEl.querySelector('.square.drag-hover');
  if (prev) prev.classList.remove("drag-hover");
  dragHoverSq = sq;
  if (sq) {
    const cell = boardEl.querySelector(`.square[data-square="${sq}"]`);
    if (cell) cell.classList.add("drag-hover");
  }
}

boardEl.addEventListener("pointerdown", (e) => {
  const cell = e.target.closest(".square");
  if (!cell) return;
  const sq = cell.dataset.square;

  pointerTrack = {
    pointerId: e.pointerId,
    startSq: sq,
    startX: e.clientX,
    startY: e.clientY,
    isDraggable: pieceIsDraggableAt(sq),
    dragging: false,
  };
});

document.addEventListener("pointermove", (e) => {
  if (!pointerTrack || e.pointerId !== pointerTrack.pointerId) return;

  const dx = e.clientX - pointerTrack.startX;
  const dy = e.clientY - pointerTrack.startY;

  if (!pointerTrack.dragging) {
    if (!pointerTrack.isDraggable) return; // plain tap tracking only, no visuals
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    // Drag begins now
    pointerTrack.dragging = true;
    draggingSquare = pointerTrack.startSq;
    selectedSquare = pointerTrack.startSq;
    renderBoard();
    createGhost(pointerTrack.startSq, e.clientX, e.clientY);
  }

  e.preventDefault();
  moveGhost(e.clientX, e.clientY);
  setDragHover(squareFromPoint(e.clientX, e.clientY));
}, { passive: false });

function endPointerTrack(e) {
  if (!pointerTrack || e.pointerId !== pointerTrack.pointerId) return;
  const track = pointerTrack;
  pointerTrack = null;

  if (track.dragging) {
    removeGhost();
    setDragHover(null);
    draggingSquare = null;
    const dropSq = squareFromPoint(e.clientX, e.clientY);

    if (!dropSq || dropSq === track.startSq) {
      renderBoard(); // just re-render at rest; selectedSquare stays set (matches tap-to-select behavior)
    } else {
      onBoardClick(dropSq); // selectedSquare is already track.startSq, so this attempts the move
    }
  } else {
    // Pure tap
    onBoardClick(track.startSq);
  }
}

document.addEventListener("pointerup", endPointerTrack);
document.addEventListener("pointercancel", (e) => {
  if (!pointerTrack || e.pointerId !== pointerTrack.pointerId) return;
  removeGhost();
  setDragHover(null);
  draggingSquare = null;
  pointerTrack = null;
  renderBoard();
});

// ---------- Real move list (proper SAN, White-Black-White-Black copy order) ----------

function renderMoveList() {
  const activeGame = inPuzzleMode ? puzzleGame : game;
  const hist = activeGame ? activeGame.history() : [];
  let html = "";
  for (let i = 0; i < hist.length; i += 2) {
    const moveNum = i / 2 + 1;
    html += `<span class="movenum">${moveNum}.</span> <span class="move">${hist[i]}</span> `;
    if (hist[i + 1]) html += `<span class="move">${hist[i + 1]}</span> `;
  }
  moveListEl.innerHTML = html;
  const scrollParent = moveListEl.closest(".moves");
  if (scrollParent) scrollParent.scrollLeft = scrollParent.scrollWidth;
}

// ---------- Move classification ----------

function classifyMoveGeneric({ preValue, postValue, moveUci, preTopMove, preMoveProb, moverColor, wasMate, moveNumber, skipTopMatch }) {
  const delta = moverColor === "w" ? postValue - preValue : preValue - postValue;
  const deltaPct = delta * 100;

  if (wasMate) return "best";
  if (moveNumber <= 6 && preMoveProb >= 0.35) return "book";
  if (preMoveProb < 0.05 && deltaPct >= 12) return "brilliant";
  if (!skipTopMatch && moveUci === preTopMove) return "best";
  if (deltaPct <= -20) return "blunder";
  if (deltaPct <= -10) return "mistake";
  if (preMoveProb < 0.05 && deltaPct <= -4) return "miss";
  if (deltaPct <= -3) return "inaccuracy";
  if (deltaPct >= 8) return "excellent";
  if (deltaPct >= 3) return "great";
  return "good";
}

function resolvePendingMaiaGrading(currentPositionValue) {
  if (!pendingMaiaGrading) return;
  const { preMoveValue, color, moveNumber, moveUci, preMoveProb } = pendingMaiaGrading;
  const label = classifyMoveGeneric({
    preValue: preMoveValue,
    postValue: currentPositionValue,
    moveUci,
    preTopMove: null,
    preMoveProb,
    moverColor: color,
    wasMate: false,
    moveNumber,
    skipTopMatch: true,
  });
  maiaMoveStatsObj[label]++;
  pendingMaiaGrading = null;
}

// ---------- Maia's turn ----------

async function runMaiaTurn() {
  if (inPuzzleMode || maiaThinking || isGameLocked() || game.turn() === playerColor) return;
  maiaThinking = true;
  updateStatusForTurn();
  const myToken = gameToken;
  const maiaColor = game.turn();
  const moveNumber = Math.floor(game.history().length / 2) + 1;

  try {
    const [evalResult] = await Promise.all([engine.evaluate(game, MAIA_ELO, MY_ELO), humanDelay()]);
    if (myToken !== gameToken) return;

    const preMoveValue = evalResult.value;
    const uci = Object.keys(evalResult.policy)[0];
    const preMoveProb = evalResult.policy[uci] || 0;
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci.slice(4) : "q";
    game.move({ from, to, promotion });
    lastMoveFrom = from;
    lastMoveTo = to;
    updateClockUnlocks();
    renderBoard();
    renderMoveList();

    if (game.game_over()) {
      if (game.in_checkmate()) maiaMoveStatsObj.best++;
      pendingMaiaGrading = null;
    } else {
      pendingMaiaGrading = { preMoveValue, color: maiaColor, moveNumber, moveUci: uci, preMoveProb };
    }

    saveCurrentGame();
    updateClockDisplays();

    if (game.game_over()) {
      clearTurnTags();
      showGameOverPopup();
    }
  } catch (err) {
    console.error(err);
    if (myToken === gameToken) {
      statusEl.textContent = "Maia failed to move — check console.";
      statusEl.classList.remove("status-hidden");
    }
  } finally {
    if (myToken === gameToken) {
      maiaThinking = false;
      if (!isGameLocked()) updateStatusForTurn();
    }
  }
}

// ---------- Player's turn ----------

async function onSquareClick(sq) {
  if (maiaThinking || isGameLocked()) return;
  if (game.turn() !== playerColor) return;

  if (selectedSquare === null) {
    const piece = game.get(sq);
    if (piece && piece.color === playerColor) {
      selectedSquare = sq;
      renderBoard();
    }
    return;
  }
  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  const from = selectedSquare;
  const to = sq;
  const preFen = game.fen();
  const moverColor = playerColor;
  const moveNumber = Math.floor(game.history().length / 2) + 1;

  const moveResult = game.move({ from, to, promotion: "q" });
  selectedSquare = null;

  if (!moveResult) {
    const piece = game.get(sq);
    if (piece && piece.color === playerColor) selectedSquare = sq;
    renderBoard();
    return;
  }

  lastMoveFrom = from;
  lastMoveTo = to;
  updateClockUnlocks();
  renderBoard();
  renderMoveList();
  saveCurrentGame();

  const wasMate = game.in_checkmate();
  const otherGameEnd = !wasMate && game.game_over();

  if (otherGameEnd) {
    pendingMaiaGrading = null;
    clearTurnTags();
    showGameOverPopup();
    return;
  }

  const myToken = gameToken;
  const promotion = moveResult.promotion ? moveResult.promotion : "";
  const moveUci = from + to + promotion;

  maiaThinking = true;
  updateStatusForTurn();

  try {
    const preEvalPromise = engine.evaluate(new Chess(preFen), MY_ELO, MAIA_ELO);
    const postEvalPromise = wasMate ? Promise.resolve(null) : engine.evaluate(game, MAIA_ELO, MY_ELO);
    const [preEval, postEval] = await Promise.all([preEvalPromise, postEvalPromise, humanDelay()]);

    if (myToken !== gameToken) return;

    resolvePendingMaiaGrading(preEval.value);

    const preTopMove = Object.keys(preEval.policy)[0];
    const preMoveProb = preEval.policy[moveUci] || 0;

    if (wasMate) {
      playerMoveStats.best++;
    } else {
      const label = classifyMoveGeneric({
        preValue: preEval.value, postValue: postEval.value, moveUci, preTopMove, preMoveProb,
        moverColor, wasMate: false, moveNumber, skipTopMatch: false,
      });
      playerMoveStats[label]++;

      const maiaColor = game.turn();
      const maiaMoveNumber = Math.floor(game.history().length / 2) + 1;
      const maiaPreMoveValue = postEval.value;
      const maiaUci = Object.keys(postEval.policy)[0];
      const maiaPreMoveProb = postEval.policy[maiaUci] || 0;
      const mFrom = maiaUci.slice(0, 2), mTo = maiaUci.slice(2, 4);
      const mPromo = maiaUci.length > 4 ? maiaUci.slice(4) : "q";
      game.move({ from: mFrom, to: mTo, promotion: mPromo });
      lastMoveFrom = mFrom;
      lastMoveTo = mTo;
      updateClockUnlocks();
      renderBoard();
      renderMoveList();
      saveCurrentGame();

      if (game.game_over() && game.in_checkmate()) {
        maiaMoveStatsObj.best++;
      } else if (!game.game_over()) {
        pendingMaiaGrading = { preMoveValue: maiaPreMoveValue, color: maiaColor, moveNumber: maiaMoveNumber, moveUci: maiaUci, preMoveProb: maiaPreMoveProb };
      }
    }

    if (game.game_over()) {
      clearTurnTags();
      showGameOverPopup();
    }
  } catch (err) {
    console.error(err);
    if (myToken === gameToken) {
      statusEl.textContent = "Maia failed to move — check console.";
      statusEl.classList.remove("status-hidden");
    }
  } finally {
    if (myToken === gameToken) {
      maiaThinking = false;
      if (!game.game_over()) updateStatusForTurn();
    }
  }
}

// ---------- Game-over popup ----------

function getResultText() {
  if (gameTimedOut) {
    const winner = timedOutColor === "w" ? "Black" : "White";
    return { title: winner + " wins", sub: "on time" };
  }
  if (gameResigned) {
    const winner = resignedBy === "w" ? "Black" : "White";
    return { title: winner + " wins", sub: "by resignation" };
  }
  if (game.in_checkmate()) {
    const winner = game.turn() === "w" ? "Black" : "White";
    return { title: winner + " wins", sub: "by checkmate" };
  }
  if (game.in_stalemate()) return { title: "Draw", sub: "by stalemate" };
  if (game.in_threefold_repetition()) return { title: "Draw", sub: "by repetition" };
  if (typeof game.insufficient_material === "function" && game.insufficient_material()) {
    return { title: "Draw", sub: "insufficient material" };
  }
  if (game.in_draw()) return { title: "Draw", sub: "" };
  return { title: "Game Over", sub: "" };
}

const STAT_LABELS = [
  ["brilliant", "Brilliant"], ["great", "Great"], ["book", "Book"], ["best", "Best"],
  ["excellent", "Excellent"], ["good", "Good"], ["inaccuracy", "Inaccuracy"],
  ["mistake", "Mistake"], ["miss", "Miss"], ["blunder", "Blunder"],
];
const POSITIVE_KEYS = ["brilliant", "great", "book", "best", "excellent", "good"];

function computeAccuracy(stats) {
  const total = STAT_LABELS.reduce((sum, [key]) => sum + stats[key], 0);
  if (total === 0) return null;
  const positive = POSITIVE_KEYS.reduce((sum, key) => sum + stats[key], 0);
  return Math.round((positive / total) * 100);
}

function buildStatsList(container, stats) {
  container.innerHTML = "";
  for (const [key, label] of STAT_LABELS) {
    const count = stats[key];
    if (count === 0) continue; // only show categories that actually occurred
    const row = document.createElement("div");
    row.className = "stat-line";
    row.innerHTML = `<span>${label}</span><span class="num">${count}</span>`;
    container.appendChild(row);
  }
  if (container.children.length === 0) {
    const row = document.createElement("div");
    row.className = "stat-line";
    row.innerHTML = `<span>No moves yet</span>`;
    container.appendChild(row);
  }
}

const HISTORY_KEY = "chess_history";

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function pushHistoryEntry() {
  const yourAcc = computeAccuracy(playerMoveStats);
  const maiaAcc = computeAccuracy(maiaMoveStatsObj);

  let resultLabel;
  if (gameTimedOut) {
    resultLabel = timedOutColor === playerColor ? "-30" : "+30";
  } else if (gameResigned) {
    resultLabel = resignedBy === playerColor ? "-30" : "+30";
  } else if (game.in_checkmate()) {
    const winner = game.turn() === "w" ? "b" : "w";
    resultLabel = winner === playerColor ? "+30" : "-30";
  } else {
    resultLabel = "0";
  }

  const sanMoves = game.history();
  const moveline = sanMoves.slice(0, 6).join(" ") + (sanMoves.length > 6 ? "..." : "");

  const entry = {
    result: resultLabel,
    accuracy: (yourAcc === null ? "—" : yourAcc + "%") + " / " + (maiaAcc === null ? "—" : maiaAcc + "%"),
    you: "You" + MY_ELO,
    maia: "Maia" + MAIA_ELO,
    moveline: moveline || "(no moves)",
    mode: currentMode,
  };

  const history = loadHistory();
  history.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
}

function renderHistory() {
  const history = loadHistory();
  historyEl.innerHTML = "";
  if (history.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "16px 6px";
    empty.style.color = "#888";
    empty.style.fontSize = "13px";
    empty.textContent = "No games played yet.";
    historyEl.appendChild(empty);
    return;
  }
  for (const entry of history) {
    const row = document.createElement("div");
    row.className = "game";
    row.innerHTML = `
      <div>${entry.result}</div>
      <div class="accuracy">${entry.accuracy}</div>
      <div>${entry.you}</div>
      <div>${entry.maia}</div>
      <div class="moveline">${entry.moveline}</div>
    `;
    historyEl.appendChild(row);
  }
}

function showGameOverPopup() {
  if (!historyRecorded) {
    pushHistoryEntry();
    historyRecorded = true;
    saveCurrentGame();
    renderHistory();
  }

  const { title, sub } = getResultText();
  overlayTitleEl.textContent = title;
  overlaySubEl.textContent = sub;

  const yourAcc = computeAccuracy(playerMoveStats);
  const maiaAcc = computeAccuracy(maiaMoveStatsObj);
  yourAccuracyEl.textContent = yourAcc === null ? "" : yourAcc + "%";
  maiaAccuracyEl.textContent = maiaAcc === null ? "" : maiaAcc + "%";
  buildStatsList(yourStatsEl, playerMoveStats);
  buildStatsList(maiaStatsEl, maiaMoveStatsObj);

  overlayEl.classList.remove("hidden");
}

function closeOverlay() {
  overlayEl.classList.add("hidden");
}
window.closeOverlay = closeOverlay;

// ---------- Init ----------

async function init() {
  renderHistory();
  statusEl.textContent = "Loading...";

  // Render a board immediately with whatever's saved, so a later failure
  // (engine, puzzles, etc.) never leaves the page looking blank.
  try {
    const loaded = loadGame(currentMode);
    applyLoadedState(loaded);
    renderBoard();
    renderMoveList();
    updateClockDisplays();
  } catch (err) {
    console.error("Failed during initial board setup:", err);
  }

  try {
    await MaiaTensor.initMoveTables("./data/");
    await loadPuzzleData();

    engine = new MaiaEngine({
      onStatus: (s) => {
        if (s === "downloading") statusEl.textContent = "Downloading Maia model (first time only)...";
      },
      onProgress: (p) => {
        statusEl.textContent = `Downloading Maia model (first time only)... ${p}%`;
      },
    });
    await engine.load();

    setInterval(tickClock, 1000);

    if (isGameLocked()) {
      showGameOverPopup();
    } else {
      updateStatusForTurn();
      if (game.turn() !== playerColor) runMaiaTurn();
    }
  } catch (err) {
    console.error("Failed to fully initialize the Maia engine:", err);
    statusEl.textContent = "Something failed to load — check the console for details.";
    statusEl.classList.remove("status-hidden");
  }
}

init();