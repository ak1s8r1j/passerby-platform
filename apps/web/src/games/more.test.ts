import { describe, expect, it } from "vitest";
import type { GameId } from "@passerby/shared";
import {
  TRIVIA_COUNT,
  accept,
  advance,
  invite,
  move,
  receive,
  summary,
  triviaQuestion,
  write,
  type BoardPlay,
  type GameState,
  type LiePlay,
  type TriviaPlay,
} from "./logic.js";

/** Two people's states for the same game: the one who invited (host) and the one who accepted. */
function start(game: GameId, seed = 4) {
  const a = invite(null, game, seed);
  const b = accept(receive(null, a.send[0]!).state);
  return { host: receive(a.state, b.send[0]!).state, guest: b.state };
}

/** Make a move for one person and hand it to the other. */
function play(from: GameState, to: GameState, v: number) {
  const s = move(from, v);
  if (!s.send.length) return { from, to, sent: false };
  return { from: s.state, to: receive(to, s.send[0]!).state, sent: true };
}

const board = (s: GameState) => (s as { play: BoardPlay }).play;

describe("connect 4", () => {
  it("drops discs to the bottom of a column and stacks them", () => {
    let { host, guest } = start("c4");
    ({ from: host, to: guest } = play(host, guest, 3));
    expect(board(guest).board[5 * 7 + 3]).toBe(0);
    ({ from: guest, to: host } = play(guest, host, 3));
    expect(board(host).board[4 * 7 + 3]).toBe(1);
  });

  it("lets only the person whose turn it is play, and refuses a column that does not exist", () => {
    const { host, guest } = start("c4");
    expect(play(guest, host, 0).sent).toBe(false); // the host goes first on an even seed
    expect(play(host, guest, 7).sent).toBe(false);
  });

  it("refuses a full column", () => {
    let { host, guest } = start("c4");
    for (let i = 0; i < 3; i++) {
      ({ from: host, to: guest } = play(host, guest, 0));
      ({ from: guest, to: host } = play(guest, host, 0));
    }
    expect(play(host, guest, 0).sent).toBe(false);
    expect(play(host, guest, 1).sent).toBe(true);
  });

  it("finds four in a column and says who won", () => {
    let { host, guest } = start("c4");
    for (let i = 0; i < 3; i++) {
      ({ from: host, to: guest } = play(host, guest, 0));
      ({ from: guest, to: host } = play(guest, host, 1));
    }
    ({ from: host, to: guest } = play(host, guest, 0));
    const p = board(host);
    expect(p).toMatchObject({ over: true, winner: 0 });
    expect(p.line).toHaveLength(4);
    expect(summary(host)).toBe("Connect 4: You won.");
    expect(summary(guest)).toBe("Connect 4: They won.");
    expect(play(guest, host, 2).sent).toBe(false);
  });

  it("finds four across the bottom", () => {
    let { host, guest } = start("c4");
    for (const c of [0, 1, 2]) {
      ({ from: host, to: guest } = play(host, guest, c));
      ({ from: guest, to: host } = play(guest, host, c));
    }
    ({ from: host, to: guest } = play(host, guest, 3));
    expect(board(host).winner).toBe(0);
  });

  it("finds four on a diagonal", () => {
    let { host, guest } = start("c4");
    const columns = [0, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3]; // host, guest, host, guest, ...
    columns.forEach((c, i) => {
      if (i % 2 === 0) ({ from: host, to: guest } = play(host, guest, c));
      else ({ from: guest, to: host } = play(guest, host, c));
    });
    const p = board(host);
    expect(p.winner).toBe(0);
    // (row 2, column 3), (3, 2), (4, 1) and (5, 0), numbered across from the top left
    expect([...(p.line ?? [])].sort((a, b) => a - b)).toEqual([17, 23, 29, 35]);
  });
});

describe("trivia", () => {
  const right = (seed: number, r: number) => triviaQuestion(seed, r).c;
  const wrong = (seed: number, r: number) => (triviaQuestion(seed, r).c + 1) % 4;

  it("has enough questions, each with a valid right answer, and no repeats within five rounds", () => {
    expect(TRIVIA_COUNT).toBeGreaterThanOrEqual(30);
    for (let r = 0; r < 5; r++) {
      const q = triviaQuestion(7, r);
      expect(q.c).toBeGreaterThanOrEqual(0);
      expect(q.c).toBeLessThan(4);
    }
    const seen = new Set(Array.from({ length: 5 }, (_, r) => triviaQuestion(7, r).q));
    expect(seen.size).toBe(5);
  });

  it("scores each person's right answers and says who won after five questions", () => {
    const seed = 9;
    let { host, guest } = start("trivia", seed);
    for (let r = 0; r < 5; r++) {
      // the host is right every time; the guest is right on the first two only
      ({ from: host, to: guest } = play(host, guest, right(seed, r)));
      ({ from: guest, to: host } = play(guest, host, r < 2 ? right(seed, r) : wrong(seed, r)));
      host = advance(host);
      guest = advance(guest);
    }
    expect((host as { play: TriviaPlay }).play.over).toBe(true);
    expect(summary(host)).toBe("Trivia: You won, 5 to 2.");
    expect(summary(guest)).toBe("Trivia: They won, 2 to 5.");
  });

  it("calls it a draw when the scores are level, and refuses a fifth answer", () => {
    const seed = 3;
    let { host, guest } = start("trivia", seed);
    expect(move(host, 4).send).toEqual([]);
    for (let r = 0; r < 5; r++) {
      ({ from: host, to: guest } = play(host, guest, right(seed, r)));
      ({ from: guest, to: host } = play(guest, host, right(seed, r)));
      host = advance(host);
      guest = advance(guest);
    }
    expect(summary(host)).toBe("Trivia: It was a draw, 5 to 5.");
  });
});

