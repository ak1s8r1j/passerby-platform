import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer, type TestServer } from "./helpers.js";

let s: TestServer;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  s = await startServer();
});
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await s.close();
});

function connect(headers: Record<string, string> = {}) {
  const ws = new WebSocket(s.wsUrl, { headers });
  sockets.push(ws);
  const got: { t: string; [key: string]: unknown }[] = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
  });
  const next = async (t: string, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const i = got.findIndex((m) => m.t === t);
      if (i >= 0) return got.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  return { ws, opened, next, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}

describe("websocket hub", () => {
  it("says ready after hello, and counts the person", async () => {
    const a = connect();
    await a.opened;
    expect(s.hub.online()).toBe(0);
    a.send({ t: "hello", adult: true });
    expect(await a.next("ready")).toEqual({ t: "ready", online: 1 });
    expect(s.hub.online()).toBe(1);
  });

  it("refuses to admit anyone who hasn't confirmed they are 18 or older", async () => {
    const a = connect();
    await a.opened;
    a.send({ t: "hello" });
    const err = await a.next("error");
    expect(err?.code).toBe("invalid_message");
    expect(s.hub.online()).toBe(0);
  });

  it("answers garbage with an error and keeps the connection", async () => {
    const a = connect();
    await a.opened;
    a.ws.send("{{{");
    a.send({ t: "explode" });
    expect(await a.next("error")).not.toBeNull();
    expect(await a.next("error")).not.toBeNull();
    a.send({ t: "hello", adult: true });
    expect(await a.next("ready")).not.toBeNull();
  });

  it("stops counting someone who leaves", async () => {
    const a = connect();
    await a.opened;
    a.send({ t: "hello", adult: true });
    await a.next("ready");
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(s.hub.online()).toBe(0);
  });

  it("tells everyone the new count shortly after someone joins", async () => {
    const a = connect(),
      b = connect();
    await Promise.all([a.opened, b.opened]);
    a.send({ t: "hello", adult: true });
    b.send({ t: "hello", adult: true });
    const c = await a.next("count", 4000);
    expect(c?.online).toBe(2);
  });

  it("refuses connections from other websites", async () => {
    await expect(connect({ origin: "https://evil.example" }).opened).rejects.toThrow("403");
  });

  it("allows the configured site and the server's own address", async () => {
    await connect({ origin: "http://localhost:5173" }).opened;
    await connect({ origin: s.url }).opened;
  });

  it("closes a connection that floods it with messages", async () => {
    const a = connect();
    await a.opened;
    const closed = new Promise<number>((resolve) => a.ws.once("close", (code) => resolve(code)));
    for (let i = 0; i < 120; i++) a.send({ t: "ping" });
    expect(await closed).toBe(4008);
  });

  it("limits how many connections one address can hold", async () => {
    const ok = Array.from({ length: 8 }, () => connect());
    await Promise.all(ok.map((c) => c.opened));
    await expect(connect().opened).rejects.toThrow("429");
  });
});

describe("chatting through real sockets", () => {
  const person = async (address: string) => {
    const c = connect({ "x-forwarded-for": address });
    await c.opened;
    return c;
  };
  const hello = (c: ReturnType<typeof connect>, extra: object = {}) =>
    c.send({ t: "hello", adult: true, ...extra });

  it("pairs two people with a shared interest and carries messages both ways", async () => {
    const a = await person("10.0.0.1"),
      b = await person("10.0.0.2");
    hello(a, { tags: ["chess"] });
    hello(b, { tags: ["Chess!"] });
    await a.next("ready");
    await b.next("ready");
    a.send({ t: "find" });
    b.send({ t: "find" });
    const ma = await a.next("matched"),
      mb = await b.next("matched");
    expect(ma?.common).toEqual(["chess"]);
    expect(mb?.common).toEqual(["chess"]);

    a.send({ t: "msg", text: "  hi there " });
    expect((await b.next("msg"))?.text).toBe("hi there");
    b.send({ t: "typing" });
    expect(await a.next("typing")).not.toBeNull();
    b.send({ t: "msg", text: "hello!" });
    expect((await a.next("msg"))?.text).toBe("hello!");
  });

  it("handles messages sent back-to-back in the order they were sent", async () => {
    const a = await person("10.0.1.1"),
      b = await person("10.0.1.2");
    // No waiting for replies in between: hello, find and the chat all go out at once.
    hello(a);
    a.send({ t: "find" });
    hello(b);
    b.send({ t: "find" });
    expect(await a.next("matched")).not.toBeNull();
    expect(await b.next("matched")).not.toBeNull();
    a.send({ t: "msg", text: "one" });
    a.send({ t: "msg", text: "two" });
    a.send({ t: "msg", text: "three" });
    const got = [
      (await b.next("msg"))?.text,
      (await b.next("msg"))?.text,
      (await b.next("msg"))?.text,
    ];
    expect(got).toEqual(["one", "two", "three"]);
  });

  it("tells the other person when someone presses Next", async () => {
    const a = await person("10.0.2.1"),
      b = await person("10.0.2.2");
    hello(a);
    hello(b);
    a.send({ t: "find" });
    b.send({ t: "find" });
    await a.next("matched");
    await b.next("matched");
    a.send({ t: "stop" });
    expect(await b.next("ended")).not.toBeNull();
    b.send({ t: "msg", text: "are you there?" });
    expect(await a.next("msg", 300)).toBeNull();
  });

  it("tells the other person when someone's tab closes", async () => {
    const c = await person("10.0.2.3"),
      d = await person("10.0.2.4");
    hello(c);
    hello(d);
    c.send({ t: "find" });
    d.send({ t: "find" });
    await c.next("matched");
    await d.next("matched");
    c.ws.close();
    expect(await d.next("ended")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.hub.online()).toBe(1);
  });

  it("removes someone who says they are under 18: not delivered, reported, banned, disconnected", async () => {
    const kid = await person("10.0.3.1"),
      adult = await person("10.0.3.2");
    hello(kid);
    hello(adult);
    kid.send({ t: "find" });
    adult.send({ t: "find" });
    await kid.next("matched");
    await adult.next("matched");

    const closed = new Promise<number>((resolve) => kid.ws.once("close", (code) => resolve(code)));
    kid.send({ t: "msg", text: "hey im 14 f" });
    expect((await kid.next("banned"))?.reason).toBe("age");
    expect(await closed).toBe(4003);
    expect(await adult.next("ended")).not.toBeNull();
    expect(await adult.next("msg", 300)).toBeNull();
    expect(s.reports.filed).toHaveLength(1);
    expect(s.reports.filed[0]).toMatchObject({ reporter: "system", reason: "underage" });
    expect(s.bans.bans.size).toBe(1);

    // Coming back from the same address is refused straight away.
    const again = await person("10.0.3.1");
    hello(again);
    expect((await again.next("banned"))?.reason).toBe("age");
  });
});
