"""
End-to-end test of "Continue with Google" with real browsers, real cookies and the real database, against a
STAND-IN for Google (e2e/fake-google.mjs) that signs real tokens. It proves OUR side: the button, the
trip out and back, creating and signing in accounts, connecting and disconnecting Google, the 18+ rule,
and that forged or mismatched logins are refused. It cannot prove Google's own pages; see the README.

It creates and deletes real accounts and fills the activity log, so use a THROWAWAY database.

Start, in this order (the README's "Trying Google sign-in without Google" has the exact commands):
  1. the stand-in:   node e2e/fake-google.mjs                              (port 3300)
  2. the API with GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret and the GOOGLE_*_URL
     settings pointing at the stand-in, PUBLIC_URL=http://localhost:5200
  3. the web app on port 5200, proxying to that API

  BASE_URL=http://localhost:5200 python e2e/google_flow.py
"""
import asyncio, json, os, random, sys, urllib.request
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5200")
FAKE = os.environ.get("FAKE_GOOGLE_URL", "http://localhost:3300")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

RUN = random.randint(10, 250)
STAMP = str(random.randint(10**6, 10**7))
N = [0]

def control(**body):
    req = urllib.request.Request(FAKE + "/control", data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    urllib.request.urlopen(req).read()
def fake_log():
    return json.loads(urllib.request.urlopen(FAKE + "/log").read())["tokenRequests"]
def person(tag, name="Riley Q", email=None, verified=True):
    return {"sub": f"g-{tag}-{STAMP}", "email": email or f"{tag}{STAMP}@e2e.test", "name": name, "email_verified": verified}

async def new_person(br, vp=(1100, 800)):
    N[0] += 1
    ctx = await br.new_context(viewport={"width": vp[0], "height": vp[1]}, extra_http_headers={"x-forwarded-for": f"10.50.{RUN}.{N[0]}"})
    pg = await ctx.new_page()
    pg.errors, pg.back_from_google = [], False
    pg.on("framenavigated", lambda fr: setattr(pg, "back_from_google", True) if "google=" in fr.url else None)
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    return ctx, pg

async def note(pg, role="status"):
    await pg.wait_for_selector(f"main [role={role}]")
    return (await pg.inner_text(f"main [role={role}]")).strip()
async def either(pg):
    """The message shown after coming back from Google, whichever kind it is."""
    await pg.wait_for_selector("main [role=status], main [role=alert]")
    return (await pg.inner_text("main [role=status], main [role=alert]")).strip()
async def go_google(pg, selector="a:has-text('Continue with Google')"):
    """Click the Google button and wait for the whole trip (app -> stand-in Google -> app) to finish."""
    pg.back_from_google = False
    await pg.click(selector)
    for _ in range(300):                       # up to 15 s for the app -> Google -> app round trip
        if pg.back_from_google: break
        await asyncio.sleep(0.05)
    await pg.wait_for_load_state("load")
    return await either(pg)
async def sign_up_tab(pg):
    await pg.goto(B + "/account"); await pg.wait_for_selector("form[aria-label='Sign in']")
    await pg.click("button:has-text('Create account') >> nth=0")
    await pg.wait_for_selector("form[aria-label='Create account']")
async def sign_in_tab(pg):
    await pg.goto(B + "/account"); await pg.wait_for_selector("form[aria-label='Sign in']")

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()

        # ---- the button, and the 18+ rule ----
        ctx, a = await new_person(br)
        await sign_in_tab(a)
        ok(await a.locator("a:has-text('Continue with Google')").count() == 1, "the sign-in tab offers Continue with Google")
        ok((await a.get_attribute("a:has-text('Continue with Google')", "href")) == "/api/v1/auth/google/start", "it points at the app's own start address")
        await a.screenshot(path=SHOTS + "google-signin.png")
        await sign_up_tab(a)
        await a.click("a:has-text('Continue with Google')")
        ok("18 or older" in await note(a, "alert") and a.url.startswith(B), "on the sign-up tab, Google is refused until the 18+ box is ticked, and the page stays put")
        await a.check("form[aria-label='Create account'] input[type=checkbox]")
        await a.screenshot(path=SHOTS + "google-signup.png")

        # ---- creating an account with Google ----
        riley = person("riley")
        control(person=riley, mode="ok", tamper="none")
        msg = await go_google(a)
        await a.wait_for_selector("h2:has-text('Riley Q')")
        ok("created with Google" in msg, f"signing up with Google creates the account and welcomes the visitor: {msg!r}")
        ok("google=" not in a.url, f"the result code is tidied out of the address: {a.url}")
        ok(riley["email"] in await a.inner_text("main"), "the page shows the Google email")
        ok(await a.locator("header a:has-text('Riley Q')").count() == 1, "the header shows the name")
        text = await a.inner_text("main")
        ok("Password: not set" in text and "Google: connected" in text, "it says: no password, Google connected")
        ok(await a.locator("button:has-text('Disconnect Google')").count() == 0, "Disconnect is not offered while Google is the only way in")
        log = fake_log()
        ok(len(log) == 1 and log[0]["hadSecret"] and log[0]["hadVerifier"], f"the app sent Google its secret and the PKCE proof: {log}")
        await a.screenshot(path=SHOTS + "google-profile.png")
        cookies = {c["name"]: c for c in await ctx.cookies()}
        ok("pb_sess" in cookies and cookies["pb_sess"]["httpOnly"] and cookies["pb_sess"]["sameSite"] == "Lax", "the sign-in cookie is HttpOnly, SameSite=Lax")
        ok("pb_oauth" not in cookies, "the one-time trip cookie is gone after the trip")
        await a.reload(); await a.wait_for_selector("h2:has-text('Riley Q')")
        ok(True, "after a reload the visitor is still signed in")

        # ---- signing out and back in with Google (sign-in tab, no 18+ box needed) ----
        await a.click("button:has-text('Sign out')"); await a.wait_for_selector("form[aria-label='Sign in']")
        msg = await go_google(a)
        await a.wait_for_selector("h2:has-text('Riley Q')")
        ok(msg == "Signed in with Google.", f"signing in again with Google works: {msg!r}")
        # a password-less account can't be entered with a guessed password
        await a.click("button:has-text('Sign out')"); await a.wait_for_selector("form[aria-label='Sign in']")
        await a.fill("#in-email", riley["email"]); await a.fill("#in-password", "anything at all")
        await a.click("form[aria-label='Sign in'] button.go")
        ok("Wrong email or password" in await note(a, "alert"), "the Google-only account can't be entered with the password form")

        # ---- the same person, in a second browser, sets a password; the first one is signed out ----
        control(person=riley)
        ctx2, b = await new_person(br)
        await sign_in_tab(b)
        await go_google(b); await b.wait_for_selector("h2:has-text('Riley Q')")
        await b.click("summary:has-text('Set a password')")
        ok(await b.locator("#pw-current").count() == 0, "setting a first password does not ask for a current one")
        await b.fill("#pw-new", "short")
        await b.click("form[aria-label='Set a password'] button")
        ok("8 to 128" in await note(b, "alert"), "a weak password is refused")
        await b.fill("#pw-new", "a brand new pass")
        await b.click("form[aria-label='Set a password'] button")
        await b.wait_for_selector("main [role=status]:has-text('Password set')")
        await b.wait_for_selector("text=Password: set")
        ok(await b.locator("button:has-text('Disconnect Google')").count() == 1, "now Disconnect Google is offered")
        ok(await b.locator("summary:has-text('Change password')").count() == 1, "and the form has become Change password")
        await b.screenshot(path=SHOTS + "google-methods.png")
        # the password works from a clean browser
        ctx3, c = await new_person(br)
        await sign_in_tab(c)
        await c.fill("#in-email", riley["email"]); await c.fill("#in-password", "a brand new pass")
        await c.click("form[aria-label='Sign in'] button.go")
        await c.wait_for_selector("h2:has-text('Riley Q')")
        ok(True, "the new password signs in from another browser")

        # ---- disconnecting Google ----
        await b.click("button:has-text('Disconnect Google')")
        await b.wait_for_selector("main [role=status]:has-text('disconnected')")
        await b.wait_for_selector("text=Google: not connected")
        ok(await b.locator("a:has-text('Connect Google')").count() == 1, "after disconnecting, Connect Google is offered")
        # Google no longer finds this account; with the same email it is refused rather than merged
        await b.click("button:has-text('Sign out')"); await b.wait_for_selector("form[aria-label='Sign in']")
        msg = await go_google(b)
        ok("already exists" in msg and await b.locator("form[aria-label='Sign in']").count() == 1, f"Google can't take over an account just by sharing its email: {msg!r}")

        # ---- connecting Google to a password account ----
        sam_email = f"sam{STAMP}@e2e.test"
        ctx4, d = await new_person(br)
        await sign_up_tab(d)
        await d.fill("#up-name", "Sam"); await d.fill("#up-email", sam_email); await d.fill("#up-password", "correct horse")
        await d.check("form[aria-label='Create account'] input[type=checkbox]")
        await d.click("form[aria-label='Create account'] button.go")
        await d.wait_for_selector("h2:has-text('Sam')")
        sam_g = person("samg", name="Sam G")      # a different email at Google: linking is by sign-in, not by email
        control(person=sam_g)
        msg = await go_google(d, "a:has-text('Connect Google')")
        await d.wait_for_selector("text=Google: connected")
        ok("now connected" in msg, f"a signed-in password account can connect Google: {msg!r}")
        await d.click("button:has-text('Sign out')"); await d.wait_for_selector("form[aria-label='Sign in']")
        msg = await go_google(d)
        await d.wait_for_selector("h2:has-text('Sam')")
        ok(msg == "Signed in with Google." and sam_email in await d.inner_text("main"), "Google now signs in to that same account")
        # another account can't connect the same Google person
        ctx5, e = await new_person(br)
        await sign_up_tab(e)
        await e.fill("#up-name", "Other"); await e.fill("#up-email", f"other{STAMP}@e2e.test"); await e.fill("#up-password", "correct horse")
        await e.check("form[aria-label='Create account'] input[type=checkbox]")
        await e.click("form[aria-label='Create account'] button.go")
        await e.wait_for_selector("h2:has-text('Other')")
        msg = await go_google(e, "a:has-text('Connect Google')")
        ok("different account" in msg, f"a Google account already used by someone else can't be connected a second time: {msg!r}")

        # ---- deleting a Google-only account asks for the email ----
        del_person = person("del", name="Dana D")
        control(person=del_person)
        ctx6, f = await new_person(br)
        await sign_up_tab(f)
        await f.check("form[aria-label='Create account'] input[type=checkbox]")
        await go_google(f); await f.wait_for_selector("h2:has-text('Dana D')")
        await f.click("summary:has-text('Delete my account')")
        ok(await f.locator("#del-password").count() == 0 and await f.locator("#del-email").count() == 1, "with no password the delete form asks for the email address")
        await f.fill("#del-email", "someone@else.test")
        await f.click("form[aria-label='Delete my account'] button")
        ok("isn't the email" in await note(f, "alert") and await f.locator("h2:has-text('Dana D')").count() == 1, "a different email does not delete the account")
        await f.fill("#del-email", del_person["email"])
        await f.click("form[aria-label='Delete my account'] button")
        await f.wait_for_selector("form[aria-label='Sign in']")
        ok("deleted" in await note(f), "the right email deletes it")

        # ---- the refusals ----
        ctx7, g = await new_person(br)
        # not 18+: signing in (not up) with a Google person who has no account here
        control(person=person("newbie"), mode="ok", tamper="none")
        await sign_in_tab(g)
        msg = await go_google(g)
        ok("18+" in msg and await g.locator("form[aria-label='Sign in']").count() == 1, f"a new person coming from the sign-in tab (no 18+ tick) gets no account: {msg!r}")
        control(person=person("unver", verified=False))
        await sign_up_tab(g); await g.check("form[aria-label='Create account'] input[type=checkbox]")
        msg = await go_google(g)
        ok("isn't verified" in msg, f"an unverified Google email is refused: {msg!r}")
        control(person=person("cancel"), mode="cancel")
        await sign_in_tab(g)
        msg = await go_google(g)
        ok("cancelled" in msg, f"cancelling at Google is explained: {msg!r}")
        for tamper, what in (("nonce", "a token answering a different request"), ("aud", "a token meant for another app"), ("key", "a token signed with the wrong key")):
            control(person=person("forge" + tamper), mode="ok", tamper=tamper)
            await sign_up_tab(g); await g.check("form[aria-label='Create account'] input[type=checkbox]")
            msg = await go_google(g)
            ok("didn't work" in msg and await g.locator("form[aria-label='Sign in']").count() == 1, f"{what} is refused, nobody is signed in: {msg!r}")
        control(person=person("n"), mode="ok", tamper="none")
        # a callback that didn't start on this browser
        await g.goto(B + "/api/v1/auth/google/callback?code=made-up&state=made-up")
        await g.wait_for_selector("form[aria-label='Sign in']")
        ok("took too long" in await either(g), "a callback that didn't start here is refused with a plain message")
        # a made-up result code shows a general message, and is not echoed
        await g.goto(B + "/account?google=%3Cb%3Ehello%3C%2Fb%3E")
        msg = await note(g, "alert")
        ok("didn't work" in msg and "hello" not in msg, f"an unknown result code gets the general message, never echoed: {msg!r}")

        # ---- the page on a phone, and no script errors ----
        ctx8, m = await new_person(br, vp=(375, 720))
        for path in ("/account",):
            await m.goto(B + path); await m.wait_for_timeout(300)
            ok(await m.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"phone width: no sideways scroll on {path}")
        await m.screenshot(path=SHOTS + "google-mobile.png")
        errs = [x for pg in (a, b, c, d, e, f, g, m) for x in pg.errors]
        ok(not errs, "no script or console errors" + (": " + "; ".join(errs[:3]) if errs else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res)-sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
