import "./style.css";
import {
  newGame,
  legalMoves,
  makeMove,
  moveToSAN,
  gameStatus,
  inCheck,
  kingSquare,
  fileOf,
  rankOf,
  repetitionKey,
} from "./engine.js";

const FILLED = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
const glyph = (piece) => FILLED[piece.toLowerCase()];
const colorClass = (piece) =>
  piece === piece.toUpperCase() ? "square__piece--w" : "square__piece--b";

const el = {
  board: document.getElementById("board"),
  status: document.getElementById("status"),
  moves: document.getElementById("moves"),
  capturedByWhite: document.getElementById("capturedByWhite"),
  capturedByBlack: document.getElementById("capturedByBlack"),
  newGame: document.getElementById("newGame"),
  undo: document.getElementById("undo"),
  flip: document.getElementById("flip"),
};

/** @type {{state: any, move: any, san: string|null}[]} */
let history;
let orientation; // "w" | "b"
let selected; // board index or null
let legalFromSelected; // Move[]
let pendingPromo; // { from, to, options: Move[] } | null
let status; // gameStatus() result

function reset() {
  history = [{ state: newGame(), move: null, san: null }];
  orientation = "w";
  selected = null;
  legalFromSelected = [];
  pendingPromo = null;
  recomputeStatus();
  render();
}

const current = () => history[history.length - 1].state;

function repetitionHistory() {
  // Position keys for every state that has occurred, for the threefold check.
  return history.map((h) => repetitionKey(h.state));
}

function recomputeStatus() {
  status = gameStatus(current(), repetitionHistory());
}

// --- interaction -----------------------------------------------------------

function onSquareClick(idx) {
  if (pendingPromo || status.over) return;
  const board = current().board;
  const piece = board[idx];
  const turn = current().turn;

  if (selected === null) {
    if (piece && (piece === piece.toUpperCase()) === (turn === "w")) {
      select(idx);
    }
    return;
  }

  if (idx === selected) {
    clearSelection();
    render();
    return;
  }

  const matches = legalFromSelected.filter((m) => m.to === idx);
  if (matches.length === 0) {
    if (piece && (piece === piece.toUpperCase()) === (turn === "w")) select(idx);
    else {
      clearSelection();
      render();
    }
    return;
  }

  if (matches.length > 1 && matches[0].promotion) {
    pendingPromo = { from: selected, to: idx, options: matches };
    render();
    return;
  }

  applyMove(matches[0]);
}

function select(idx) {
  selected = idx;
  legalFromSelected = legalMoves(current()).filter((m) => m.from === idx);
  render();
}

function clearSelection() {
  selected = null;
  legalFromSelected = [];
  pendingPromo = null;
}

function applyMove(move) {
  const state = current();
  const san = moveToSAN(state, move);
  history.push({ state: makeMove(state, move), move, san });
  clearSelection();
  recomputeStatus();
  render();
}

function undo() {
  if (history.length <= 1) return;
  history.pop();
  clearSelection();
  recomputeStatus();
  render();
}

// --- rendering -----------------------------------------------------------

function render() {
  renderBoard();
  renderStatus();
  renderMoves();
  renderCaptures();
  el.undo.disabled = history.length <= 1;
}

