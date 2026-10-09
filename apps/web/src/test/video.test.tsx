import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { CAMERA_BLOCKED } from "../pages/Chat.js";
import { FakePeer, FakeStream, flush, installFakeMedia, type FakeMedia } from "./fake-media.js";
import { FakeSocket, installFakeSocket } from "./fake-socket.js";
import { STUN, TURN, stubApi } from "./fetch.js";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

let media: FakeMedia;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("pb_adult", "true");
  stubApi();
  installFakeSocket();
  media = installFakeMedia();
});
afterEach(() => vi.unstubAllGlobals());

const button = (name: RegExp) => screen.getByRole("button", { name });
const status = () => screen.getByRole("status");
const OFFER = { s: { type: "offer", sdp: "their-offer" } };
const CANDIDATE = {
  c: { candidate: "candidate:1 1 udp 1 1.2.3.4 5 typ host", sdpMid: "0", sdpMLineIndex: 0 },
};

/** Open the video page and let the server say ready. */
async function openVideo() {
  renderAt("/video");
  await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
  await waitFor(() => expect(FakeSocket.last.of("hello")).toHaveLength(1));
  FakeSocket.last.receive({ t: "ready", online: 2 });
  await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
  return FakeSocket.last;
}

/** Press Start, grant the camera, and get matched. */
async function startAndMatch(init: boolean) {
  const server = await openVideo();
  await userEvent.click(button(/^start$/i));
  await waitFor(() => expect(server.of("find")).toHaveLength(1));
  server.receive({ t: "waiting" });
  server.receive({ t: "matched", common: [], init });
  await waitFor(() => expect(FakePeer.instances).toHaveLength(1));
  return server;
}

const remoteVideo = () =>
  document.getElementById("remote") as HTMLVideoElement & { srcObject: unknown };
const localVideo = () =>
  document.getElementById("local") as HTMLVideoElement & { srcObject: unknown };

