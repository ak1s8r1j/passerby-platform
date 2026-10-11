import { useState } from "react";
import { GAME_IDS, MAX_GAME_TEXT_LENGTH, type GameId } from "@passerby/shared";
import {
  C4_COLS,
  C4_ROWS,
  GAMES,
  TRIVIA_ROUNDS,
  WYR_ROUNDS,
  c4Landing,
  iWrite,
  isPlaying,
  myMark,
  myTurn,
  question,
  summary,
  triviaQuestion,
  triviaScore,
  type BoardPlay,
  type GameState,
  type LiePlay,
  type Playing,
  type RpsPlay,
  type TriviaPlay,
  type WyrPlay,
} from "../games/logic.js";
import { GameArt } from "./GameArt.js";

interface Props {
  state: GameState;
  /** The list of games is open. */
  menuOpen: boolean;
  onPick(game: GameId): void;
  onCloseMenu(): void;
  onAccept(): void;
  onDecline(): void;
  onMove(v: number): void;
  /** Two truths and a lie: my three statements, and which of them is the lie. */
  onWrite(texts: string[], lie: number): void;
  onQuit(): void;
  onDismiss(): void;
}

const HANDS = [
  { emoji: "✊", name: "Rock" },
  { emoji: "✋", name: "Paper" },
  { emoji: "✌️", name: "Scissors" },
];
const MARKS = ["X", "O"];
const COLOURS = ["pink", "yellow"];

