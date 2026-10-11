import { describe, expect, it } from "vitest";
import {
  AdminLoginRequest,
  BanRequest,
  LiftBanRequest,
  MAX_BAN_HOURS,
  RestoreBanRequest,
} from "./admin.js";
import { ClientMessage, parseClientMessage, REPORT_REASONS, ServerMessage } from "./protocol.js";

describe("reporting a chat", () => {
  it("accepts every listed reason", () => {
    for (const reason of REPORT_REASONS) {
      expect(parseClientMessage(JSON.stringify({ t: "report", reason }))).toEqual({
        t: "report",
        reason,
      });
    }
  });

  it("refuses a reason that is not listed, or none at all", () => {
    expect(parseClientMessage(JSON.stringify({ t: "report", reason: "boredom" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "report" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "report", reason: 3 }))).toBeNull();
  });

  it("strips extra fields, so a report cannot smuggle in who to report", () => {
    const parsed = ClientMessage.parse({ t: "report", reason: "spam", visitor: "someone" });
    expect(parsed).toEqual({ t: "report", reason: "spam" });
  });

  it("has a server answer, 'reported'", () => {
    expect(ServerMessage.safeParse({ t: "reported" }).success).toBe(true);
  });
});

describe("AdminLoginRequest", () => {
  it("needs both a name and a key", () => {
    expect(AdminLoginRequest.safeParse({ user: "admin", key: "k" }).success).toBe(true);
    expect(AdminLoginRequest.safeParse({ user: "admin" }).success).toBe(false);
    expect(AdminLoginRequest.safeParse({ user: "", key: "k" }).success).toBe(false);
    expect(AdminLoginRequest.safeParse({ user: "a", key: "x".repeat(201) }).success).toBe(false);
  });
});

describe("BanRequest", () => {
  it("takes whole hours from 1 to a year", () => {
    expect(BanRequest.safeParse({ hours: 1 }).success).toBe(true);
    expect(BanRequest.safeParse({ hours: MAX_BAN_HOURS }).success).toBe(true);
    expect(BanRequest.safeParse({ hours: 0 }).success).toBe(false);
    expect(BanRequest.safeParse({ hours: MAX_BAN_HOURS + 1 }).success).toBe(false);
    expect(BanRequest.safeParse({ hours: 1.5 }).success).toBe(false);
    expect(BanRequest.safeParse({ hours: "24" }).success).toBe(false);
    expect(BanRequest.safeParse({}).success).toBe(false);
  });
});

describe("lifting and restoring a ban", () => {
  it("needs a visitor to lift", () => {
    expect(LiftBanRequest.safeParse({ visitor: "abc" }).success).toBe(true);
    expect(LiftBanRequest.safeParse({ visitor: "" }).success).toBe(false);
  });

  it("restores only a known reason and a real time", () => {
    const ok = { visitor: "abc", until: Date.now() + 1000, reason: "rules" };
    expect(RestoreBanRequest.safeParse(ok).success).toBe(true);
    expect(RestoreBanRequest.safeParse({ ...ok, reason: "fun" }).success).toBe(false);
    expect(RestoreBanRequest.safeParse({ ...ok, until: -5 }).success).toBe(false);
    expect(RestoreBanRequest.safeParse({ ...ok, until: "soon" }).success).toBe(false);
  });
});
