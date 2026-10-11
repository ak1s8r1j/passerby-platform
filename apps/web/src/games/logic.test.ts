import { describe, expect, it } from "vitest";
import {
  QUESTIONS_COUNT,
  accept,
  advance,
  decline,
  dismiss,
  invite,
  isPlaying,
  move,
  question,
  quit,
  receive,
  roundDone,
  summary,
  tttMoves,
  type GameState,
  type RpsPlay,
  type TttPlay,
  type WyrPlay,
} from "./logic.js";

/** Two people's states for the same game: the one who invited (host) and the one who accepted. */
function start(game: "wyr" | "rps" | "ttt", seed = 4) {
  const a = invite(null, game, seed);
  const inv = a.send[0]!;
  const b0 = receive(null, inv).state;
  const b = accept(b0);
  const hostState = receive(a.state, b.send[0]!).state;
  return { host: hostState, guest: b.state };
}

/** Make a move for one person and hand it to the other. */
function play(
  from: GameState,
  to: GameState,
  v: number,
): { from: GameState; to: GameState; sent: boolean } {
  const s = move(from, v);
  if (!s.send.length) return { from, to, sent: false };
  return { from: s.state, to: receive(to, s.send[0]!).state, sent: true };
}

describe("asking someone to play", () => {
  it("shows them the invitation, and starts when they say yes", () => {
    const a = invite(null, "rps", 10);
    expect(a.state).toMatchObject({ phase: "waiting", game: "rps" });
    expect(a.send).toEqual([{ k: "invite", game: "rps", seed: 10 }]);
    const b = receive(null, a.send[0]!);
    expect(b.state).toMatchObject({ phase: "invited", game: "rps" });
    const yes = accept(b.state);
    expect(yes.state).toMatchObject({ phase: "playing", host: false });
    expect(yes.send).toEqual([{ k: "accept" }]);
    expect(receive(a.state, yes.send[0]!).state).toMatchObject({ phase: "playing", host: true });
  });

  it("tells the inviter when they say no, and lets them take an invitation back", () => {
    const a = invite(null, "ttt", 3);
    const no = decline(receive(null, a.send[0]!).state);
    expect(no.state).toBeNull();
    expect(receive(a.state, no.send[0]!).state).toMatchObject({ phase: "declined" });
    const back = decline(a.state);
    expect(back.state).toBeNull();
    expect(receive(receive(null, a.send[0]!).state, back.send[0]!).state).toBeNull();
  });

  it("does not start a second game while one is going, and turns away a second invitation", () => {
    const { host } = start("ttt");
    expect(invite(host, "rps", 1)).toEqual({ state: host, send: [] });
    const r = receive(host, { k: "invite", game: "rps", seed: 1 });
    expect(r.state).toBe(host);
    expect(r.send).toEqual([{ k: "decline" }]);
  });

  it("settles two invitations sent at once: the lower number goes first", () => {
    const a = invite(null, "wyr", 100);
    const b = invite(null, "wyr", 200);
    const aAfter = receive(a.state, b.send[0]!).state; // a has the lower number: keeps waiting
    const bAfter = receive(b.state, a.send[0]!).state; // b yields and is invited
    expect(aAfter).toMatchObject({ phase: "waiting", seed: 100 });
    expect(bAfter).toMatchObject({ phase: "invited", seed: 100 });
  });

  it("lets a new game start once the last one is finished or refused", () => {
    expect(dismiss({ phase: "declined", game: "rps" })).toBeNull();
    expect(invite({ phase: "left", game: "rps" }, "wyr", 2).state).toMatchObject({
      phase: "waiting",
    });
  });
});

describe("would you rather", () => {
  it("gives both people the same question and moves on once both have picked", () => {
    let { host, guest } = start("wyr", 11);
    expect(isPlaying(host) && isPlaying(guest)).toBe(true);
    ({ from: host, to: guest } = play(host, guest, 0));
    expect(roundDone(host as never)).toBe(false);
    ({ from: guest, to: host } = play(guest, host, 1));
    expect(roundDone(host as never)).toBe(true);
    expect(roundDone(guest as never)).toBe(true);
    host = advance(host);
    guest = advance(guest);
    expect((host as { play: WyrPlay }).play.round).toBe(1);
    expect(question(11, 0)).not.toEqual(question(11, 1));
  });

  it("ignores a second pick in the same round", () => {
    const { host } = start("wyr");
    const first = move(host, 0).state;
    expect(move(first, 1).send).toEqual([]);
  });

  it("finishes after five rounds and says how many you agreed on", () => {
    let { host, guest } = start("wyr", 2);
    for (let r = 0; r < 5; r++) {
      ({ from: host, to: guest } = play(host, guest, 1));
      ({ from: guest, to: host } = play(guest, host, r % 2 === 0 ? 1 : 0));
      host = advance(host);
      guest = advance(guest);
    }
    expect((host as { play: WyrPlay }).play.over).toBe(true);
    expect(summary(host)).toBe("Would you rather: you agreed on 3 of 5.");
  });

  it("has enough questions that five rounds never repeat one", () => {
    const seen = new Set(Array.from({ length: 5 }, (_, r) => question(99, r).join("|")));
    expect(seen.size).toBe(5);
    expect(QUESTIONS_COUNT).toBeGreaterThanOrEqual(20);
  });
});