function renderBoard() {
  const state = current();
  const board = state.board;
  const last = history[history.length - 1].move;
  const checkSquare = inCheck(state) ? kingSquare(board, state.turn) : -1;
  const destinations = new Set(legalFromSelected.map((m) => m.to));

  const ranks = orientation === "w" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  const frag = document.createDocumentFragment();
  for (const r of ranks) {
    for (const f of files) {
      const idx = r * 8 + f;
      const sq = document.createElement("button");
      sq.type = "button";
      sq.className = "square " + ((r + f) % 2 === 0 ? "square--dark" : "square--light");
      sq.dataset.idx = String(idx);
      sq.setAttribute("aria-label", squareLabel(idx, board[idx]));

      if (idx === selected) sq.classList.add("square--selected");
      if (last && (idx === last.from || idx === last.to)) sq.classList.add("square--last");
      if (idx === checkSquare) sq.classList.add("square--check");

      const piece = board[idx];
      if (piece) {
        const span = document.createElement("span");
        span.className = "square__piece " + colorClass(piece);
        span.textContent = glyph(piece);
        sq.appendChild(span);
      }

      if (destinations.has(idx)) {
        const hint = document.createElement("span");
        hint.className =
          "square__hint" + (piece ? " square__hint--capture" : "");
        sq.appendChild(hint);
      }

      // edge coordinates: file letters along the bottom rank, rank numbers up the left file
      if (r === (orientation === "w" ? 0 : 7)) addCoord(sq, "file", "abcdefgh"[f]);
      if (f === (orientation === "w" ? 0 : 7)) addCoord(sq, "rank", String(r + 1));

      if (pendingPromo && idx === pendingPromo.to) sq.appendChild(promoPicker());

      frag.appendChild(sq);
    }
  }
  el.board.replaceChildren(frag);
}

function addCoord(sq, kind, text) {
  const c = document.createElement("span");
  c.className = `square__coord square__coord--${kind}`;
  c.textContent = text;
  sq.appendChild(c);
}

function promoPicker() {
  const wrap = document.createElement("div");
  wrap.className = "promo";
  for (const opt of pendingPromo.options) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = glyph(opt.promotion);
    b.className = colorClass(opt.promotion);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      applyMove(opt);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function squareLabel(idx, piece) {
  const name = "abcdefgh"[fileOf(idx)] + (rankOf(idx) + 1);
  if (!piece) return `${name}, empty`;
  const names = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const side = piece === piece.toUpperCase() ? "white" : "black";
  return `${name}, ${side} ${names[piece.toLowerCase()]}`;
}

function renderStatus() {
  const state = current();
  let text;
  if (status.over) {
    const outcome =
      status.result === "1-0"
        ? "White wins"
        : status.result === "0-1"
          ? "Black wins"
          : "Draw";
    text = `${capitalize(status.reason)} — ${outcome}`;
  } else {
    text = `${state.turn === "w" ? "White" : "Black"} to move`;
    if (status.reason === "check") text += " — check!";
  }
  el.status.textContent = text;
  el.status.classList.toggle("status--over", status.over);
}

function renderMoves() {
  el.moves.replaceChildren();
  for (let i = 1; i < history.length; i += 2) {
    const li = document.createElement("li");
    li.value = (i - 1) / 2 + 1;
    const white = document.createElement("span");
    white.textContent = history[i].san;
    li.appendChild(white);
    if (history[i + 1]) {
      const black = document.createElement("span");
      black.textContent = history[i + 1].san;
      li.appendChild(black);
    }
    el.moves.appendChild(li);
  }
  el.moves.scrollTop = el.moves.scrollHeight;
}

function renderCaptures() {
  const byWhite = [];
  const byBlack = [];
  for (const h of history) {
    if (!h.move || h.move.captured == null) continue;
    const cap = h.move.captured;
    if (h.move.piece === h.move.piece.toUpperCase()) byWhite.push(cap);
    else byBlack.push(cap);
  }
  const order = "qrbnp";
  const fmt = (arr) =>
    arr
      .sort((a, b) => order.indexOf(a.toLowerCase()) - order.indexOf(b.toLowerCase()))
      .map(glyph)
      .join("");
  el.capturedByWhite.textContent = fmt(byWhite);
  el.capturedByWhite.className = "captures__pieces square__piece--b";
  el.capturedByBlack.textContent = fmt(byBlack);
  el.capturedByBlack.className = "captures__pieces square__piece--w";
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// --- wiring ------------------------------------------------------------

el.board.addEventListener("click", (e) => {
  const sq = e.target.closest(".square");
  if (sq) onSquareClick(Number(sq.dataset.idx));
});
el.newGame.addEventListener("click", reset);
el.undo.addEventListener("click", undo);
el.flip.addEventListener("click", () => {
  orientation = orientation === "w" ? "b" : "w";
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "BUTTON") return;
  if (e.key === "f") el.flip.click();
  if (e.key === "u") undo();
  if (e.key === "n") reset();
});

reset();
