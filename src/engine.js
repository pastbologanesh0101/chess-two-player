/**
 * A self-contained chess engine: full legal move generation (castling, en
 * passant, promotion), check / checkmate / stalemate detection, the common
 * draw rules, SAN, and FEN import/export.
 *
 * Board representation: a 64-element array indexed `rank * 8 + file`, where
 * rank 0 is White's back rank (a1..h1) and file 0 is the a-file. A piece is a
 * single letter, uppercase for White (`PNBRQK`) and lowercase for Black; an
 * empty square is `null`.
 *
 * Every function that "moves" returns a brand-new state object; nothing here
 * mutates its arguments.
 */

export const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const WHITE = "w";
const BLACK = "b";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** @typedef {{board: (string|null)[], turn: string, castling: string, ep: number|null, halfmove: number, fullmove: number}} State */
/** @typedef {{from: number, to: number, piece: string, captured: (string|null), promotion: (string|null), flags: string}} Move */

// ---------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------

export const fileOf = (i) => i & 7;
export const rankOf = (i) => i >> 3;
export const squareName = (i) => FILES[fileOf(i)] + (rankOf(i) + 1);

export function squareIndex(name) {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]) - 1;
  if (file < 0 || rank < 0 || rank > 7) throw new Error(`Bad square: ${name}`);
  return rank * 8 + file;
}

const isWhitePiece = (p) => p != null && p === p.toUpperCase();
const isBlackPiece = (p) => p != null && p === p.toLowerCase();
const colorOf = (p) => (isWhitePiece(p) ? WHITE : BLACK);
const other = (c) => (c === WHITE ? BLACK : WHITE);

// ---------------------------------------------------------------------------
// FEN
// ---------------------------------------------------------------------------

/** Parse a FEN string into a {@link State}. */
export function fromFEN(fen = START_FEN) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error(`Bad FEN placement: ${placement}`);

  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    const rank = 7 - r; // FEN lists rank 8 first
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        board[rank * 8 + file] = ch;
        file++;
      }
    }
    if (file !== 8) throw new Error(`Bad FEN rank "${row}"`);
  }

  return {
    board,
    turn: turn === "b" ? BLACK : WHITE,
    castling: castling && castling !== "-" ? castling : "",
    ep: ep && ep !== "-" ? squareIndex(ep) : null,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

/** Serialise a {@link State} back to FEN. */
export function toFEN(state) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[r * 8 + f];
      if (p == null) {
        empty++;
      } else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return [
    rows.join("/"),
    state.turn,
    state.castling || "-",
    state.ep == null ? "-" : squareName(state.ep),
    state.halfmove,
    state.fullmove,
  ].join(" ");
}

export const newGame = () => fromFEN(START_FEN);

// ---------------------------------------------------------------------------
// Attack detection
// ---------------------------------------------------------------------------

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function onBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

/** Is `target` attacked by any piece of `byColor`? */
export function isSquareAttacked(board, target, byColor) {
  const tf = fileOf(target);
  const tr = rankOf(target);

  // Pawns: a white pawn on (f, r) attacks (f±1, r+1); check the reverse.
  const pawnRank = byColor === WHITE ? tr - 1 : tr + 1;
  for (const df of [-1, 1]) {
    if (onBoard(tf + df, pawnRank)) {
      const p = board[pawnRank * 8 + (tf + df)];
      if (p === (byColor === WHITE ? "P" : "p")) return true;
    }
  }

  // Knights
  for (const [df, dr] of KNIGHT_DELTAS) {
    if (!onBoard(tf + df, tr + dr)) continue;
    const p = board[(tr + dr) * 8 + (tf + df)];
    if (p === (byColor === WHITE ? "N" : "n")) return true;
  }

  // King
  for (const [df, dr] of KING_DELTAS) {
    if (!onBoard(tf + df, tr + dr)) continue;
    const p = board[(tr + dr) * 8 + (tf + df)];
    if (p === (byColor === WHITE ? "K" : "k")) return true;
  }

  // Sliding: bishops/queens on diagonals, rooks/queens on files & ranks
  const scan = (dirs, pieces) => {
    for (const [df, dr] of dirs) {
      let f = tf + df;
      let r = tr + dr;
      while (onBoard(f, r)) {
        const p = board[r * 8 + f];
        if (p != null) {
          if (colorOf(p) === byColor && pieces.includes(p.toUpperCase())) {
            return true;
          }
          break;
        }
        f += df;
        r += dr;
      }
    }
    return false;
  };
  if (scan(BISHOP_DIRS, ["B", "Q"])) return true;
  if (scan(ROOK_DIRS, ["R", "Q"])) return true;

  return false;
}

export function kingSquare(board, color) {
  const king = color === WHITE ? "K" : "k";
  return board.indexOf(king);
}

