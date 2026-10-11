import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { ban, event, FakeAdmin, reduceMotion, report, stubAdmin, user } from "./fake-admin.js";

let admin: FakeAdmin;
let ui: ReturnType<typeof userEvent.setup>;

function open(path = "/admin", a: FakeAdmin = FakeAdmin.signedIn()) {
  admin = a;
  stubAdmin(admin);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

// The admin area is loaded on demand, and the very first load is slow. Pay for it once, up front.
beforeAll(async () => {
  await import("../admin/AdminApp.js");
}, 30_000);

beforeEach(() => {
  reduceMotion();
  ui = userEvent.setup();
});
afterEach(() => vi.unstubAllGlobals());

const tile = (label: string) => screen.getByText(label).closest(".adm-tile") as HTMLElement;
const nav = () => within(screen.getAllByRole("navigation", { name: "Sections" })[0]!);
/** The overview page, with its numbers loaded (the title shows while they are still on the way). */
const overviewReady = async () => {
  await screen.findByText("Online now");
};
const heading = (name: string) => screen.findByRole("heading", { level: 1, name });
const posts = () => admin.calls.filter((c) => c.method === "POST");
const lastPost = () => posts().at(-1)!;

describe("the gate", () => {
  it("says how to switch the admin area on when the server has no key", async () => {
    open("/admin", Object.assign(new FakeAdmin(), { enabled: false }));
    expect(await screen.findByRole("heading", { name: /isn.t set up/i })).toBeInTheDocument();
    expect(screen.getByText("ADMIN_KEY")).toBeInTheDocument();
    expect(screen.queryByLabelText("Key")).not.toBeInTheDocument();
  });

  it("asks for the name and key when nobody is signed in, and keeps search engines out", async () => {
    open("/admin", new FakeAdmin());
    expect(await screen.findByRole("form", { name: /admin sign in/i })).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    expect(screen.getByLabelText("Key")).toHaveAttribute("type", "password");
  });

  it("asks for both fields before contacting the server", async () => {
    open("/admin", new FakeAdmin());
    await ui.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the admin name and key.");
    expect(posts()).toHaveLength(0);
  });

  it("shows the server's message for a wrong key, empties the key box and keeps the name", async () => {
    open("/admin", new FakeAdmin());
    await ui.type(await screen.findByLabelText("Name"), "owner");
    await ui.type(screen.getByLabelText("Key"), "wrong-key-99999");
    await ui.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong name or key.");
    expect(screen.getByLabelText("Key")).toHaveValue("");
    expect(screen.getByLabelText("Name")).toHaveValue("owner");
  });

  it("signs in with the right key and shows the overview", async () => {
    open("/admin", new FakeAdmin());
    await ui.type(await screen.findByLabelText("Name"), "owner");
    await ui.type(screen.getByLabelText("Key"), "right-key-12345");
    await ui.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await heading("Overview")).toBeInTheDocument();
    expect(lastPost()).toMatchObject({
      path: "/login",
      body: { user: "owner", key: "right-key-12345" },
    });
    expect(screen.queryByLabelText("Key")).not.toBeInTheDocument();
  });

  it("goes straight to the pages for someone who is already signed in", async () => {
    open();
    expect(await heading("Overview")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("shows the sign-in form again when a request finds the sign-in has ended", async () => {
    open();
    await heading("Overview");
    admin.expireNext = true;
    await ui.click(nav().getByRole("link", { name: /reports/i }));
    expect(await screen.findByRole("form", { name: /admin sign in/i })).toBeInTheDocument();
  });

  it("signs out, and shows the form", async () => {
    open();
    await heading("Overview");
    await ui.click(screen.getByRole("button", { name: /sign out/i }));
    expect(await screen.findByRole("form", { name: /admin sign in/i })).toBeInTheDocument();
    expect(lastPost().path).toBe("/logout");
    expect(admin.signedIn).toBe(false);
  });

  it("explains when the server can't be reached", async () => {
    open("/admin", new FakeAdmin());
    await screen.findByRole("form", { name: /admin sign in/i });
    admin.down = true;
    await ui.type(screen.getByLabelText("Name"), "owner");
    await ui.type(screen.getByLabelText("Key"), "right-key-12345");
    await ui.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/can.t reach the server/i);
  });
});

describe("the frame", () => {
  it("has a link to every section, with the current one marked", async () => {
    open("/admin/bans");
    await heading("Bans");
    for (const name of ["Overview", "Reports", "Bans", "Users", "Activity", "System"]) {
      expect(nav().getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(nav().getByRole("link", { name: /bans/i })).toHaveAttribute("aria-current", "page");
    expect(nav().getByRole("link", { name: /overview/i })).not.toHaveAttribute("aria-current");
  });

  it("badges Reports with how many are open, and hides the badge when there are none", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [report(1), report(2), report(3, { status: "dismissed" })];
    open("/admin", a);
    await screen.findAllByRole("navigation", { name: "Sections" });
    expect(
      await within(nav().getByRole("link", { name: /reports/i })).findByLabelText("2 open"),
    ).toBeInTheDocument();
  });

  it("shows no badge with nothing open", async () => {
    open();
    await heading("Overview");
    expect(screen.queryByLabelText(/open$/)).not.toBeInTheDocument();
  });

  it("sends an unknown admin address to the overview", async () => {
    open("/admin/nonsense");
    expect(await heading("Overview")).toBeInTheDocument();
  });

  it("moves between sections without a reload", async () => {
    open();
    await heading("Overview");
    await ui.click(nav().getByRole("link", { name: /users/i }));
    expect(await heading("Users")).toBeInTheDocument();
    await ui.click(nav().getByRole("link", { name: /system/i }));
    expect(await heading("System")).toBeInTheDocument();
  });
});

describe("the overview", () => {
  it("shows who is here right now", async () => {
    open();
    await overviewReady();
    expect(tile("Online now")).toHaveTextContent("12");
    expect(tile("Online now")).toHaveTextContent("8 text · 4 video");
    expect(tile("In conversation")).toHaveTextContent("3"); // 6 people = 3 chats
    expect(tile("Searching")).toHaveTextContent("2");
  });

  it("shows the last 24 hours", async () => {
    open();
    await overviewReady();
    const day = screen.getByLabelText("Last 24 hours");
    expect(within(day).getByText("Visitors").closest(".adm-tile")).toHaveTextContent("120");
    expect(within(day).getByText("Chats").closest(".adm-tile")).toHaveTextContent("45");
    expect(within(day).getByText("Messages").closest(".adm-tile")).toHaveTextContent("900");
    expect(within(day).getByText("New accounts").closest(".adm-tile")).toHaveTextContent("3");
  });

  it("charts the hours, with the same numbers as a table, and switches what it charts", async () => {
    open();
    await overviewReady();
    const table = screen.getByRole("table", { name: /chats per hour/i });
    expect(within(table).getAllByRole("row")).toHaveLength(24);
    await ui.click(screen.getByRole("button", { name: "Visitors" }));
    expect(screen.getByRole("table", { name: /visitors per hour/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visitors" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-pressed", "false");
  });

  it("says all clear with no open reports", async () => {
    open();
    await heading("Overview");
    expect(await screen.findByText("All clear", { selector: "h3" })).toBeInTheDocument();
    expect(tile("Open reports")).toHaveTextContent("all clear");
  });

  it("lists the newest open reports and links to the queue", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [report(1, { reason: "nudity" }), report(2, { reason: "spam" })];
    open("/admin", a);
    await heading("Overview");
    const list = await screen.findByRole("list", { name: "Newest open reports" });
    expect(within(list).getByText("Nudity or sexual content")).toBeInTheDocument();
    expect(within(list).getByText("Spam or advertising")).toBeInTheDocument();
    expect(tile("Open reports")).toHaveTextContent("2");
    expect(tile("Open reports")).toHaveAttribute("href", "/admin/reports");
  });

  it("shows an error with a way to retry when the numbers can't be loaded", async () => {
    const a = FakeAdmin.signedIn();
    a.failOn = "/overview";
    a.failNext = { status: 500, code: "internal", message: "Something went wrong." };
    open("/admin", a);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    await ui.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("Online now")).toBeInTheDocument();
  });
});

describe("reports", () => {
  const withReports = (n = 3) => {
    const a = FakeAdmin.signedIn();
    const reasons = ["nudity", "harassment", "spam", "underage", "other"];
    a.reports = Array.from({ length: n }, (_v, i) => report(i + 1, { reason: reasons[i % 5]! }));
    return a;
  };
  const row = (name: RegExp) => screen.getByRole("button", { name });

  it("lists the open ones by default, with who reported whom", async () => {
    const a = withReports(2);
    a.reports.push(report(3, { status: "dismissed", reason: "spam" }));
    open("/admin/reports", a);
    await heading("Reports");
    const list = await screen.findByRole("list", { name: "Reports" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(row(/Nudity or sexual content/)).toHaveTextContent("rep10000 reported bad10000");
    expect(row(/Nudity or sexual content/)).toHaveTextContent("Open");
    expect(row(/Nudity or sexual content/)).toHaveTextContent("Text · 2 messages");
  });

  it("calls an automatic report 'the system'", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [report(1, { reporter: "system", reason: "underage" })];
    open("/admin/reports", a);
    expect(await screen.findByText(/the system reported/)).toBeInTheDocument();
  });

  it("filters by status, and says when a status is empty", async () => {
    const a = withReports(2);
    a.reports[1]!.status = "banned";
    open("/admin/reports", a);
    await screen.findByRole("list", { name: "Reports" });
    await ui.click(screen.getByRole("button", { name: "Banned" }));
    expect(await screen.findByText("Harassment or hate")).toBeInTheDocument();
    expect(screen.getByText("Banned", { selector: ".adm-pill" })).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "Dismissed" }));
    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "All" }));
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
  });

  it("says all clear when the queue is empty", async () => {
    open("/admin/reports");
    expect(await screen.findByText("All clear", { selector: "h3" })).toBeInTheDocument();
  });

  it("loads more on request", async () => {
    const a = withReports(5);
    a.pageSize = 2;
    open("/admin/reports", a);
    await screen.findByRole("list", { name: "Reports" });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await ui.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
    await ui.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("opens one in a sheet with the conversation in order, labelled, and who is on which side", async () => {
    open("/admin/reports", withReports(1));
    await ui.click(await screen.findByRole("button", { name: /Nudity/ }));
    const sheet = await screen.findByRole("dialog", { name: "Nudity or sexual content" });
    const lines = within(
      within(sheet).getByRole("list", { name: "Saved conversation" }),
    ).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveClass("reporter");
    expect(lines[0]).toHaveTextContent("Reporter");
    expect(lines[0]).toHaveTextContent("hello");
    expect(lines[1]).toHaveClass("reported");
    expect(lines[1]).toHaveTextContent("something rude");
    expect(within(sheet).getByText("bad10000")).toBeInTheDocument();
  });

  it("shows what people wrote as plain text, never as markup", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [
      report(1, {
        transcript: [{ who: "reported", x: '<img src=x onerror="alert(1)"><b>bold</b>' }],
      }),
    ];
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: /Harassment/ }));
    const sheet = await screen.findByRole("dialog");
    expect(
      within(sheet).getByText('<img src=x onerror="alert(1)"><b>bold</b>'),
    ).toBeInTheDocument();
    expect(sheet.querySelector("img")).toBeNull();
    expect(sheet.querySelector("b")).toBeNull();
  });

  it("says so when no messages were saved", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [report(1, { transcript: [] })];
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: /Harassment/ }));
    expect(await screen.findByText(/chat ended before anyone spoke/i)).toBeInTheDocument();
  });

  it("warns when several different people have reported the same person", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [report(1, { reportersToday: 3, reportsTotal: 5 })];
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: /Harassment/ }));
    expect(
      await screen.findByText("3 different people have reported them today."),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 reports about them in total/)).toBeInTheDocument();
  });

  it("bans for the length chosen, closes the sheet, drops it from the queue, and offers Undo", async () => {
    const a = withReports(2);
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: /Nudity/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Ban for 24 hours" })).toBeInTheDocument();
    await ui.click(within(sheet).getByRole("button", { name: "7 days" }));
    await ui.click(within(sheet).getByRole("button", { name: "Ban for 7 days" }));

    expect(await screen.findByText("Banned for 7 days.")).toBeInTheDocument();
    expect(posts().find((c) => c.path === "/reports/r1/ban")?.body).toEqual({ hours: 168 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(admin.reports[0]!.status).toBe("banned");
    expect(admin.bans).toHaveLength(1);
  });

  it("undoes a ban: lifts it and puts the report back in the queue", async () => {
    open("/admin/reports", withReports(2));
    await ui.click(await screen.findByRole("button", { name: /Nudity/ }));
    await ui.click(await screen.findByRole("button", { name: "Ban for 24 hours" }));
    await ui.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(admin.bans).toHaveLength(0));
    expect(admin.reports[0]!.status).toBe("open");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
  });

  it("undoing a ban that replaced an earlier one brings the earlier one back, not nothing", async () => {
    const a = FakeAdmin.signedIn();
    const r = report(1, { reportersToday: 3 });
    a.reports = [r];
    const earlier = ban(1, { id: r.full, tag: r.reported, until: Date.now() + 3 * 3_600_000 });
    a.bans = [earlier]; // the automatic 24-hour pause is in force
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: /Harassment/ }));
    await screen.findByText(/Banned until/);
    await ui.click(screen.getByRole("button", { name: "30 days" }));
    await ui.click(screen.getByRole("button", { name: "Ban for 30 days" }));
    await ui.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(posts().some((c) => c.path === "/bans/restore")).toBe(true));
    expect(posts().some((c) => c.path === "/bans/lift")).toBe(false); // it restored, it did not just remove
    const restored = posts().find((c) => c.path === "/bans/restore")!;
    expect(restored.body).toMatchObject({ visitor: r.full, until: earlier.until, reason: "rules" });
    expect(admin.bans).toHaveLength(1);
    expect(admin.reports[0]!.status).toBe("open");
  });

  it("undoing a ban brings back every report the ban closed, not just the one you were looking at", async () => {
    const a = FakeAdmin.signedIn();
    const same = "same-person-visitor-id-xx";
    a.reports = [
      report(1, { reason: "nudity", full: same }),
      report(2, { reason: "spam", full: same }),
      report(3, { reason: "harassment" }), // someone else: untouched
    ];
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: /Nudity/ }));
    await ui.click(await screen.findByRole("button", { name: "Ban for 24 hours" }));
    await screen.findByText("Banned for 24 hours.");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1)); // only the other person's is left
    expect(admin.reports.map((r) => r.status)).toEqual(["banned", "banned", "open"]);
    await ui.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(admin.reports.map((r) => r.status)).toEqual(["open", "open", "open"]),
    );
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(admin.bans).toHaveLength(0);
  });

  it("dismisses with an Undo, which reopens it", async () => {
    open("/admin/reports", withReports(2));
    await ui.click(await screen.findByRole("button", { name: /Nudity/ }));
    await ui.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Report dismissed.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(admin.reports[0]!.status).toBe("dismissed");
    await ui.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(admin.reports[0]!.status).toBe("open"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
  });

  it("shows a ban already in force, and lifts it with an Undo that puts it back", async () => {
    const a = FakeAdmin.signedIn();
    const r = report(1, { status: "banned" });
    a.reports = [r];
    a.bans = [ban(1, { id: r.full, tag: r.reported })];
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: "Banned" }));
    await ui.click(await screen.findByRole("button", { name: /Harassment/ }));
    expect(await screen.findByText(/Banned until/)).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "Lift ban" }));
    expect(await screen.findByText("Ban lifted.")).toBeInTheDocument();
    expect(admin.bans).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(/Banned until/)).not.toBeInTheDocument());
    await ui.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(admin.bans).toHaveLength(1));
    expect(await screen.findByText(/Banned until/)).toBeInTheDocument();
  });

  it("reopens a dismissed report from its sheet", async () => {
    const a = FakeAdmin.signedIn();
    a.reports = [report(1, { status: "dismissed" })];
    open("/admin/reports", a);
    await ui.click(await screen.findByRole("button", { name: "Dismissed" }));
    await ui.click(await screen.findByRole("button", { name: /Harassment/ }));
    await ui.click(await screen.findByRole("button", { name: "Reopen report" }));
    await waitFor(() => expect(admin.reports[0]!.status).toBe("open"));
    expect(await screen.findByText("Open", { selector: ".adm-pill" })).toBeInTheDocument();
  });

  it("keeps the sheet open and says why when the server refuses", async () => {
    open("/admin/reports", withReports(1));
    await ui.click(await screen.findByRole("button", { name: /Nudity/ }));
    const sheet = await screen.findByRole("dialog");
    admin.failNext = { status: 404, code: "not_found", message: "That report no longer exists." };
    await ui.click(within(sheet).getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("That report no longer exists.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes with the Close button and Escape, and returns to the list", async () => {
    open("/admin/reports", withReports(1));
    const opener = await screen.findByRole("button", { name: /Nudity/ });
    await ui.click(opener);
    await screen.findByRole("dialog");
    await ui.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    await ui.click(opener);
    await screen.findByRole("dialog");
    await ui.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("bans", () => {
  const withBans = () => {
    const a = FakeAdmin.signedIn();
    a.bans = [
      ban(1, { reason: "age" }),
      ban(2, { reason: "reports", until: Date.now() + 3 * 86_400_000 }),
      ban(3, { until: Date.now() - 1000 }), // over: not shown
    ];
    return a;
  };

  it("lists bans in force with the reason and how long is left", async () => {
    open("/admin/bans", withBans());
    const list = await screen.findByRole("list", { name: "Bans in force" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("ban10000")).toBeInTheDocument();
    expect(within(list).getByText("Under 18")).toBeInTheDocument();
    expect(within(list).getByText("Reported by several people")).toBeInTheDocument();
    expect(list).toHaveTextContent(/in 3 days/);
    expect(list).toHaveTextContent(/in 4 h|in 5 h/);
  });

  it("says no one is banned", async () => {
    open("/admin/bans");
    expect(await screen.findByText("No one is banned")).toBeInTheDocument();
  });

  it("lifts a ban at once and offers Undo, which puts it back", async () => {
    open("/admin/bans", withBans());
    await ui.click(await screen.findByRole("button", { name: "Lift ban on ban10000" }));
    expect(await screen.findByText("Ban on ban10000 lifted.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(lastPost().path).toBe("/bans/lift");
    await ui.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(posts().some((c) => c.path === "/bans/restore")).toBe(true);
  });

  it("says so, and refreshes, if the ban had already ended", async () => {
    const a = withBans();
    open("/admin/bans", a);
    const lift = await screen.findByRole("button", { name: "Lift ban on ban10000" });
    a.bans = [];
    await ui.click(lift);
    expect(await screen.findByText("That ban has already ended.")).toBeInTheDocument();
    expect(await screen.findByText("No one is banned")).toBeInTheDocument();
  });
});

describe("users", () => {
  const withUsers = (n = 3) => {
    const a = FakeAdmin.signedIn();
    a.users = Array.from({ length: n }, (_v, i) => user(i + 1));
    a.users[1]!.google = true;
    a.users[2]!.suspended = true;
    return a;
  };

  it("lists people with their email, join date and badges", async () => {
    open("/admin/users", withUsers());
    const list = await screen.findByRole("list", { name: "Accounts" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("person1@example.com")).toBeInTheDocument();
    expect(within(list).getByText("Google")).toBeInTheDocument();
    expect(within(list).getByText("Suspended")).toBeInTheDocument();
  });

  it("searches by name or email once typing pauses, and says when nobody matches", async () => {
    open("/admin/users", withUsers());
    await screen.findByRole("list", { name: "Accounts" });
    await ui.type(screen.getByRole("searchbox"), "person2");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByText("person2@example.com")).toBeInTheDocument();
    expect(admin.calls.some((c) => c.path === "/users?q=person2")).toBe(true);
    await ui.clear(screen.getByRole("searchbox"));
    await ui.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("No one matches")).toBeInTheDocument();
  });

  it("opens a person's details", async () => {
    open("/admin/users", withUsers());
    await ui.click(await screen.findByRole("button", { name: /Person 2/ }));
    const sheet = await screen.findByRole("dialog", { name: "Person 2" });
    expect(within(sheet).getByText("person2@example.com")).toBeInTheDocument();
    expect(within(sheet).getByText("Google")).toBeInTheDocument();
    expect(within(sheet).getByText("Has a password")).toBeInTheDocument();
    expect(within(sheet).getByText("Sign-ins")).toBeInTheDocument();
  });

  it("suspends straight away, says they were signed out, and Undo restores them", async () => {
    open("/admin/users", withUsers());
    await ui.click(await screen.findByRole("button", { name: /Person 1/ }));
    await ui.click(await screen.findByRole("button", { name: "Suspend account" }));
    expect(
      await screen.findByText(/Person 1 is suspended and has been signed out everywhere/),
    ).toBeInTheDocument();
    expect(admin.users[0]!.suspended).toBe(true);
    expect(await screen.findByRole("button", { name: "Restore account" })).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(admin.users[0]!.suspended).toBe(false));
    expect(await screen.findByRole("button", { name: "Suspend account" })).toBeInTheDocument();
  });

  it("restores a suspended account", async () => {
    open("/admin/users", withUsers());
    await ui.click(await screen.findByRole("button", { name: /Person 3/ }));
    await ui.click(await screen.findByRole("button", { name: "Restore account" }));
    await waitFor(() => expect(admin.users[2]!.suspended).toBe(false));
    expect(await screen.findByText("Person 3 can sign in again.")).toBeInTheDocument();
  });

  it("asks before resetting a password, and Cancel does nothing", async () => {
    open("/admin/users", withUsers());
    await ui.click(await screen.findByRole("button", { name: /Person 1/ }));
    await ui.click(await screen.findByRole("button", { name: "Reset password…" }));
    expect(screen.getByText(/signs Person 1 out everywhere/)).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/signs Person 1 out everywhere/)).not.toBeInTheDocument();
    expect(posts().some((c) => c.path.includes("reset-password"))).toBe(false);
  });

  it("resets a password, shows the new one once, and can copy it", async () => {
    open("/admin/users", withUsers());
    await ui.click(await screen.findByRole("button", { name: /Person 1/ }));
    await ui.click(await screen.findByRole("button", { name: "Reset password…" }));
    await ui.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByLabelText("New password")).toHaveTextContent("Xk3-p9Lm2Qzr");
    expect(screen.getByText(/Shown once/)).toBeInTheDocument();
    await ui.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("Xk3-p9Lm2Qzr");
    // the confirmation step is gone again
    expect(screen.queryByText(/signs Person 1 out everywhere/)).not.toBeInTheDocument();
  });

  it("does not keep the new password after the sheet is closed", async () => {
    open("/admin/users", withUsers());
    await ui.click(await screen.findByRole("button", { name: /Person 1/ }));
    await ui.click(await screen.findByRole("button", { name: "Reset password…" }));
    await ui.click(screen.getByRole("button", { name: "Reset password" }));
    await screen.findByLabelText("New password");
    await ui.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await ui.click(screen.getByRole("button", { name: /Person 1/ }));
    await screen.findByRole("dialog");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Xk3-p9Lm2Qzr");
  });
});

describe("activity", () => {
  const withEvents = () => {
    const a = FakeAdmin.signedIn();
    a.events = [
      event(1, { type: "login_failed", visitor: "aaaa1111" }),
      event(2, { kind: "admin", type: "admin_login", visitor: "bbbb2222" }),
      event(3, {
        kind: "system",
        type: "error",
        detail: "a request failed (TypeError)",
        visitor: "",
      }),
      event(4, { type: "register", visitor: "cccc3333" }),
    ];
    return a;
  };

  it("lists events with plain names and details, newest first", async () => {
    open("/admin/activity", withEvents());
    const list = await screen.findByRole("list", { name: "Activity" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("Failed sign-in");
    expect(items[0]).toHaveTextContent("aaaa1111");
    expect(items[1]).toHaveTextContent("Admin signed in");
    expect(items[2]).toHaveTextContent("Error");
    expect(items[2]).toHaveTextContent("a request failed (TypeError)");
    expect(items[3]).toHaveTextContent("Account created");
  });

  it("shows exact times on hover for people who need them", async () => {
    open("/admin/activity", withEvents());
    const list = await screen.findByRole("list", { name: "Activity" });
    const time = within(list).getAllByText(/ago|just now/)[0]!;
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("title");
    expect(time).toHaveAttribute("datetime");
  });

  it("filters by kind", async () => {
    open("/admin/activity", withEvents());
    await screen.findByRole("list", { name: "Activity" });
    await ui.click(screen.getByRole("button", { name: "System" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(
      admin.calls.some((c) => c.path.startsWith("/events") && c.path.includes("kind=system")),
    ).toBe(true);
    await ui.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
  });

  it("searches, and says when nothing is found", async () => {
    open("/admin/activity", withEvents());
    await screen.findByRole("list", { name: "Activity" });
    await ui.type(screen.getByRole("searchbox"), "bbbb");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    await ui.clear(screen.getByRole("searchbox"));
    await ui.type(screen.getByRole("searchbox"), "nothing-like-this");
    expect(await screen.findByText("Nothing found")).toBeInTheDocument();
  });

  it("loads more", async () => {
    const a = withEvents();
    a.pageSize = 3;
    open("/admin/activity", a);
    await screen.findByRole("list", { name: "Activity" });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await ui.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4));
  });

  it("links to a CSV of what is on screen, as a download", async () => {
    open("/admin/activity", withEvents());
    await screen.findByRole("list", { name: "Activity" });
    expect(screen.getByRole("link", { name: /download csv/i })).toHaveAttribute(
      "href",
      "/api/v1/admin/events.csv?days=30",
    );
    await ui.click(screen.getByRole("button", { name: "Admin" }));
    await ui.type(screen.getByRole("searchbox"), "login");
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /download csv/i })).toHaveAttribute(
        "href",
        "/api/v1/admin/events.csv?kind=admin&q=login&days=30",
      ),
    );
    expect(screen.getByRole("link", { name: /download csv/i })).toHaveAttribute("download");
  });

  it("refreshes on request", async () => {
    const a = withEvents();
    open("/admin/activity", a);
    await screen.findByRole("list", { name: "Activity" });
    const before = a.calls.filter((c) => c.path.startsWith("/events")).length;
    a.events.unshift(event(0, { type: "ban", kind: "admin" }));
    await ui.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Ban")).toBeInTheDocument();
    expect(a.calls.filter((c) => c.path.startsWith("/events")).length).toBe(before + 1);
  });
});

describe("system", () => {
  it("shows health, settings and data", async () => {
    const a = FakeAdmin.signedIn();
    a.users = [user(1)];
    open("/admin/system", a);
    await heading("System");
    const health = await screen.findByRole("list", { name: "Health" });
    expect(health).toHaveTextContent("Connected");
    expect(health).toHaveTextContent("4 ms");
    expect(health).toHaveTextContent("3 h 2 min");
    expect(health).toHaveTextContent("128 MB");
    const settings = screen.getByRole("list", { name: "Settings" });
    expect(settings).toHaveTextContent("Passerby");
    expect(settings).toHaveTextContent("http://localhost:5173");
    expect(
      within(settings).getByText("Relay server for video (TURN)").closest("li"),
    ).toHaveTextContent("Not set");
    const data = screen.getByRole("list", { name: "Data" });
    expect(data).toHaveTextContent("Removed after 90 days");
    expect(data).toHaveTextContent("Removed after 30 days");
  });

  it("never shows a secret", async () => {
    open("/admin/system");
    await heading("System");
    await screen.findByRole("list", { name: "Health" });
    expect(document.body).not.toHaveTextContent(/secret|password|key/i);
  });

  it("says there are no problems, or lists them", async () => {
    open("/admin/system");
    expect(await screen.findByText("No problems recorded")).toBeInTheDocument();
  });

  it("lists recorded problems", async () => {
    const a = FakeAdmin.signedIn();
    a.problems = [
      event(1, { kind: "system", type: "error", detail: "a request failed (TypeError)" }),
    ];
    open("/admin/system", a);
    const list = await screen.findByRole("list", { name: "Recent problems" });
    expect(list).toHaveTextContent("a request failed (TypeError)");
  });
});

describe("on the public site", () => {
  it("does not link to the admin area from any public page", async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    stubAdmin(FakeAdmin.signedIn());
    await screen.findByRole("heading", { name: /say hi to a total stranger/i });
    expect(document.querySelector('a[href*="admin"]')).toBeNull();
    unmount();
  });
});
