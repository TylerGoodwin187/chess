// Ported from src/lib/engine/tensor.ts (maia-platform-frontend) — plain JS, no build step needed.

let allPossibleMovesMaia3 = null;         // { "e2e4": 0, ... }
let allPossibleMovesMaia3Reversed = null; // { 0: "e2e4", ... }

// Must be called once before using anything else in this file.
async function initMoveTables(baseUrl = "./data/") {
  const [fwd, rev] = await Promise.all([
    fetch(baseUrl + "all_moves_maia3.json").then((r) => r.json()),
    fetch(baseUrl + "all_moves_maia3_reversed.json").then((r) => r.json()),
  ]);
  allPossibleMovesMaia3 = fwd;
  allPossibleMovesMaia3Reversed = rev;
}

function mirrorSquare(square) {
  const file = square.charAt(0);
  const rank = (9 - parseInt(square.charAt(1), 10)).toString();
  return file + rank;
}

function mirrorMove(moveUci) {
  const isPromotion = moveUci.length > 4;
  const startSquare = moveUci.substring(0, 2);
  const endSquare = moveUci.substring(2, 4);
  const promotionPiece = isPromotion ? moveUci.substring(4) : "";
  return mirrorSquare(startSquare) + mirrorSquare(endSquare) + promotionPiece;
}

function swapColorsInRank(rank) {
  let out = "";
  for (const ch of rank) {
    if (/[A-Z]/.test(ch)) out += ch.toLowerCase();
    else if (/[a-z]/.test(ch)) out += ch.toUpperCase();
    else out += ch;
  }
  return out;
}

function swapCastlingRights(castling) {
  if (castling === "-") return "-";
  const rights = new Set(castling.split(""));
  const swapped = new Set();
  if (rights.has("K")) swapped.add("k");
  if (rights.has("Q")) swapped.add("q");
  if (rights.has("k")) swapped.add("K");
  if (rights.has("q")) swapped.add("Q");
  let out = "";
  if (swapped.has("K")) out += "K";
  if (swapped.has("Q")) out += "Q";
  if (swapped.has("k")) out += "k";
  if (swapped.has("q")) out += "q";
  return out === "" ? "-" : out;
}

function mirrorFEN(fen) {
  const [position, activeColor, castling, enPassant, halfmove, fullmove] =
    fen.split(" ");
  const mirroredPosition = position
    .split("/")
    .slice()
    .reverse()
    .map(swapColorsInRank)
    .join("/");
  const mirroredActiveColor = activeColor === "w" ? "b" : "w";
  const mirroredCastling = swapCastlingRights(castling);
  const mirroredEnPassant = enPassant !== "-" ? mirrorSquare(enPassant) : "-";
  return `${mirroredPosition} ${mirroredActiveColor} ${mirroredCastling} ${mirroredEnPassant} ${halfmove} ${fullmove}`;
}

function boardToMaia3Tokens(fen) {
  const piecePlacement = fen.split(" ")[0];
  const pieceTypes = ["P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];
  const tensor = new Float32Array(64 * 12);
  const rows = piecePlacement.split("/");

  for (let rank = 0; rank < 8; rank++) {
    const row = 7 - rank;
    let file = 0;
    for (const ch of rows[rank]) {
      const n = parseInt(ch, 10);
      if (isNaN(n)) {
        const pieceIdx = pieceTypes.indexOf(ch);
        if (pieceIdx >= 0) {
          const square = row * 8 + file;
          tensor[square * 12 + pieceIdx] = 1.0;
        }
        file += 1;
      } else {
        file += n;
      }
    }
  }
  return tensor;
}

// chessObj: an instance of Chess() from chess.js, already at the position to evaluate
function preprocessMaia3(chessObj) {
  let fen = chessObj.fen();
  let board = chessObj;
  const turn = fen.split(" ")[1];

  if (turn === "b") {
    board = new Chess(mirrorFEN(fen));
    fen = board.fen();
  } else if (turn !== "w") {
    throw new Error("Invalid FEN: " + fen);
  }

  const boardTokens = boardToMaia3Tokens(fen);

  const legalMoves = new Float32Array(Object.keys(allPossibleMovesMaia3).length);
  const verboseMoves = board.moves({ verbose: true });
  for (const move of verboseMoves) {
    const promotion = move.promotion ? move.promotion : "";
    const key = move.from + move.to + promotion;
    const moveIndex = allPossibleMovesMaia3[key];
    if (moveIndex !== undefined) legalMoves[moveIndex] = 1.0;
  }

  return { boardTokens, legalMoves, mirrored: turn === "b" };
}

// logitsMove: Float32Array (4352), logitsValue: Float32Array (3 -> L/D/W)
function processOutputsMaia3(fen, logitsMove, logitsValue, legalMoves) {
  const wdl = logitsValue;
  const maxWdl = Math.max(wdl[0], wdl[1], wdl[2]);
  const expL = Math.exp(wdl[0] - maxWdl);
  const expD = Math.exp(wdl[1] - maxWdl);
  const expW = Math.exp(wdl[2] - maxWdl);
  const sumExp = expL + expD + expW;
  let winProb = (expW + 0.5 * expD) / sumExp;

  const blackToMove = fen.split(" ")[1] === "b";
  if (blackToMove) winProb = 1 - winProb;
  winProb = Math.round(winProb * 10000) / 10000;

  const legalMoveIndices = [];
  for (let i = 0; i < legalMoves.length; i++) {
    if (legalMoves[i] > 0) legalMoveIndices.push(i);
  }

  const legalMovesMirrored = legalMoveIndices.map((idx) => {
    let mv = allPossibleMovesMaia3Reversed[idx];
    if (blackToMove) mv = mirrorMove(mv);
    return mv;
  });

  const legalLogits = legalMoveIndices.map((idx) => logitsMove[idx]);
  const maxLogit = Math.max(...legalLogits);
  const expLogits = legalLogits.map((l) => Math.exp(l - maxLogit));
  const sumExpMoves = expLogits.reduce((a, b) => a + b, 0);
  const probs = expLogits.map((e) => e / sumExpMoves);

  const moveProbs = {};
  for (let i = 0; i < legalMoveIndices.length; i++) {
    moveProbs[legalMovesMirrored[i]] = probs[i];
  }

  const sorted = Object.keys(moveProbs)
    .sort((a, b) => moveProbs[b] - moveProbs[a])
    .reduce((acc, key) => {
      acc[key] = moveProbs[key];
      return acc;
    }, {});

  return { policy: sorted, value: winProb };
}

window.MaiaTensor = {
  initMoveTables,
  preprocessMaia3,
  processOutputsMaia3,
};
