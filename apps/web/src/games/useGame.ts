import { useCallback, useEffect, useRef, useState } from "react";
import type { GameId, GameMessage } from "@passerby/shared";
import {
  INVITE_OPEN_MS,
  REVEAL_MS,
  accept,
  advance,
  decline,
  dismiss,
  invite,
  isPlaying,
  move,
  quit,
  receive,
  roundDone,
  summary,
  write,
  type GameState,
  type Step,
} from "./logic.js";

interface Options {
  /** Hand a game message to the connection, to pass to the other person. */
  send(g: GameMessage): void;
  /** Called once with a one-line result when a game finishes. */
  onResult(text: string): void;
}

/** The game with the other person in this chat: its state, and what the visitor can do. */
export function useGame({ send, onResult }: Options) {
  const [state, setState] = useState<GameState>(null);
  const ref = useRef<GameState>(null);
  const latest = useRef({ send, onResult });
  useEffect(() => {
    latest.current = { send, onResult };
  });

  const put = useCallback((next: GameState) => {
    const was = ref.current;
    ref.current = next;
    setState(next);
    // Say the result once, when a game that was going has just finished.
    if (isPlaying(next) && next.play.over && !(isPlaying(was) && was.play.over)) {
      const text = summary(next);
      if (text) latest.current.onResult(text);
    }
  }, []);
  const run = useCallback(
    (step: Step) => {
      put(step.state);
      for (const g of step.send) latest.current.send(g);
    },
    [put],
  );

  // An invitation nobody answered fades away, and an answer is shown for a moment before the next round.
  useEffect(() => {
    if (!state) return;
    if (state.phase === "waiting" || state.phase === "invited") {
      const t = setTimeout(() => put(null), INVITE_OPEN_MS);
      return () => clearTimeout(t);
    }
    if (isPlaying(state) && roundDone(state)) {
      const t = setTimeout(() => put(advance(ref.current)), REVEAL_MS);
      return () => clearTimeout(t);
    }
  }, [state, put]);

  return {
    state,
    invite: (game: GameId) => run(invite(ref.current, game, Math.floor(Math.random() * 1_000_001))),
    accept: () => run(accept(ref.current)),
    decline: () => run(decline(ref.current)),
    move: (v: number) => run(move(ref.current, v)),
    write: (texts: string[], lie: number) => run(write(ref.current, texts, lie)),
    quit: () => run(quit(ref.current)),
    dismiss: () => put(dismiss(ref.current)),
    receive: (g: GameMessage) => run(receive(ref.current, g)),
    /** A new chat, or the chat ended: any game is over. */
    reset: () => put(null),
  };
}
