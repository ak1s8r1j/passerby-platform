import { useCallback, useEffect, useRef, useState } from "react";
import type { IceServer, Signal } from "@passerby/shared";
import { Call } from "../video/call.js";
import { looksVirtual } from "../video/virtual.js";

interface Options {
  iceServers: IceServer[];
  /** Hand a setup message to the connection to the server, which passes it on. */
  sendSignal(signal: Signal): void;
}

export interface DeviceChoice {
  id: string;
  label: string;
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
  const [cameras, setCameras] = useState<DeviceChoice[]>([]);
  const [mics, setMics] = useState<DeviceChoice[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [cameraLabel, setCameraLabel] = useState("");
  /** Whether the visitor's own picture is shown mirrored, like a mirror (the other person is not shown that). */
  const [mirror, setMirror] = useState(true);

  const localRef = useRef<MediaStream | null>(null);
  const callRef = useRef<Call | null>(null);
  const latest = useRef({ iceServers, sendSignal, micOn, camOn });
  useEffect(() => {
    latest.current = { iceServers, sendSignal, micOn, camOn };
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

  /** What is being used now, and what else is plugged in. Names are only available once the camera is allowed. */
  const refreshDevices = useCallback(async () => {
    const stream = localRef.current;
    const video = stream?.getVideoTracks()[0];
    const audio = stream?.getAudioTracks()[0];
    setCameraId(video?.getSettings?.().deviceId ?? "");
    setMicId(audio?.getSettings?.().deviceId ?? "");
    setCameraLabel(video?.label ?? "");
    try {
      const all = (await navigator.mediaDevices.enumerateDevices?.()) ?? [];
      const pick = (kind: MediaDeviceKind) =>
        all
          .filter((d) => d.kind === kind && d.deviceId)
          .map((d, i) => ({
            id: d.deviceId,
            label: d.label || `${kind === "videoinput" ? "Camera" : "Microphone"} ${i + 1}`,
          }));
      setCameras(pick("videoinput"));
      setMics(pick("audioinput"));
    } catch {
      // the list is a convenience; the call works without it
    }
  }, []);

  // Plugging a camera in or out updates the lists.
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const on = () => void refreshDevices();
    md.addEventListener("devicechange", on);
    return () => md.removeEventListener("devicechange", on);
  }, [refreshDevices]);

  /** Turn the camera and microphone on (the browser asks permission). Returns false if refused or missing. */
  const ensureCamera = useCallback(async () => {
    if (localRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localRef.current = stream;
      setLocal(stream);
      setMicOn(true);
      setCamOn(true);
      void refreshDevices();
      return true;
    } catch {
      return false; // blocked, no camera, or the page is not secure (camera needs https or localhost)
    }
  }, [refreshDevices]);

  /** Turn the camera and microphone off, so the browser's "recording" light goes out. */
  const releaseCamera = useCallback(() => {
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocal(null);
    setCameraLabel("");
  }, []);

  /**
   * Use a different camera or microphone, in the middle of a call if need be. The old one is released, the
   * other person's picture or sound switches over without reconnecting, and mute / camera-off are kept.
   */
  const switchDevice = useCallback(
    async (kind: "video" | "audio", deviceId: string) => {
      const stream = localRef.current;
      if (!stream || !deviceId) return false;
      try {
        const fresh = await navigator.mediaDevices.getUserMedia(
          kind === "video"
            ? { video: { deviceId: { exact: deviceId } } }
            : { audio: { deviceId: { exact: deviceId } } },
        );
        const track = fresh.getTracks().find((t) => t.kind === kind);
        if (!track) return false;
        track.enabled = kind === "audio" ? latest.current.micOn : latest.current.camOn;
        const old = kind === "video" ? stream.getVideoTracks() : stream.getAudioTracks();
        old.forEach((t) => {
          stream.removeTrack(t);
          t.stop();
        });
        stream.addTrack(track);
        await callRef.current?.replaceTrack(track);
        await refreshDevices();
        return true;
      } catch {
        return false; // unplugged since the list was made, or in use by another program
      }
    },
    [refreshDevices],
  );

  /** "Flip camera": the next camera if there is more than one (front and back on a phone), otherwise mirror the view. */
  const flip = useCallback(async () => {
    if (cameras.length > 1) {
      const at = cameras.findIndex((c) => c.id === cameraId);
      const next = cameras[(at + 1) % cameras.length]!;
      await switchDevice("video", next.id);
    } else {
      setMirror((m) => !m);
    }
  }, [cameras, cameraId, switchDevice]);

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
    cameras,
    mics,
    cameraId,
    micId,
    mirror,
    /** The camera in use looks like a virtual camera, going by the name it gives itself. */
    virtualCamera: looksVirtual(cameraLabel),
    hasCamera: () => localRef.current !== null,
    ensureCamera,
    releaseCamera,
    begin,
    signal,
    hangUp,
    toggleMic: () => toggle("audio"),
    toggleCam: () => toggle("video"),
    pickCamera: (id: string) => switchDevice("video", id),
    pickMic: (id: string) => switchDevice("audio", id),
    flip,
  };
}
