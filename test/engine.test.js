import { describe, it, expect } from "vitest";
import {
  fromFEN,
  toFEN,
  newGame,
  START_FEN,
  legalMoves,
  legalMovesFrom,
  makeMove,
  moveToSAN,
  gameStatus,
  inCheck,
  perft,
  squareIndex,
  squareName,
} from "../src/engine.js";

const find = (state, from, to, promo) =>
  legalMoves(state).find(
    (m) =>
      m.from === squareIndex(from) &&
      m.to === squareIndex(to) &&
      (promo ? m.promotion?.toUpperCase() === promo : true),
  );

describe("FEN", () => {
  it("round-trips the start position", () => {
    expect(toFEN(fromFEN(START_FEN))).toBe(START_FEN);
  });

  it("round-trips a messy midgame position", () => {
    const fen =
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    expect(toFEN(fromFEN(fen))).toBe(fen);
  });

  it("maps squares to indices and back", () => {
    expect(squareIndex("a1")).toBe(0);
    expect(squareIndex("h8")).toBe(63);
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
  });
});

describe("move generation — perft", () => {
  // Node counts from the Chess Programming Wiki. Matching them exactly is a
  // strong guarantee that castling, en passant, promotion and pin handling
  // are all correct.
  it("start position", () => {
    const s = newGame();
    expect(perft(s, 1)).toBe(20);
    expect(perft(s, 2)).toBe(400);
    expect(perft(s, 3)).toBe(8902);
    expect(perft(s, 4)).toBe(197281);
  });

  it("Kiwipete", () => {
    const s = fromFEN(
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    );
    expect(perft(s, 1)).toBe(48);
    expect(perft(s, 2)).toBe(2039);
    expect(perft(s, 3)).toBe(97862);
  });

  it("endgame position 3", () => {
    const s = fromFEN("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
    expect(perft(s, 1)).toBe(14);
    expect(perft(s, 2)).toBe(191);
    expect(perft(s, 3)).toBe(2812);
    expect(perft(s, 4)).toBe(43238);
  });

  it("position 4 (promotions & checks)", () => {
    const s = fromFEN(
      "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    );
    expect(perft(s, 1)).toBe(6);
    expect(perft(s, 2)).toBe(264);
    expect(perft(s, 3)).toBe(9467);
  });

  it("position 5", () => {
    const s = fromFEN("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8");
    expect(perft(s, 1)).toBe(44);
    expect(perft(s, 2)).toBe(1486);
    expect(perft(s, 3)).toBe(62379);
  });

  it("position 6", () => {
    const s = fromFEN(
      "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    );
    expect(perft(s, 1)).toBe(46);
    expect(perft(s, 2)).toBe(2079);
    expect(perft(s, 3)).toBe(89890);
  });
});

describe("special moves", () => {
  it("generates castling when the path is clear", () => {
    const s = fromFEN("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const kside = find(s, "e1", "g1");
    const qside = find(s, "e1", "c1");
    expect(kside?.flags).toContain("k");
    expect(qside?.flags).toContain("q");
    const after = makeMove(s, kside);
    expect(after.board[squareIndex("g1")]).toBe("K");
    expect(after.board[squareIndex("f1")]).toBe("R");
    expect(after.castling).toBe("kq");
  });

  it("forbids castling through an attacked square", () => {
    // Black rook on f8 covers f1 -> no king-side castling for White.
    const s = fromFEN("4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(find(s, "e1", "g1")).toBeUndefined();
    expect(find(s, "e1", "c1")).toBeDefined();
  });

  it("handles en passant capture", () => {
    const s = fromFEN("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
    const ep = find(s, "e5", "f6");
    expect(ep?.flags).toContain("e");
    const after = makeMove(s, ep);
    expect(after.board[squareIndex("f5")]).toBeNull(); // captured pawn removed
    expect(after.board[squareIndex("f6")]).toBe("P");
  });

  it("offers all four promotion choices", () => {
    const s = fromFEN("8/P7/8/8/8/8/8/k6K w - - 0 1");
    const promos = legalMovesFrom(s, squareIndex("a7"))
      .filter((m) => m.to === squareIndex("a8"))
      .map((m) => m.promotion)
      .sort();
    expect(promos).toEqual(["B", "N", "Q", "R"]);
  });

  it("keeps a pinned piece from moving", () => {
    // White knight on e2 is pinned to the king by the rook on e8.
    const s = fromFEN("4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1");
    expect(legalMovesFrom(s, squareIndex("e2"))).toHaveLength(0);
  });
});

describe("SAN", () => {
  it("names quiet moves, captures, castles and checks", () => {
    let s = newGame();
    s = makeMove(s, find(s, "e2", "e4"));
    s = makeMove(s, find(s, "e7", "e5"));
    const nf3 = find(s, "g1", "f3");
    expect(moveToSAN(s, nf3)).toBe("Nf3");

    const mate = fromFEN(
      "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2",
    );
    const qh4 = find(mate, "d8", "h4");
    expect(moveToSAN(mate, qh4)).toBe("Qh4#");
  });

  it("disambiguates when two like pieces can reach a square", () => {
    const s = fromFEN("8/8/8/8/8/8/8/R6R w - - 0 1");
    const move = find(s, "a1", "d1");
    expect(moveToSAN(s, move)).toBe("Rad1");
  });
});

describe("game status", () => {
  it("detects checkmate (fool's mate)", () => {
    const s = fromFEN(
      "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
    );
    const st = gameStatus(s);
    expect(st).toMatchObject({ over: true, result: "0-1", reason: "checkmate" });
    expect(inCheck(s)).toBe(true);
  });

  it("detects stalemate", () => {
    const s = fromFEN("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(gameStatus(s)).toMatchObject({
      over: true,
      result: "1/2-1/2",
      reason: "stalemate",
    });
  });

  it("detects insufficient material", () => {
    const s = fromFEN("8/8/8/4k3/8/8/4K3/8 w - - 0 1");
    expect(gameStatus(s).reason).toBe("insufficient material");
  });

  it("detects the fifty-move rule", () => {
    const s = fromFEN("8/8/4k3/8/8/4K3/5R2/8 w - - 100 80");
    expect(gameStatus(s).reason).toBe("fifty-move rule");
  });

  it("detects threefold repetition", () => {
    let s = newGame();
    const history = [];
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    for (let i = 0; i < 8; i++) {
      const uci = shuffle[i % 4];
      history.push(toFEN(s).split(" ").slice(0, 4).join(" "));
      s = makeMove(s, find(s, uci.slice(0, 2), uci.slice(2, 4)));
    }
    history.push(toFEN(s).split(" ").slice(0, 4).join(" "));
    expect(gameStatus(s, history).reason).toBe("threefold repetition");
  });

  it("reports an ordinary position as ongoing", () => {
    expect(gameStatus(newGame())).toMatchObject({ over: false, reason: "ongoing" });
  });
});