describe("rock paper scissors", () => {
  const rock = 0,
    paper = 1,
    scissors = 2;

  it("shows both hands once both have picked, and scores the round", () => {
    let { host, guest } = start("rps");
    ({ from: host, to: guest } = play(host, guest, paper));
    ({ from: guest, to: host } = play(guest, host, rock));
    const p = (host as { play: RpsPlay }).play;
    expect(p.reveal).toEqual({ me: paper, them: rock, outcome: "win" });
    expect(p.score).toEqual({ me: 1, them: 0 });
    const q = (guest as { play: RpsPlay }).play;
    expect(q.reveal?.outcome).toBe("lose");
  });

  it("goes again after a draw, and ends when someone has two wins", () => {
    let { host, guest } = start("rps");
    // round 1: draw
    ({ from: host, to: guest } = play(host, guest, rock));
    ({ from: guest, to: host } = play(guest, host, rock));
    expect((host as { play: RpsPlay }).play.reveal?.outcome).toBe("draw");
    host = advance(host);
    guest = advance(guest);
    expect((host as { play: RpsPlay }).play).toMatchObject({ round: 1, me: null, over: false });
    // two wins for the host
    for (let i = 0; i < 2; i++) {
      ({ from: host, to: guest } = play(host, guest, scissors));
      ({ from: guest, to: host } = play(guest, host, paper));
      host = advance(host);
      guest = advance(guest);
    }
    expect((host as { play: RpsPlay }).play.over).toBe(true);
    expect(summary(host)).toBe("Rock paper scissors: You won, 2 to 0.");
    expect(summary(guest)).toBe("Rock paper scissors: They won, 0 to 2.");
  });

  it("ignores a move for the wrong round", () => {
    const { host } = start("rps");
    const stale = receive(host, { k: "move", r: 3, v: 0 });
    expect((stale.state as { play: RpsPlay }).play.them).toBeNull();
  });
});

describe("tic-tac-toe", () => {
  it("lets only the person whose turn it is move, and passes moves along", () => {
    let { host, guest } = start("ttt", 4); // even seed: the host goes first
    expect(play(guest, host, 0).sent).toBe(false); // not their turn
    ({ from: host, to: guest } = play(host, guest, 4));
    expect((guest as { play: TttPlay }).play.board[4]).toBe(0);
    expect(play(host, guest, 0).sent).toBe(false); // host moved: now the guest's turn
    ({ from: guest, to: host } = play(guest, host, 0));
    expect((host as { play: TttPlay }).play.board[0]).toBe(1);
  });

  it("lets the guest start on an odd seed", () => {
    const { host, guest } = start("ttt", 5);
    expect(move(host, 0).send).toEqual([]);
    expect(move(guest, 0).send).toHaveLength(1);
  });

  it("does not allow a taken square", () => {
    let { host, guest } = start("ttt");
    ({ from: host, to: guest } = play(host, guest, 4));
    expect(play(guest, host, 4).sent).toBe(false);
  });

  it("finds a win, and says who won", () => {
    let { host, guest } = start("ttt", 4);
    for (const [h, g] of [
      [0, 3],
      [1, 4],
    ] as const) {
      ({ from: host, to: guest } = play(host, guest, h));
      ({ from: guest, to: host } = play(guest, host, g));
    }
    ({ from: host, to: guest } = play(host, guest, 2));
    const p = (host as { play: TttPlay }).play;
    expect(p).toMatchObject({ over: true, winner: 0, line: [0, 1, 2] });
    expect(summary(host)).toBe("Tic-tac-toe: You won.");
    expect(summary(guest)).toBe("Tic-tac-toe: They won.");
    expect(play(guest, host, 8).sent).toBe(false); // the game is over
  });

  it("calls a full board with no line a draw", () => {
    let { host, guest } = start("ttt", 4);
    // X O X / X O O / O X X  (host = X moves first), played in turn order
    const order = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    order.forEach((cell, i) => {
      if (i % 2 === 0) ({ from: host, to: guest } = play(host, guest, cell));
      else ({ from: guest, to: host } = play(guest, host, cell));
    });
    const p = (host as { play: TttPlay }).play;
    expect(tttMoves(p)).toBe(9);
    expect(p.winner).toBe("draw");
    expect(summary(host)).toBe("Tic-tac-toe: It was a draw.");
  });
});

describe("leaving", () => {
  it("tells the other person, who sees that the game ended", () => {
    const { host, guest } = start("rps");
    const left = quit(host);
    expect(left.state).toBeNull();
    expect(receive(guest, left.send[0]!).state).toMatchObject({ phase: "left" });
  });

  it("drops a pending invitation when the inviter takes it back", () => {
    const a = invite(null, "wyr", 1);
    const b = receive(null, a.send[0]!).state;
    expect(receive(b, { k: "quit" }).state).toBeNull();
  });
});