describe("two truths and a lie", () => {
  const texts = ["I have a twin", "I have been to Japan", "I can juggle"];

  /** The host has written, and the guest has received the three statements. */
  function written(lie = 1) {
    const { host, guest } = start("ttl");
    const step = write(host, texts, lie);
    let g = guest;
    for (const m of step.send) g = receive(g, m).state;
    return { host: step.state, guest: g, sent: step.send };
  }
  const lieOf = (s: GameState) => (s as { play: LiePlay }).play;

  it("sends the three statements and never the lie", () => {
    const { sent } = written(1);
    expect(sent).toEqual([
      { k: "say", i: 0, text: "I have a twin" },
      { k: "say", i: 1, text: "I have been to Japan" },
      { k: "say", i: 2, text: "I can juggle" },
    ]);
  });

  it("lets the guesser guess, tells the writer, and then reveals the answer to the guesser", () => {
    let { host, guest } = written(1);
    const guess = move(guest, 1);
    expect(guess.send).toEqual([{ k: "move", r: 0, v: 1 }]);
    guest = guess.state;
    const reveal = receive(host, guess.send[0]!);
    host = reveal.state;
    expect(reveal.send).toEqual([{ k: "move", r: 0, v: 1 }]); // the lie, now told
    guest = receive(guest, reveal.send[0]!).state;
    expect(lieOf(host)).toMatchObject({ guess: 1, lie: 1, results: [true] });
    expect(lieOf(guest)).toMatchObject({ guess: 1, lie: 1, results: [true] });
  });

  it("swaps roles for the second round and finishes with each person's result", () => {
    let { host, guest } = written(1);
    // round 0: the guest finds the lie
    const g0 = move(guest, 1);
    guest = g0.state;
    const r0 = receive(host, g0.send[0]!);
    host = r0.state;
    guest = receive(guest, r0.send[0]!).state;
    host = advance(host);
    guest = advance(guest);
    expect(lieOf(host).round).toBe(1);
    // round 1: the guest writes, and the host guesses wrong
    const w = write(guest, ["a", "b", "c"], 2);
    guest = w.state;
    for (const m of w.send) host = receive(host, m).state;
    const h1 = move(host, 0);
    host = h1.state;
    const r1 = receive(guest, h1.send[0]!);
    guest = r1.state;
    host = receive(host, r1.send[0]!).state;
    host = advance(host);
    guest = advance(guest);
    expect(lieOf(host).over).toBe(true);
    expect(summary(host)).toBe(
      "Two truths and a lie: you missed their lie, and they spotted yours.",
    );
    expect(summary(guest)).toBe(
      "Two truths and a lie: you spotted their lie, and they missed yours.",
    );
  });

  it("only lets the right person write, and only once, with all three filled in", () => {
    const { host, guest } = start("ttl");
    expect(write(guest, texts, 0).send).toEqual([]); // it is the host's turn to write
    expect(write(host, ["a", "", "c"], 0).send).toEqual([]);
    expect(write(host, texts, 3).send).toEqual([]);
    const done = write(host, texts, 0);
    expect(write(done.state, texts, 1).send).toEqual([]); // not twice
  });

  it("does not let the guesser guess before all three statements are there, or guess twice", () => {
    const { host, guest } = start("ttl");
    expect(move(guest, 0).send).toEqual([]);
    const w = write(host, texts, 2);
    let g = receive(guest, w.send[0]!).state;
    expect(move(g, 0).send).toEqual([]);
    g = receive(receive(g, w.send[1]!).state, w.send[2]!).state;
    const first = move(g, 0);
    expect(first.send).toHaveLength(1);
    expect(move(first.state, 1).send).toEqual([]);
  });

  it("ignores statements sent to the person who is writing, and a guess nobody asked for", () => {
    const { host } = start("ttl");
    expect(receive(host, { k: "say", i: 0, text: "hello" }).state).toBe(host);
    expect(receive(host, { k: "move", r: 0, v: 1 }).state).toBe(host);
  });
});
