import { useCallback, useEffect, useRef, useState } from "react";
import type { IceServer, Signal } from "@passerby/shared";
import { Call } from "../video/call.js";

interface Options {
  iceServers: IceServer[];
  /** Hand a setup message to the connection to the server, which passes it on. */
  sendSignal(signal: Signal): void;
}

/**
 * The visitor's camera and microphone, and the video connection to the person they are matched with.
 * The chat screen decides when things happen (start, matched, ended); this hook does them.
 */
export function useVideoCall({ iceServers, sendSignal }: Options) {
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [note, setNote] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const localRef = useRef<MediaStream | null>(null);
  const callRef = useRef<Call | null>(null);
  const latest = useRef({ iceServers, sendSignal });
  useEffect(() => {
    latest.current = { iceServers, sendSignal };
  });

  const call = useCallback(() => {
    callRef.current ??= new Call({
      iceServers: latest.current.iceServers,
      send: (s) => latest.current.sendSignal(s),
      onRemote: setRemote,
      onNote: setNote,
    });
    return callRef.current;
  }, []);

  /** Turn the camera and microphone on (the browser asks permission). Returns false if refused or missing. */
  const ensureCamera = useCallback(async () => {
    if (localRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localRef.current = stream;
      setLocal(stream);
      setMicOn(true);
      setCamOn(true);
      return true;
    } catch {
      return false; // blocked, no camera, or the page is not secure (camera needs https or localhost)
    }
  }, []);

  /** Turn the camera and microphone off, so the browser's "recording" light goes out. */
  const releaseCamera = useCallback(() => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
  }, []);

  const begin = useCallback(
    (initiator: boolean) => {
      const stream = localRef.current;
      if (stream) call().start(stream, initiator);
    },
    [call],
  );
  const signal = useCallback((s: Signal) => callRef.current?.signal(s), []);
  const hangUp = useCallback(() => callRef.current?.stop(), []);

  const toggle = (kind: "audio" | "video") => {
    const stream = localRef.current;
    if (!stream) return;
    const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
    const on = !(kind === "audio" ? micOn : camOn);
    tracks.forEach((t) => (t.enabled = on));
    (kind === "audio" ? setMicOn : setCamOn)(on);
  };

  // Leaving the page ends the call and turns the camera off.
  useEffect(
    () => () => {
      callRef.current?.stop();
      localRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return {
    local,
    remote,
    note,
    micOn,
    camOn,
    hasCamera: () => localRef.current !== null,
    ensureCamera,
    releaseCamera,
    begin,
    signal,
    hangUp,
    toggleMic: () => toggle("audio"),
    toggleCam: () => toggle("video"),
  };
}