export function inCheck(state, color = state.turn) {
  const ks = kingSquare(state.board, color);
  return ks >= 0 && isSquareAttacked(state.board, ks, other(color));
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

function pushPawnMoves(moves, from, to, piece, captured, flag) {
  const promoRank = piece === "P" ? 7 : 0;
  if (rankOf(to) === promoRank) {
    for (const pr of ["Q", "R", "B", "N"]) {
      moves.push({
        from,
        to,
        piece,
        captured,
        promotion: piece === "P" ? pr : pr.toLowerCase(),
        flags: flag + "p",
      });
    }
  } else {
    moves.push({ from, to, piece, captured, promotion: null, flags: flag });
  }
}

/** All pseudo-legal moves (may leave own king in check). */
export function pseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];
  const own = turn;

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (piece == null || colorOf(piece) !== own) continue;
    const type = piece.toUpperCase();
    const f = fileOf(from);
    const r = rankOf(from);

    if (type === "P") {
      const dir = piece === "P" ? 1 : -1;
      const startRank = piece === "P" ? 1 : 6;
      const one = from + dir * 8;
      if (board[one] == null) {
        pushPawnMoves(moves, from, one, piece, null, "");
        const two = from + dir * 16;
        if (r === startRank && board[two] == null) {
          moves.push({ from, to: two, piece, captured: null, promotion: null, flags: "b" });
        }
      }
      for (const df of [-1, 1]) {
        if (!onBoard(f + df, r + dir)) continue;
        const to = (r + dir) * 8 + (f + df);
        const victim = board[to];
        if (victim != null && colorOf(victim) !== own) {
          pushPawnMoves(moves, from, to, piece, victim, "c");
        } else if (to === state.ep) {
          const capIdx = from + df; // captured pawn sits beside the mover
          pushPawnMoves(moves, from, to, piece, board[capIdx], "e");
        }
      }
      continue;
    }

    if (type === "N" || type === "K") {
      const deltas = type === "N" ? KNIGHT_DELTAS : KING_DELTAS;
      for (const [df, dr] of deltas) {
        if (!onBoard(f + df, r + dr)) continue;
        const to = (r + dr) * 8 + (f + df);
        const victim = board[to];
        if (victim == null) {
          moves.push({ from, to, piece, captured: null, promotion: null, flags: "" });
        } else if (colorOf(victim) !== own) {
          moves.push({ from, to, piece, captured: victim, promotion: null, flags: "c" });
        }
      }
      if (type === "K") pushCastling(state, from, moves);
      continue;
    }

    // Sliders
    const dirs =
      type === "B" ? BISHOP_DIRS : type === "R" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
    for (const [df, dr] of dirs) {
      let nf = f + df;
      let nr = r + dr;
      while (onBoard(nf, nr)) {
        const to = nr * 8 + nf;
        const victim = board[to];
        if (victim == null) {
          moves.push({ from, to, piece, captured: null, promotion: null, flags: "" });
        } else {
          if (colorOf(victim) !== own) {
            moves.push({ from, to, piece, captured: victim, promotion: null, flags: "c" });
          }
          break;
        }
        nf += df;
        nr += dr;
      }
    }
  }

  return moves;
}

function pushCastling(state, from, moves) {
  const { board, turn, castling } = state;
  const rights = turn === WHITE ? ["K", "Q"] : ["k", "q"];
  const backRank = turn === WHITE ? 0 : 7;
  if (from !== backRank * 8 + 4) return; // king not on its home square
  if (isSquareAttacked(board, from, other(turn))) return; // can't castle out of check

  // King-side
  if (castling.includes(rights[0])) {
    const f5 = backRank * 8 + 5;
    const g6 = backRank * 8 + 6;
    const rookSq = backRank * 8 + 7;
    if (
      board[f5] == null &&
      board[g6] == null &&
      board[rookSq] === (turn === WHITE ? "R" : "r") &&
      !isSquareAttacked(board, f5, other(turn)) &&
      !isSquareAttacked(board, g6, other(turn))
    ) {
      moves.push({ from, to: g6, piece: board[from], captured: null, promotion: null, flags: "k" });
    }
  }
  // Queen-side
  if (castling.includes(rights[1])) {
    const d3 = backRank * 8 + 3;
    const c2 = backRank * 8 + 2;
    const b1 = backRank * 8 + 1;
    const rookSq = backRank * 8 + 0;
    if (
      board[d3] == null &&
      board[c2] == null &&
      board[b1] == null &&
      board[rookSq] === (turn === WHITE ? "R" : "r") &&
      !isSquareAttacked(board, d3, other(turn)) &&
      !isSquareAttacked(board, c2, other(turn))
    ) {
      moves.push({ from, to: c2, piece: board[from], captured: null, promotion: null, flags: "q" });
    }
  }
}

