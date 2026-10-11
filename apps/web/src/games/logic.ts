import { MAX_GAME_TEXT_LENGTH, type GameId, type GameMessage } from "@passerby/shared";
import { QUESTIONS } from "./questions.js";
import { TRIVIA, type TriviaQuestion } from "./trivia.js";

/** What each game is called, and a line about it. */
export const GAMES: Record<GameId, { name: string; blurb: string }> = {
  wyr: { name: "Would you rather", blurb: "Five quick questions. See if you agree." },
  rps: { name: "Rock paper scissors", blurb: "First to two wins." },
  ttt: { name: "Tic-tac-toe", blurb: "Three in a row." },
  c4: { name: "Connect 4", blurb: "Drop discs. Get four in a row." },
  trivia: { name: "Trivia", blurb: "Five questions. Most right wins." },
  ttl: { name: "Two truths and a lie", blurb: "Write three. Can they spot the lie?" },
};

export const QUESTIONS_COUNT = QUESTIONS.length;
export const TRIVIA_COUNT = TRIVIA.length;
export const WYR_ROUNDS = 5;
export const TRIVIA_ROUNDS = 5;
export const RPS_WINS = 2;
const RPS_MAX_ROUNDS = 6;
export const C4_COLS = 7;
export const C4_ROWS = 6;
/** How long an invitation is open for, and how long an answer is shown before the next round. */
export const INVITE_OPEN_MS = 30_000;
export const REVEAL_MS = 2500;

export interface WyrPlay {
  round: number;
  picks: { me: number | null; them: number | null }[];
  over: boolean;
}
export interface RpsPlay {
  round: number;
  me: number | null;
  them: number | null;
  score: { me: number; them: number };
  /** Set once both have picked, until the next round starts. */
  reveal: { me: number; them: number; outcome: "win" | "lose" | "draw" } | null;
  over: boolean;
}
/** Tic-tac-toe and Connect 4: a board and whose turn it is. */
export interface BoardPlay {
  /** 0 is the person who invited, 1 is the person who accepted. */
  board: (0 | 1 | null)[];
  turn: 0 | 1;
  winner: 0 | 1 | "draw" | null;
  line: number[] | null;
  over: boolean;
}
export type TttPlay = BoardPlay;
export type C4Play = BoardPlay;
export interface TriviaPlay {
  round: number;
  picks: { me: number | null; them: number | null }[];
  over: boolean;
}
export interface LiePlay {
  /** 0: the person who invited writes and the other guesses. 1: the other way round. */
  round: number;
  /** The three statements of this round: written by me, or received from them. */
  statements: (string | null)[];
  /** Which of my statements is the lie. Only I know this, until they have guessed. */
  mineLie: number | null;
  guess: number | null;
  /** The lie, once it has been revealed. */
  lie: number | null;
  /** For each finished round: did the guesser find the lie? */
  results: boolean[];
  over: boolean;
}
export type Play = WyrPlay | RpsPlay | BoardPlay | TriviaPlay | LiePlay;

export type GameState =
  | null
  /** I invited them and am waiting for an answer. */
  | { phase: "waiting"; game: GameId; seed: number }
  /** They invited me. */
  | { phase: "invited"; game: GameId; seed: number }
  | { phase: "playing"; game: GameId; seed: number; host: boolean; play: Play }
  /** They said no thanks. */
  | { phase: "declined"; game: GameId }
  /** They left a game that was going. */
  | { phase: "left"; game: GameId };

/** A change of state, and anything to tell the other person. */
export interface Step {
  state: GameState;
  send: GameMessage[];
}
const stay = (state: GameState): Step => ({ state, send: [] });

export type Playing = Extract<NonNullable<GameState>, { phase: "playing" }>;
export const isPlaying = (s: GameState): s is Playing => s?.phase === "playing";
const isFree = (s: GameState) =>
  s === null || s.phase === "declined" || s.phase === "left" || (isPlaying(s) && s.play.over);

// ---- helpers ----

/** The question for a round. Both people get the same one, because they share the seed. */
export function question(seed: number, round: number): readonly [string, string] {
  return QUESTIONS[(seed + round * 7) % QUESTIONS.length]!;
}
export function triviaQuestion(seed: number, round: number): TriviaQuestion {
  return TRIVIA[(seed + round * 7) % TRIVIA.length]!;
}
/** How many questions each person has got right, counting only the rounds both have answered. */
export function triviaScore(s: Playing): { me: number; them: number } {
  const p = s.play as TriviaPlay;
  let me = 0;
  let them = 0;
  p.picks.forEach((x, i) => {
    if (x.me === null || x.them === null) return;
    const c = triviaQuestion(s.seed, i).c;
    if (x.me === c) me++;
    if (x.them === c) them++;
  });
  return { me, them };
}