describe("before video starts", () => {
  it("waits for the server to say whether video is on, then shows the screen", async () => {
    await openVideo();
    expect(
      screen.getByRole("heading", { name: /video chat with a stranger/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Video")).toBeInTheDocument();
  });

  it("explains that video is off, and offers text chat, when the server has switched it off", async () => {
    stubApi({ config: { video: false, iceServers: [] } });
    renderAt("/video");
    expect(await screen.findByText(/switched off/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /text chat/i })).toHaveAttribute("href", "/text");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("still works if the server can't be asked, using the free STUN server", async () => {
    stubApi({ config: "down" });
    await openVideo();
    await userEvent.click(button(/^start$/i));
    FakeSocket.last.receive({ t: "matched", common: [], init: true });
    await waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    expect(FakePeer.last.config).toEqual({ iceServers: [STUN] });
  });

  it("does not touch the camera until Start is pressed", async () => {
    await openVideo();
    expect(media.asked).toHaveLength(0);
    expect(screen.getByText("Your camera turns on when you press Start.")).toBeInTheDocument();
  });

  it("warns that video can reveal the visitor's IP address to the other person", async () => {
    await openVideo();
    expect(screen.getByText(/can reveal your IP address/i)).toBeInTheDocument();
  });

  it("says hello as a video chatter", async () => {
    const server = await openVideo();
    expect(server.of("hello")[0]).toMatchObject({ t: "hello", adult: true, mode: "video" });
  });
});

describe("the camera", () => {
  it("asks for camera and microphone on Start, says so while waiting, then searches", async () => {
    const server = await openVideo();
    let allow!: (s: FakeStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(
      () => new Promise((resolve) => (allow = resolve as unknown as (s: FakeStream) => void)),
    );
    await userEvent.click(button(/^start$/i));
    expect(
      await screen.findByText("Waiting for your camera…", { selector: "span" }),
    ).toBeInTheDocument();
    expect(button(/^start$/i)).toBeDisabled();
    expect(server.of("find")).toHaveLength(0);

    allow(new FakeStream());
    await waitFor(() => expect(server.of("find")).toHaveLength(1));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(status()).toHaveTextContent("Looking for someone…");
  });

  it("shows the visitor their own preview, muted", async () => {
    await startAndMatch(true);
    expect(localVideo().srcObject).toBe(media.streams[0]);
    expect(localVideo()).toHaveProperty("muted", true);
    expect(localVideo()).toBeVisible();
  });

  it("explains what to do when the camera is blocked, and doesn't search", async () => {
    media = installFakeMedia({ deny: true });
    const server = await openVideo();
    await userEvent.click(button(/^start$/i));
    expect(await screen.findByText(CAMERA_BLOCKED)).toBeInTheDocument();
    expect(server.of("find")).toHaveLength(0);
    expect(button(/^start$/i)).toBeEnabled(); // they can fix it and try again
    expect(FakePeer.instances).toHaveLength(0);
  });

  it("explains it too when the browser has no camera support at all (an insecure page)", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const server = await openVideo();
    await userEvent.click(button(/^start$/i));
    expect(await screen.findByText(CAMERA_BLOCKED)).toBeInTheDocument();
    expect(server.of("find")).toHaveLength(0);
  });

  it("lets them try again after allowing the camera", async () => {
    media = installFakeMedia({ deny: true });
    const server = await openVideo();
    await userEvent.click(button(/^start$/i));
    await screen.findByText(CAMERA_BLOCKED);
    media = installFakeMedia(); // they allowed it in the browser
    await userEvent.click(button(/^start$/i));
    await waitFor(() => expect(server.of("find")).toHaveLength(1));
  });

  it("keeps the camera on between chats", async () => {
    const server = await startAndMatch(true);
    await userEvent.click(button(/^next$/i));
    await waitFor(() => expect(server.of("find")).toHaveLength(2));
    expect(media.asked).toHaveLength(1);
    expect(media.streams[0]!.tracks.every((t) => !t.stopped)).toBe(true);
  });
});

describe("the call", () => {
  it("the first person makes an offer, using the servers the site gave", async () => {
    const server = await startAndMatch(true);
    await flush();
    expect(FakePeer.last.config).toEqual({ iceServers: [STUN, TURN] });
    expect(FakePeer.last.tracks.map(([t]) => t.kind)).toEqual(["video", "audio"]);
    expect(server.of("sig")).toEqual([{ t: "sig", d: { s: { type: "offer", sdp: "offer-sdp" } } }]);
  });

  it("the second person waits for the offer, then answers it", async () => {
    const server = await startAndMatch(false);
    await flush();
    expect(server.of("sig")).toEqual([]);
    server.receive({ t: "sig", d: OFFER });
    await waitFor(() =>
      expect(server.of("sig")).toEqual([
        { t: "sig", d: { s: { type: "answer", sdp: "answer-sdp" } } },
      ]),
    );
  });

  it("passes on the other person's candidates, and sends ours", async () => {
    const server = await startAndMatch(false);
    server.receive({ t: "sig", d: OFFER });
    await flush();
    server.receive({ t: "sig", d: CANDIDATE });
    await flush();
    expect(FakePeer.last.addedCandidates).toEqual([CANDIDATE.c]);
    FakePeer.last.emitCandidate(CANDIDATE.c);
    expect(server.of("sig").at(-1)).toEqual({ t: "sig", d: CANDIDATE });
  });

  it("shows the other person's video when it arrives, and clears the note", async () => {
    await startAndMatch(true);
    const theirs = new FakeStream();
    FakePeer.last.emitTrack(theirs);
    await waitFor(() => expect(remoteVideo().srcObject).toBe(theirs));
    FakePeer.last.setState("connected");
    await waitFor(() => expect(screen.queryByText("Connecting video…")).not.toBeInTheDocument());
  });

  it("says when the video could not connect, and Next tries someone else", async () => {
    const server = await startAndMatch(true);
    FakePeer.last.setState("failed");
    expect(await screen.findByText(/Video couldn't connect with this person/)).toBeInTheDocument();
    await userEvent.click(button(/^next$/i));
    await waitFor(() => expect(server.of("find")).toHaveLength(2));
    expect(FakePeer.instances[0]!.closed).toBe(true);
  });

  it("keeps text chat working alongside the video", async () => {
    const server = await startAndMatch(true);
    await userEvent.type(
      screen.getByRole("textbox", { name: /message/i }),
      "can you see me?{Enter}",
    );
    expect(server.of("msg")).toEqual([{ t: "msg", text: "can you see me?" }]);
    server.receive({ t: "msg", text: "yes!" });
    expect(await within(screen.getByRole("log")).findByText("yes!")).toBeInTheDocument();
  });

  it("gives the next person a fresh connection, closing the old one", async () => {
    const server = await startAndMatch(true);
    await userEvent.click(button(/^next$/i));
    expect(FakePeer.instances[0]!.closed).toBe(true);
    expect(remoteVideo().srcObject).toBeNull();
    server.receive({ t: "wait", ms: 1 });
    server.receive({ t: "matched", common: [], init: true });
    await waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    expect(FakePeer.last.closed).toBe(false);
  });
});

describe("the microphone and camera buttons", () => {
  it("only appear once a chat has been started", async () => {
    await openVideo();
    expect(screen.queryByRole("button", { name: /mute mic/i })).not.toBeInTheDocument();
    await userEvent.click(button(/^start$/i));
    expect(await screen.findByRole("button", { name: /mute mic/i })).toBeInTheDocument();
  });

  it("mute the microphone and switch the camera off, and back on", async () => {
    await startAndMatch(true);
    const [video, audio] = [
      media.streams[0]!.getVideoTracks()[0]!,
      media.streams[0]!.getAudioTracks()[0]!,
    ];
    await userEvent.click(button(/mute mic/i));
    expect(audio.enabled).toBe(false);
    expect(video.enabled).toBe(true);
    expect(button(/unmute mic/i)).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button(/camera off/i));
    expect(video.enabled).toBe(false);
    await userEvent.click(button(/unmute mic/i));
    await userEvent.click(button(/camera on/i));
    expect(audio.enabled).toBe(true);
    expect(video.enabled).toBe(true);
  });
});

describe("ending a video chat", () => {
  it("when the other person leaves: the call closes, their picture goes, the camera stays on", async () => {
    const server = await startAndMatch(true);
    FakePeer.last.emitTrack(new FakeStream());
    server.receive({ t: "ended" });
    await waitFor(() => expect(FakePeer.last.closed).toBe(true));
    expect(remoteVideo().srcObject).toBeNull();
    expect(media.streams[0]!.tracks.every((t) => !t.stopped)).toBe(true);
  });

  it("Stop closes the call and turns the camera off", async () => {
    const server = await startAndMatch(true);
    await userEvent.click(button(/^stop$/i));
    expect(server.messages.at(-1)).toEqual({ t: "stop" });
    expect(FakePeer.last.closed).toBe(true);
    expect(media.streams[0]!.tracks.every((t) => t.stopped)).toBe(true);
    expect(localVideo().srcObject).toBeNull();
    expect(screen.getByText("Your camera turns on when you press Start.")).toBeInTheDocument();
  });

  it("being removed turns the camera off too", async () => {
    const server = await startAndMatch(true);
    server.receive({ t: "banned", until: Date.now() + 3600e3, reason: "rules" });
    await waitFor(() => expect(media.streams[0]!.tracks.every((t) => t.stopped)).toBe(true));
    expect(FakePeer.last.closed).toBe(true);
  });

  it("losing the connection turns the camera off, and the visitor can start again after it returns", async () => {
    const first = await startAndMatch(true);
    first.close();
    await waitFor(() => expect(media.streams[0]!.tracks.every((t) => t.stopped)).toBe(true));
    expect(FakePeer.last.closed).toBe(true);
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2), { timeout: 3000 });
    await waitFor(() => expect(FakeSocket.last.of("hello")[0]).toMatchObject({ mode: "video" }));
    FakeSocket.last.receive({ t: "ready", online: 1 });
    await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
    await userEvent.click(button(/^start$/i));
    await waitFor(() => expect(media.asked).toHaveLength(2)); // asks for the camera again
  });

  it("leaving the page ends the call and turns the camera off", async () => {
    renderAt("/video");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.last.receive({ t: "ready", online: 1 });
    await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
    await userEvent.click(button(/^start$/i));
    await waitFor(() => expect(media.streams).toHaveLength(1));
    FakeSocket.last.receive({ t: "matched", common: [], init: true });
    await waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    // go to another page
    await userEvent.click(screen.getByRole("link", { name: /passerby/i }));
    await waitFor(() => expect(media.streams[0]!.tracks.every((t) => t.stopped)).toBe(true));
    expect(FakePeer.last.closed).toBe(true);
  });
});

describe("the notes over the picture", () => {
  it("say what is happening: waiting, searching, connecting", async () => {
    const server = await openVideo();
    expect(screen.getByText("Your camera turns on when you press Start.")).toBeInTheDocument();
    await userEvent.click(button(/^start$/i));
    await waitFor(() => expect(server.of("find")).toHaveLength(1));
    expect(
      await screen.findByText("Looking for someone…", { selector: ".vnote" }),
    ).toBeInTheDocument();
    server.receive({ t: "matched", common: [], init: true });
    expect(await screen.findByText("Connecting video…")).toBeInTheDocument();
  });
});

describe("text chat", () => {
  it("never asks for the camera and has no video panel", async () => {
    renderAt("/text");
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.last.receive({ t: "ready", online: 1 });
    await waitFor(() => expect(button(/^start$/i)).toBeEnabled());
    await userEvent.click(button(/^start$/i));
    await waitFor(() => expect(FakeSocket.last.of("find")).toHaveLength(1));
    expect(media.asked).toHaveLength(0);
    expect(screen.queryByLabelText("Video")).not.toBeInTheDocument();
    expect(FakeSocket.last.of("hello")[0]).toMatchObject({ mode: "text" });
  });
});
