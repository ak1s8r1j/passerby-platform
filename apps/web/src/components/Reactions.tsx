import { REACTIONS, type Reaction } from "@passerby/shared";

/** One reaction floating up the chat. `side` is who sent it, so it rises from their side. */
export interface Floating {
  id: number;
  emoji: Reaction;
  side: "me" | "them";
  /** 0 to 1: how far across its side it drifts from, so a burst does not stack in one line. */
  x: number;
}

const NAMES: Record<Reaction, string> = {
  "❤️": "heart",
  "😂": "laugh",
  "🔥": "fire",
  "👏": "clap",
  "😮": "wow",
  "👋": "wave",
};

/** A row of quick reaction buttons. */
export function ReactionBar({ onReact }: { onReact(e: Reaction): void }) {
  return (
    <div className="reactions" role="group" aria-label="Send a reaction">
      {REACTIONS.map((e) => (
        <button key={e} type="button" aria-label={`Send ${NAMES[e]}`} onClick={() => onReact(e)}>
          <span aria-hidden="true">{e}</span>
        </button>
      ))}
    </div>
  );
}

/** The emoji that are rising right now. Purely decorative: the buttons already say what was sent. */
export function ReactionLayer({ items }: { items: Floating[] }) {
  return (
    <div className="float-layer" aria-hidden="true">
      {items.map((f) => (
        <span
          key={f.id}
          className={`float ${f.side}`}
          style={{ [f.side === "me" ? "right" : "left"]: `${8 + f.x * 22}%` }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