/** Which mark (0 or 1) is mine. */
export const myMark = (host: boolean): 0 | 1 => (host ? 0 : 1);
/** How many marks or discs are on a board: also the number of the next move. */
export const boardMoves = (p: BoardPlay) => p.board.filter((c) => c !== null).length;
export const tttMoves = boardMoves;
/** Is it my turn in a board game? */
export const myTurn = (s: Playing) =>
  (s.game === "ttt" || s.game === "c4") &&
  !(s.play as BoardPlay).over &&
  (s.play as BoardPlay).turn === myMark(s.host);
/** In Two truths and a lie, am I the one writing this round? */
export const iWrite = (s: Playing) => ((s.play as LiePlay).round === 0) === s.host;

function freshPlay(game: GameId, seed: number): Play {
  const first: 0 | 1 = seed % 2 === 0 ? 0 : 1;
  switch (game) {
    case "wyr":
    case "trivia":
      return {
        round: 0,
        picks: Array.from({ length: game === "wyr" ? WYR_ROUNDS : TRIVIA_ROUNDS }, () => ({
          me: null,
          them: null,
        })),
        over: false,
      };
    case "rps":
      return {
        round: 0,
        me: null,
        them: null,
        score: { me: 0, them: 0 },
        reveal: null,
        over: false,
      };
    case "ttt":
      return {
        board: Array<0 | 1 | null>(9).fill(null),
        turn: first,
        winner: null,
        line: null,
        over: false,
      };
    case "c4":
      return {
        board: Array<0 | 1 | null>(C4_COLS * C4_ROWS).fill(null),
        turn: first,
        winner: null,
        line: null,
        over: false,
      };
    case "ttl":
      return freshLie(0, []);
  }
}

const freshLie = (round: number, results: boolean[]): LiePlay => ({
  round,
  statements: [null, null, null],
  mineLie: null,
  guess: null,
  lie: null,
  results,
  over: false,
});

