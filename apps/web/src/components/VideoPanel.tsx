import { useEffect, useRef } from "react";

interface Props {
  local: MediaStream | null;
  remote: MediaStream | null;
  /** What to say over the picture ("Looking for someone…"). */
  note: string;
  /** Show the microphone and camera buttons. */
  controls: boolean;
  micOn: boolean;
  camOn: boolean;
  onMic(): void;
  onCam(): void;
}

/** The other person's video, a small mirrored preview of yourself, and mute / camera-off buttons. */
export function VideoPanel({ local, remote, note, controls, micOn, camOn, onMic, onCam }: Props) {
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
      <video ref={remoteEl} id="remote" autoPlay playsInline aria-label="The other person" />
      <video
        ref={localEl}
        id="local"
        autoPlay
        playsInline
        muted
        hidden={!local}
        aria-label="You (preview)"
      />
      <p className="vnote" aria-live="polite">
        {note}
      </p>
      {controls && local && (
        <div className="vctl">
          <button type="button" className="vbtn" aria-pressed={!micOn} onClick={onMic}>
            {micOn ? "Mute mic" : "Unmute mic"}
          </button>
          <button type="button" className="vbtn" aria-pressed={!camOn} onClick={onCam}>
            {camOn ? "Camera off" : "Camera on"}
          </button>
        </div>
      )}
    </section>
  );
}
