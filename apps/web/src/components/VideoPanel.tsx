import { useEffect, useRef, useState } from "react";
import type { DeviceChoice } from "../hooks/useVideoCall.js";

interface Props {
  local: MediaStream | null;
  remote: MediaStream | null;
  /** What to say over the picture ("Looking for someone…"). */
  note: string;
  /** Show the camera and microphone choices. */
  controls: boolean;
  cameras: DeviceChoice[];
  mics: DeviceChoice[];
  cameraId: string;
  micId: string;
  mirror: boolean;
  onPickCamera(id: string): void;
  onPickMic(id: string): void;
  onFlip(): void;
  /** Interests you and the other person share, shown over their picture. */
  common?: string[];
}

/**
 * The other person's video, your own beside it with its controls (flip, which camera, which microphone).
 */
export function VideoPanel({
  local,
  remote,
  note,
  controls,
  cameras,
  mics,
  cameraId,
  micId,
  mirror,
  onPickCamera,
  onPickMic,
  onFlip,
  common = [],
}: Props) {
  // On a phone there is no hover, so the controls open from a small button.
  const [open, setOpen] = useState(false);
  const remoteEl = useRef<HTMLVideoElement>(null);
  const localEl = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteEl.current) remoteEl.current.srcObject = remote;
  }, [remote]);
  useEffect(() => {
    if (localEl.current) localEl.current.srcObject = local;
  }, [local]);

  return (
    <section className="vids" aria-label="Video">
      <div className="vtile">
        <video ref={remoteEl} id="remote" autoPlay playsInline aria-label="The other person" />
        {common.length > 0 && <span className="vcommon">You both like {common.join(", ")}</span>}
        <span className="vmark" aria-hidden="true">
          passerby
        </span>
        <p className="vnote" aria-live="polite">
          {note}
        </p>
      </div>
      <div className="vtile" hidden={!local}>
        <video
          ref={localEl}
          id="local"
          autoPlay
          playsInline
          muted
          hidden={!local}
          data-mirror={mirror}
          aria-label="You (preview)"
        />
        {controls && local && (
          <button
            type="button"
            className="vtoggle"
            aria-label="Camera settings"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 7h4l1.5-2h5L16 7h4v12H4V7zm8 3a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
        {controls && local && (
          <div className="vdev" data-open={open}>
            <button type="button" className="vflip" onClick={onFlip}>
              Flip camera
            </button>
            {cameras.length > 0 && (
              <select
                aria-label="Camera"
                value={cameras.some((c) => c.id === cameraId) ? cameraId : ""}
                onChange={(e) => {
                  onPickCamera(e.target.value);
                  e.target.blur();
                }}
              >
                {!cameras.some((c) => c.id === cameraId) && <option value="">Camera</option>}
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            {mics.length > 0 && (
              <select
                aria-label="Microphone"
                value={mics.some((m) => m.id === micId) ? micId : ""}
                onChange={(e) => {
                  onPickMic(e.target.value);
                  e.target.blur();
                }}
              >
                {!mics.some((m) => m.id === micId) && <option value="">Microphone</option>}
                {mics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