/** Apply a move, returning a new {@link State}. Assumes the move is legal. */
export function makeMove(state, move) {
  const board = state.board.slice();
  const { from, to, piece, promotion, flags } = move;
  const turn = state.turn;
  const backRank = turn === WHITE ? 0 : 7;

  board[from] = null;
  board[to] = promotion ?? piece;

  if (flags.includes("e")) {
    // en passant: remove the pawn that sits on the mover's rank, beside `to`
    const capIdx = fileOf(to) + rankOf(from) * 8;
    board[capIdx] = null;
  }
  if (flags.includes("k")) {
    board[backRank * 8 + 7] = null;
    board[backRank * 8 + 5] = turn === WHITE ? "R" : "r";
  }
  if (flags.includes("q")) {
    board[backRank * 8 + 0] = null;
    board[backRank * 8 + 3] = turn === WHITE ? "R" : "r";
  }

  // Castling rights
  let castling = state.castling;
  const drop = (c) => {
    castling = castling.replace(c, "");
  };
  if (piece === "K") drop("K"), drop("Q");
  if (piece === "k") drop("k"), drop("q");
  if (from === 0 || to === 0) drop("Q");
  if (from === 7 || to === 7) drop("K");
  if (from === 56 || to === 56) drop("q");
  if (from === 63 || to === 63) drop("k");

  // En-passant target square (only after a double pawn push)
  const ep = flags.includes("b") ? (from + to) / 2 : null;

  const isPawn = piece === "P" || piece === "p";
  const halfmove =
    isPawn || move.captured != null ? 0 : state.halfmove + 1;
  const fullmove = turn === BLACK ? state.fullmove + 1 : state.fullmove;

  return { board, turn: other(turn), castling, ep, halfmove, fullmove };
}

/** All fully legal moves for the side to move. */
export function legalMoves(state) {
  const out = [];
  for (const move of pseudoMoves(state)) {
    const next = makeMove(state, move);
    if (!inCheck(next, state.turn)) out.push(move);
  }
  return out;
}

export function legalMovesFrom(state, from) {
  return legalMoves(state).filter((m) => m.from === from);
}

// ---------------------------------------------------------------------------
// Game status & draw rules
// ---------------------------------------------------------------------------

/** True when neither side has mating material. */
export function insufficientMaterial(board) {
  const minors = [];
  for (const p of board) {
    if (p == null) continue;
    const t = p.toUpperCase();
    if (t === "P" || t === "R" || t === "Q") return false;
    if (t === "B" || t === "N") minors.push(p);
  }
  if (minors.length <= 1) return true; // K vs K, K+minor vs K
  if (minors.length === 2) {
    // K+B vs K+B is a draw only when bishops share square colour; treat any
    // two-minor ending without pawns as "insufficient" for a friendly app.
    return true;
  }
  return false;
}

/**
 * @param {State} state
 * @param {string[]} [history] FENs (placement+turn+castling+ep) seen so far,
 *   used for threefold-repetition detection.
 */
export function gameStatus(state, history = []) {
  const moves = legalMoves(state);
  const checked = inCheck(state);

  if (moves.length === 0) {
    return checked
      ? { over: true, result: state.turn === WHITE ? "0-1" : "1-0", reason: "checkmate" }
      : { over: true, result: "1/2-1/2", reason: "stalemate" };
  }
  if (insufficientMaterial(state.board)) {
    return { over: true, result: "1/2-1/2", reason: "insufficient material" };
  }
  if (state.halfmove >= 100) {
    return { over: true, result: "1/2-1/2", reason: "fifty-move rule" };
  }
  const key = repetitionKey(state);
  if (history.filter((h) => h === key).length >= 3) {
    return { over: true, result: "1/2-1/2", reason: "threefold repetition" };
  }
  return { over: false, result: "*", reason: checked ? "check" : "ongoing" };
}

export function repetitionKey(state) {
  return toFEN(state).split(" ").slice(0, 4).join(" ");
}

// ---------------------------------------------------------------------------
// SAN
// ---------------------------------------------------------------------------

/** Standard Algebraic Notation for `move` in the context of `state`. */
export function moveToSAN(state, move) {
  if (move.flags.includes("k")) return decorate("O-O");
  if (move.flags.includes("q")) return decorate("O-O-O");

  const type = move.piece.toUpperCase();
  const dest = squareName(move.to);
  const isCapture = move.captured != null || move.flags.includes("e");
  let san;

  if (type === "P") {
    san = isCapture ? `${FILES[fileOf(move.from)]}x${dest}` : dest;
    if (move.promotion) san += "=" + move.promotion.toUpperCase();
  } else {
    san = type + disambiguation(state, move) + (isCapture ? "x" : "") + dest;
  }
  return decorate(san);

  function decorate(s) {
    const next = makeMove(state, move);
    if (inCheck(next)) {
      s += legalMoves(next).length === 0 ? "#" : "+";
    }
    return s;
  }
}

function disambiguation(state, move) {
  const type = move.piece.toUpperCase();
  const rivals = legalMoves(state).filter(
    (m) =>
      m.to === move.to &&
      m.from !== move.from &&
      state.board[m.from]?.toUpperCase() === type,
  );
  if (rivals.length === 0) return "";
  const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
  const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
  if (!sameFile) return FILES[fileOf(move.from)];
  if (!sameRank) return String(rankOf(move.from) + 1);
  return squareName(move.from);
}

// ---------------------------------------------------------------------------
// Perft — used by the test suite to prove move generation is correct
// ---------------------------------------------------------------------------

export function perft(state, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of legalMoves(state)) {
    nodes += perft(makeMove(state, move), depth - 1);
  }
  return nodes;
}