/** The games menu, an invitation, or the game itself: shown above the conversation. */
export function GamePanel(p: Props) {
  const { state } = p;
  if (!state && !p.menuOpen) return null;

  return (
    <section className="game" aria-label="Game">
      {!state && <Menu {...p} />}
      {state?.phase === "waiting" && (
        <div className="game-row">
          <p role="status">
            <GameArt game={state.game} mini /> Waiting for the stranger to join{" "}
            {GAMES[state.game].name}…
          </p>
          <button type="button" className="btn ghost" onClick={p.onDecline}>
            Cancel
          </button>
        </div>
      )}
      {state?.phase === "invited" && (
        <div className="game-row">
          <p role="status">
            <GameArt game={state.game} mini /> <strong>The stranger</strong> wants to play{" "}
            {GAMES[state.game].name}.
          </p>
          <span className="game-actions">
            <button type="button" className="btn go" onClick={p.onAccept}>
              Play
            </button>
            <button type="button" className="btn ghost" onClick={p.onDecline}>
              No thanks
            </button>
          </span>
        </div>
      )}
      {state?.phase === "declined" && (
        <div className="game-row">
          <p role="status">The stranger said no thanks.</p>
          <button type="button" className="btn ghost" onClick={p.onDismiss}>
            OK
          </button>
        </div>
      )}
      {state?.phase === "left" && (
        <div className="game-row">
          <p role="status">The stranger left the game.</p>
          <button type="button" className="btn ghost" onClick={p.onDismiss}>
            OK
          </button>
        </div>
      )}
      {isPlaying(state) && (
        <>
          <div className="game-head">
            <GameArt game={state.game} mini />
            <h3 className="game-title">{GAMES[state.game].name}</h3>
          </div>
          {state.game === "wyr" && <Wyr s={state} onMove={p.onMove} />}
          {state.game === "rps" && <Rps s={state} onMove={p.onMove} />}
          {state.game === "ttt" && <Ttt s={state} onMove={p.onMove} />}
          {state.game === "c4" && <Connect4 s={state} onMove={p.onMove} />}
          {state.game === "trivia" && <Trivia s={state} onMove={p.onMove} />}
          {state.game === "ttl" && <Lies s={state} onMove={p.onMove} onWrite={p.onWrite} />}
          <div className="game-foot">
            {state.play.over ? (
              <>
                <p role="status" className="game-result">
                  {summary(state)}
                </p>
                <button type="button" className="btn ghost" onClick={p.onDismiss}>
                  Close
                </button>
              </>
            ) : (
              <button type="button" className="btn ghost" onClick={p.onQuit}>
                Leave game
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Menu({ onPick, onCloseMenu }: Props) {
  return (
    <>
      <div className="game-row">
        <h3 className="game-title">Play a game</h3>
        <button type="button" className="link" onClick={onCloseMenu}>
          Cancel
        </button>
      </div>
      <div className="game-menu">
        {GAME_IDS.map((id) => (
          <button key={id} type="button" className="game-pick" onClick={() => onPick(id)}>
            <GameArt game={id} />
            <strong>{GAMES[id].name}</strong>
            <span>{GAMES[id].blurb}</span>
          </button>
        ))}
      </div>
      <p className="hint">The stranger can say no, and nothing is saved.</p>
    </>
  );
}

interface View {
  s: Playing;
  onMove(v: number): void;
}

function Wyr({ s, onMove }: View) {
  const p = s.play as WyrPlay;
  if (p.over) return null;
  const q = question(s.seed, p.round);
  const pick = p.picks[p.round]!;
  const note =
    pick.me === null
      ? "Pick one."
      : pick.them === null
        ? "Waiting for the stranger…"
        : pick.me === pick.them
          ? `You both picked “${q[pick.me]}”.`
          : `You picked “${q[pick.me]}”, they picked “${q[pick.them]}”.`;
  return (
    <>
      <p className="game-sub">
        Round {p.round + 1} of {WYR_ROUNDS}
      </p>
      <div className="wyr">
        {[0, 1].map((i) => (
          <button
            key={i}
            type="button"
            className="wyr-opt"
            aria-pressed={pick.me === i}
            disabled={pick.me !== null}
            onClick={() => onMove(i)}
          >
            {q[i]}
          </button>
        ))}
      </div>
      <p role="status" className="game-note">
        {note}
      </p>
    </>
  );
}

function Rps({ s, onMove }: View) {
  const p = s.play as RpsPlay;
  const note = p.reveal
    ? `You: ${HANDS[p.reveal.me]!.name}. Them: ${HANDS[p.reveal.them]!.name}. ${
        p.reveal.outcome === "win"
          ? "You win this round."
          : p.reveal.outcome === "lose"
            ? "They win this round."
            : "A draw. Go again."
      }`
    : p.me === null
      ? "Choose your hand."
      : "Waiting for the stranger…";
  return (
    <>
      <p className="game-sub">
        You {p.score.me} – {p.score.them} Stranger
      </p>
      {!p.over && (
        <div className="rps">
          {HANDS.map((h, i) => (
            <button
              key={h.name}
              type="button"
              className="rps-hand"
              aria-label={h.name}
              aria-pressed={p.me === i}
              disabled={p.me !== null}
              onClick={() => onMove(i)}
            >
              <span aria-hidden="true">{h.emoji}</span>
            </button>
          ))}
        </div>
      )}
      <p role="status" className="game-note">
        {note}
      </p>
    </>
  );
}

function Ttt({ s, onMove }: View) {
  const p = s.play as BoardPlay;
  const mine = myTurn(s);
  const note = p.over
    ? ""
    : mine
      ? `Your turn. You are ${MARKS[myMark(s.host)]}.`
      : "The stranger's turn.";
  return (
    <>
      <div className="ttt" role="group" aria-label="Tic-tac-toe board">
        {p.board.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`ttt-cell${p.line?.includes(i) ? " win" : ""}`}
            aria-label={`Square ${i + 1}, ${c === null ? "empty" : MARKS[c]}`}
            disabled={!mine || c !== null}
            onClick={() => onMove(i)}
          >
            {c === null ? "" : MARKS[c]}
          </button>
        ))}
      </div>
      <p role="status" className="game-note">
        {note}
      </p>
    </>
  );
}

function Connect4({ s, onMove }: View) {
  const p = s.play as BoardPlay;
  const mine = myTurn(s);
  const note = p.over
    ? ""
    : mine
      ? `Your turn. You are ${COLOURS[myMark(s.host)]}.`
      : "The stranger's turn.";
  return (
    <>
      <div className="c4" role="group" aria-label="Connect 4 board">
        {Array.from({ length: C4_COLS }, (_, col) => (
          <button
            key={col}
            type="button"
            className="c4-col"
            aria-label={`Drop a disc in column ${col + 1}`}
            disabled={!mine || c4Landing(p, col) < 0}
            onClick={() => onMove(col)}
          >
            {Array.from({ length: C4_ROWS }, (_, row) => {
              const at = row * C4_COLS + col;
              const c = p.board[at];
              return (
                <span
                  key={row}
                  className={`c4-cell${c === null ? "" : ` d${c}`}${p.line?.includes(at) ? " win" : ""}`}
                />
              );
            })}
          </button>
        ))}
      </div>
      <p role="status" className="game-note">
        {note}
      </p>
    </>
  );
}

function Trivia({ s, onMove }: View) {
  const p = s.play as TriviaPlay;
  if (p.over) {
    const sc = triviaScore(s);
    return (
      <p className="game-sub">
        You {sc.me} – {sc.them} Stranger
      </p>
    );
  }
  const q = triviaQuestion(s.seed, p.round);
  const pick = p.picks[p.round]!;
  const both = pick.me !== null && pick.them !== null;
  const sc = triviaScore(s);
  const note = both
    ? pick.me === q.c
      ? `Correct!${pick.them === q.c ? " They got it too." : " They missed it."}`
      : `Not quite. It was “${q.a[q.c]}”.${pick.them === q.c ? " They got it." : ""}`
    : pick.me === null
      ? "Choose an answer."
      : "Waiting for the stranger…";
  return (
    <>
      <p className="game-sub">
        Question {p.round + 1} of {TRIVIA_ROUNDS} · You {sc.me} – {sc.them} Stranger
      </p>
      <p className="trivia-q">{q.q}</p>
      <div className="trivia">
        {q.a.map((answer, i) => (
          <button
            key={i}
            type="button"
            className={`trivia-opt${both && i === q.c ? " right" : ""}${
              both && pick.me === i && i !== q.c ? " wrong" : ""
            }`}
            aria-pressed={pick.me === i}
            disabled={pick.me !== null}
            onClick={() => onMove(i)}
          >
            {answer}
          </button>
        ))}
      </div>
      <p role="status" className="game-note">
        {note}
      </p>
    </>
  );
}

/** Mix the statements up, and say where the lie ended up, so the order they were typed in tells nothing. */
function shuffled(texts: string[], lie: number): { texts: string[]; lie: number } {
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { texts: order.map((i) => texts[i]!), lie: order.indexOf(lie) };
}

function Lies({ s, onMove, onWrite }: View & { onWrite(texts: string[], lie: number): void }) {
  const p = s.play as LiePlay;
  const [texts, setTexts] = useState(["", "", ""]);
  const [lie, setLie] = useState<number | null>(null);
  if (p.over) return null;

  const writer = iWrite(s);
  const written = p.statements.every((x) => x !== null);
  const revealed = p.lie !== null;
  const round = `Round ${p.round + 1} of 2`;

  if (writer && p.mineLie === null) {
    const ready = texts.every((t) => t.trim()) && lie !== null;
    return (
      <form
        className="lies-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || lie === null) return;
          const mixed = shuffled(texts, lie);
          onWrite(mixed.texts, mixed.lie);
        }}
      >
        <p className="game-sub">{round}: write two true things and one lie.</p>
        {texts.map((t, i) => (
          <div key={i} className="lies-line">
            <input
              value={t}
              maxLength={MAX_GAME_TEXT_LENGTH}
              autoComplete="off"
              aria-label={`Statement ${i + 1}`}
              placeholder={i === 0 ? "Something about you…" : "Another one…"}
              onChange={(e) => setTexts(texts.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <label className="lies-lie">
              <input
                type="radio"
                name="lie"
                checked={lie === i}
                onChange={() => setLie(i)}
                aria-label={`Statement ${i + 1} is the lie`}
              />
              <span>Lie</span>
            </label>
          </div>
        ))}
        <button type="submit" className="btn go" disabled={!ready}>
          Send to the stranger
        </button>
      </form>
    );
  }

  if (!writer && !written) {
    return (
      <>
        <p className="game-sub">{round}</p>
        <p role="status" className="game-note">
          The stranger is writing three statements…
        </p>
      </>
    );
  }

  // Everyone can see the three statements now: the writer waits, the guesser chooses.
  const note = revealed
    ? writer
      ? p.guess === p.lie
        ? "They spotted your lie."
        : "They guessed wrong. You fooled them!"
      : p.guess === p.lie
        ? "You spotted the lie!"
        : "Not quite. That one was true."
    : writer
      ? "Waiting for the stranger to guess…"
      : p.guess === null
        ? "Which one is the lie?"
        : "Waiting for the answer…";
  return (
    <>
      <p className="game-sub">
        {round}: {writer ? "your statements" : "the stranger's statements"}
      </p>
      <div className="lies-list">
        {p.statements.map((t, i) => (
          <button
            key={i}
            type="button"
            className={`lies-opt${revealed && i === p.lie ? " lie" : ""}${
              p.guess === i ? " guessed" : ""
            }`}
            disabled={writer || p.guess !== null}
            onClick={() => onMove(i)}
          >
            {t}
            {writer && p.mineLie === i && !revealed && <em> (your lie)</em>}
            {revealed && i === p.lie && <em> (the lie)</em>}
          </button>
        ))}
      </div>
      <p role="status" className="game-note">
        {note}
      </p>
    </>
  );
}