const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** The four or more discs in a row that include the one just placed, or null. */
function c4Line(board: (0 | 1 | null)[], at: number): number[] | null {
  const mark = board[at];
  const row = Math.floor(at / C4_COLS);
  const col = at % C4_COLS;
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const) {
    const cells = [at];
    for (const sign of [1, -1]) {
      for (let k = 1; k < C4_COLS; k++) {
        const r = row + dr * k * sign;
        const c = col + dc * k * sign;
        if (r < 0 || r >= C4_ROWS || c < 0 || c >= C4_COLS) break;
        if (board[r * C4_COLS + c] !== mark) break;
        cells.push(r * C4_COLS + c);
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

/** Where a disc dropped in a column lands, or -1 when the column is full. */
export function c4Landing(p: BoardPlay, col: number): number {
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (p.board[r * C4_COLS + col] === null) return r * C4_COLS + col;
  }
  return -1;
}

/** Is this round finished, waiting to move on? */
export function roundDone(s: Playing): boolean {
  if (s.play.over) return false;
  switch (s.game) {
    case "wyr":
    case "trivia": {
      const p = s.play as WyrPlay | TriviaPlay;
      const pick = p.picks[p.round]!;
      return pick.me !== null && pick.them !== null;
    }
    case "rps":
      return (s.play as RpsPlay).reveal !== null;
    case "ttl": {
      const p = s.play as LiePlay;
      return p.guess !== null && p.lie !== null;
    }
    default:
      return false;
  }
}

/** Someone's move in a game, from me or from them. Anything that does not fit the rules changes nothing. */
function applyMove(s: Playing, who: "me" | "them", r: number, v: number): Playing {
  const { play } = s;
  if (play.over) return s;

  if (s.game === "wyr" || s.game === "trivia") {
    const p = play as WyrPlay | TriviaPlay;
    const max = s.game === "wyr" ? 1 : 3;
    if (r !== p.round || v < 0 || v > max || p.picks[p.round]![who] !== null) return s;
    const picks = p.picks.map((x, i) => (i === p.round ? { ...x, [who]: v } : x));
    return { ...s, play: { ...p, picks } };
  }

  if (s.game === "rps") {
    const p = play as RpsPlay;
    if (r !== p.round || v < 0 || v > 2 || p[who] !== null || p.reveal) return s;
    const next: RpsPlay = { ...p, [who]: v };
    if (next.me !== null && next.them !== null) {
      const diff = (next.me - next.them + 3) % 3;
      const outcome = diff === 0 ? "draw" : diff === 1 ? "win" : "lose";
      next.reveal = { me: next.me, them: next.them, outcome };
      next.score = {
        me: p.score.me + (outcome === "win" ? 1 : 0),
        them: p.score.them + (outcome === "lose" ? 1 : 0),
      };
    }
    return { ...s, play: next };
  }

  if (s.game === "ttl") {
    const p = play as LiePlay;
    // A guess: only the person who did not write can make one, once all three statements are there.
    if (r !== p.round || v < 0 || v > 2 || iWrite(s) || p.guess !== null) return s;
    if (who !== "me" || p.statements.some((x) => x === null)) return s;
    return { ...s, play: { ...p, guess: v } };
  }

  // tic-tac-toe and Connect 4
  const p = play as BoardPlay;
  const mark: 0 | 1 = who === "me" ? myMark(s.host) : myMark(!s.host);
  if (r !== boardMoves(p) || p.turn !== mark) return s;
  const board = p.board.slice();
  let at = v;
  if (s.game === "ttt") {
    if (v < 0 || v > 8 || board[v] !== null) return s;
  } else {
    if (v < 0 || v >= C4_COLS) return s;
    at = c4Landing(p, v);
    if (at < 0) return s;
  }
  board[at] = mark;
  const line =
    s.game === "ttt"
      ? (TTT_LINES.find((l) => l.every((i) => board[i] === mark)) ?? null)
      : c4Line(board, at);
  const full = board.every((c) => c !== null);
  const next: BoardPlay = {
    board,
    turn: p.turn === 0 ? 1 : 0,
    winner: line ? mark : full ? "draw" : null,
    line,
    over: line !== null || full,
  };
  return { ...s, play: next };
}

/** Move to the next round after an answer has been shown, or finish. */
export function advance(s: GameState): GameState {
  if (!isPlaying(s) || !roundDone(s)) return s;
  if (s.game === "wyr" || s.game === "trivia") {
    const p = s.play as WyrPlay | TriviaPlay;
    return p.round >= p.picks.length - 1
      ? { ...s, play: { ...p, over: true } }
      : { ...s, play: { ...p, round: p.round + 1 } };
  }
  if (s.game === "ttl") {
    const p = s.play as LiePlay;
    return p.round >= 1
      ? { ...s, play: { ...p, over: true } }
      : { ...s, play: freshLie(p.round + 1, p.results) };
  }
  const p = s.play as RpsPlay;
  const decided =
    p.score.me >= RPS_WINS || p.score.them >= RPS_WINS || p.round + 1 >= RPS_MAX_ROUNDS;
  return decided
    ? { ...s, play: { ...p, over: true } }
    : { ...s, play: { ...p, round: p.round + 1, me: null, them: null, reveal: null } };
}

/** A one-line result for the conversation, when a game is over. */
export function summary(s: GameState): string | null {
  if (!isPlaying(s) || !s.play.over) return null;
  const name = GAMES[s.game].name;
  const verdict = (me: number, them: number) =>
    me > them ? "You won" : me < them ? "They won" : "It was a draw";
  switch (s.game) {
    case "wyr": {
      const p = s.play as WyrPlay;
      const same = p.picks.filter((x) => x.me !== null && x.me === x.them).length;
      return `${name}: you agreed on ${same} of ${WYR_ROUNDS}.`;
    }
    case "rps": {
      const { me, them } = (s.play as RpsPlay).score;
      return `${name}: ${verdict(me, them)}, ${me} to ${them}.`;
    }
    case "trivia": {
      const { me, them } = triviaScore(s);
      return `${name}: ${verdict(me, them)}, ${me} to ${them}.`;
    }
    case "ttl": {
      const r = (s.play as LiePlay).results;
      // Round 0: the inviter wrote. Round 1: the other person did.
      const found = s.host ? r[1] : r[0];
      const theyFound = s.host ? r[0] : r[1];
      return `${name}: you ${found ? "spotted their lie" : "missed their lie"}, and they ${
        theyFound ? "spotted yours" : "missed yours"
      }.`;
    }
    default: {
      const w = (s.play as BoardPlay).winner;
      return `${name}: ${w === "draw" ? "It was a draw" : w === myMark(s.host) ? "You won" : "They won"}.`;
    }
  }
}

// ---- changes of state ----

/** I ask them to play. */
export function invite(s: GameState, game: GameId, seed: number): Step {
  if (!isFree(s)) return stay(s);
  return { state: { phase: "waiting", game, seed }, send: [{ k: "invite", game, seed }] };
}

/** I say yes to their invitation. */
export function accept(s: GameState): Step {
  if (s?.phase !== "invited") return stay(s);
  return {
    state: {
      phase: "playing",
      game: s.game,
      seed: s.seed,
      host: false,
      play: freshPlay(s.game, s.seed),
    },
    send: [{ k: "accept" }],
  };
}

/** I say no to their invitation, or take back my own. */
export function decline(s: GameState): Step {
  if (s?.phase === "invited") return { state: null, send: [{ k: "decline" }] };
  if (s?.phase === "waiting") return { state: null, send: [{ k: "quit" }] };
  return stay(s);
}

/** The number a move is sent with: the round, or how many marks are on a board. */
function roundOf(s: Playing): number {
  return s.game === "ttt" || s.game === "c4"
    ? boardMoves(s.play as BoardPlay)
    : (s.play as WyrPlay | RpsPlay | TriviaPlay | LiePlay).round;
}

/** I make a move: a choice for a round, a square, a column, or a guess. */
export function move(s: GameState, v: number): Step {
  if (!isPlaying(s)) return stay(s);
  const r = roundOf(s);
  const next = applyMove(s, "me", r, v);
  return next === s ? stay(s) : { state: next, send: [{ k: "move", r, v }] };
}

/**
 * Two truths and a lie: I write my three statements and say which is the lie. The lie is kept here and only
 * told to them after they have guessed, so nobody can read it from the messages beforehand.
 */
export function write(s: GameState, texts: string[], lie: number): Step {
  if (!isPlaying(s) || s.game !== "ttl" || s.play.over || !iWrite(s)) return stay(s);
  const p = s.play as LiePlay;
  const clean = texts.map((t) => t.trim().slice(0, MAX_GAME_TEXT_LENGTH));
  if (
    p.statements.some((x) => x !== null) ||
    clean.length !== 3 ||
    clean.some((t) => !t) ||
    !(lie >= 0 && lie <= 2)
  ) {
    return stay(s);
  }
  return {
    state: { ...s, play: { ...p, statements: clean, mineLie: lie } },
    send: clean.map((text, i) => ({ k: "say", i, text }) as const),
  };
}

/** I leave a game that is going. */
export function quit(s: GameState): Step {
  if (!isPlaying(s) || s.play.over) return stay(null);
  return { state: null, send: [{ k: "quit" }] };
}

/** Put the finished or refused game away. */
export const dismiss = (s: GameState): GameState => (isFree(s) ? null : s);

/** Something from the other person during Two truths and a lie. */
function receiveLie(s: Playing, g: GameMessage): Step {
  const p = s.play as LiePlay;
  if (p.over) return stay(s);
  if (g.k === "say") {
    // Statements come from the writer, so only the guesser takes them in.
    if (iWrite(s) || p.statements[g.i] !== null) return stay(s);
    const statements = p.statements.slice();
    statements[g.i] = g.text;
    return stay({ ...s, play: { ...p, statements } });
  }
  if (g.k !== "move" || g.r !== p.round || g.v > 2) return stay(s);
  if (iWrite(s)) {
    // Their guess. Tell them the answer, and keep the result.
    if (p.mineLie === null || p.guess !== null) return stay(s);
    const play: LiePlay = {
      ...p,
      guess: g.v,
      lie: p.mineLie,
      results: [...p.results, g.v === p.mineLie],
    };
    return { state: { ...s, play }, send: [{ k: "move", r: p.round, v: p.mineLie }] };
  }
  // The answer to my guess.
  if (p.guess === null || p.lie !== null) return stay(s);
  return stay({
    ...s,
    play: { ...p, lie: g.v, results: [...p.results, p.guess === g.v] },
  });
}

/** Something from the other person. */
export function receive(s: GameState, g: GameMessage): Step {
  switch (g.k) {
    case "invite":
      if (isFree(s)) return stay({ phase: "invited", game: g.game, seed: g.seed });
      // Both asked at once: the lower number goes first, and the other yields.
      if (s?.phase === "waiting" && g.seed < s.seed) {
        return stay({ phase: "invited", game: g.game, seed: g.seed });
      }
      if (s?.phase === "waiting" || s?.phase === "invited") return stay(s);
      return { state: s, send: [{ k: "decline" }] }; // busy playing
    case "accept":
      return s?.phase === "waiting"
        ? stay({
            phase: "playing",
            game: s.game,
            seed: s.seed,
            host: true,
            play: freshPlay(s.game, s.seed),
          })
        : stay(s);
    case "decline":
      return s?.phase === "waiting" ? stay({ phase: "declined", game: s.game }) : stay(s);
    case "quit":
      if (s?.phase === "invited") return stay(null);
      if (isPlaying(s) && !s.play.over) return stay({ phase: "left", game: s.game });
      return stay(s);
    case "move":
    case "say":
      if (!isPlaying(s)) return stay(s);
      if (s.game === "ttl") return receiveLie(s, g);
      return g.k === "move" ? stay(applyMove(s, "them", g.r, g.v)) : stay(s);
  }
}
