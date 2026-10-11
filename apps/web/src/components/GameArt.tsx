import type { GameId } from "@passerby/shared";

const ink = "#fff";

/** A small picture for each game, drawn here so nothing is downloaded. Decorative: the name is always beside it. */
export function GameArt({ game, mini = false }: { game: GameId; mini?: boolean }) {
  return (
    <span className={`game-art art-${game}${mini ? " mini" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 120 72" role="presentation" focusable="false">
        {game === "wyr" && (
          <>
            <rect x="8" y="12" width="42" height="48" rx="11" fill={ink} opacity="0.95" />
            <rect x="70" y="12" width="42" height="48" rx="11" fill={ink} opacity="0.55" />
            <text x="29" y="44" textAnchor="middle" fontSize="24" fontWeight="800" fill="#6d28d9">
              A
            </text>
            <text x="91" y="44" textAnchor="middle" fontSize="24" fontWeight="800" fill="#fff">
              B
            </text>
            <circle cx="60" cy="36" r="11" fill="#1a1033" />
            <text x="60" y="42" textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff">
              ?
            </text>
          </>
        )}
        {game === "rps" && (
          <>
            <circle cx="26" cy="36" r="15" fill={ink} opacity="0.95" />
            <rect x="46" y="18" width="28" height="36" rx="5" fill={ink} opacity="0.75" />
            <path
              d="M86 20l22 32M108 20L86 52"
              stroke={ink}
              strokeWidth="5"
              strokeLinecap="round"
            />
            <circle cx="88" cy="56" r="5" fill="none" stroke={ink} strokeWidth="3" />
            <circle cx="106" cy="56" r="5" fill="none" stroke={ink} strokeWidth="3" />
          </>
        )}
        {game === "ttt" && (
          <>
            <path
              d="M50 8v56M70 8v56M30 26h60M30 46h60"
              stroke={ink}
              strokeWidth="4"
              strokeLinecap="round"
              opacity="0.9"
            />
            <path d="M36 12l8 10M44 12l-8 10" stroke={ink} strokeWidth="4" strokeLinecap="round" />
            <circle cx="60" cy="36" r="6" fill="none" stroke="#ffd0e6" strokeWidth="4" />
            <path d="M76 50l8 10M84 50l-8 10" stroke={ink} strokeWidth="4" strokeLinecap="round" />
          </>
        )}
        {game === "c4" && (
          <>
            <rect x="14" y="8" width="92" height="58" rx="10" fill="#1a1033" opacity="0.55" />
            {[0, 1, 2].map((r) =>
              [0, 1, 2, 3, 4].map((c) => {
                const x = 30 + c * 15;
                const y = 20 + r * 17;
                const fill =
                  r === 2 && c === 1
                    ? "#ff5aa0"
                    : r === 2 && c === 2
                      ? "#ffd84d"
                      : r === 1 && c === 2
                        ? "#ff5aa0"
                        : r === 2 && c === 3
                          ? "#ff5aa0"
                          : "rgb(255 255 255 / 0.25)";
                return <circle key={`${r}${c}`} cx={x} cy={y} r="6" fill={fill} />;
              }),
            )}
          </>
        )}
        {game === "trivia" && (
          <>
            <path
              d="M22 10h76a10 10 0 0110 10v24a10 10 0 01-10 10H62l-14 12v-12H22A10 10 0 0112 44V20A10 10 0 0122 10z"
              fill={ink}
              opacity="0.95"
            />
            <text x="60" y="46" textAnchor="middle" fontSize="34" fontWeight="800" fill="#6d28d9">
              ?
            </text>
          </>
        )}
        {game === "ttl" && (
          <>
            {[0, 1, 2].map((i) => (
              <g key={i}>
                <rect
                  x="14"
                  y={8 + i * 20}
                  width="92"
                  height="16"
                  rx="8"
                  fill={ink}
                  opacity={i === 2 ? 0.55 : 0.95}
                />
                <circle cx="26" cy={16 + i * 20} r="5" fill={i === 2 ? "#ff5aa0" : "#6d28d9"} />
              </g>
            ))}
            <path
              d="M23.5 53.5l5 5M28.5 53.5l-5 5"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </span>
  );
}
