"""
End-to-end test of accounts with real browsers, real cookies and the real database: creating an account,
staying signed in, signing out and in, changing the password (which must end the other browser's
session), downloading and deleting your data, the lock-out after repeated wrong passwords, and the
legal pages.

It creates and deletes real accounts and fills the activity log, so use a THROWAWAY database.
Needs Python with Playwright:  pip install playwright && python -m playwright install chromium

  BASE_URL=http://localhost:5173 python e2e/account_flow.py      (start the app first)
"""
import asyncio, json, os, random, sys
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5173")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

RUN = random.randint(10, 250)          # a different made-up address block each run, so the hourly limits start fresh
STAMP = str(random.randint(10**6, 10**7))
EMAIL = f"riley{STAMP}@e2e.test"
PASSWORD = "correct horse battery"
NEW_PASSWORD = "an entirely new pass"
N = [0]

async def new_person(br, scheme="light", vp=(1100, 800)):
    """A separate browser profile with its own address, like a different person."""
    N[0] += 1
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": vp[0], "height": vp[1]}, accept_downloads=True,
                               extra_http_headers={"x-forwarded-for": f"10.40.{RUN}.{N[0]}"})
    pg = await ctx.new_page()
    pg.errors, pg.requests = [], []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    # failed sign-ins and the like are expected to show up as failed requests; real script errors are not
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    pg.on("request", lambda r: pg.requests.append(r.url))
    return ctx, pg

async def header(pg): return (await pg.inner_text("header")).strip()
async def note(pg, role="status"):
    await pg.wait_for_selector(f"[role={role}]")
    return (await pg.inner_text(f"main [role={role}]")).strip()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx, a = await new_person(br)

        # ---- the site around accounts ----
        await a.goto(B + "/")
        await a.wait_for_selector("header a:has-text('Sign in')")
        ok(await a.locator("header a:has-text('Sign in')").count() == 1, "the header offers Sign in to a visitor with no account")
        links = await a.locator("footer a").all_inner_texts()
        ok(links == ["Rules", "Terms", "Privacy"], f"the footer links to Rules, Terms and Privacy: {links}")
        await a.click("footer a:has-text('Privacy')")
        await a.wait_for_selector("h1:has-text('Privacy')")
        ok("hashed password" in await a.inner_text("main") and "Privacy | " in await a.title(), "the privacy page explains what is stored, and the tab says so: " + await a.title())
        ok(await a.locator("a[href='mailto:help@example.test']").count() >= 1, "it shows the operator's contact address")
        await a.goto(B + "/rules"); await a.wait_for_selector("h1:has-text('Rules')")
        ok("under 18" in await a.inner_text("main"), "the rules page covers the age rule")
        await a.goto(B + "/terms"); await a.wait_for_selector("h1:has-text('Terms')")
        ok("Accounts" in await a.inner_text("main"), "the terms cover accounts")

        # ---- creating an account ----
        await a.goto(B + "/account")
        await a.wait_for_selector("form[aria-label='Sign in']")
        await a.screenshot(path=SHOTS + "account-signin.png")
        await a.click("button:has-text('Create account') >> nth=0")
        await a.wait_for_selector("form[aria-label='Create account']")
        before = len(a.requests)
        await a.fill("#up-name", "Riley"); await a.fill("#up-email", "not-an-email"); await a.fill("#up-password", PASSWORD)
        await a.click("form[aria-label='Create account'] button.go")
        ok("valid email" in await note(a, "alert") and not any("/auth/register" in u for u in a.requests[before:]), "a bad email is explained at once, without contacting the server")
        await a.fill("#up-email", EMAIL)
        await a.click("form[aria-label='Create account'] button.go")
        ok("18 or older" in await note(a, "alert"), "the 18+ confirmation is required")
        await a.screenshot(path=SHOTS + "account-signup-error.png")
        await a.check("form[aria-label='Create account'] input[type=checkbox]")
        await a.click("form[aria-label='Create account'] button.go")
        await a.wait_for_selector("h2:has-text('Riley')")
        ok("Welcome" in await note(a), "the account is created and the visitor is welcomed")
        ok(await a.locator("header a:has-text('Riley')").count() == 1, "the header now shows the visitor's name")
        ok(EMAIL in await a.inner_text("main") and "Member since" in await a.inner_text("main"), "the page shows their email and when they joined")
        await a.screenshot(path=SHOTS + "account-profile.png")

        # ---- the cookie ----
        cookies = {c["name"]: c for c in await ctx.cookies()}
        c = cookies.get("pb_sess")
        ok(c and c["httpOnly"] and c["sameSite"] == "Lax" and c["path"] == "/", f"the sign-in cookie is HttpOnly, SameSite=Lax: {c and {k: c[k] for k in ('httpOnly', 'sameSite')}}")
        ok("pb_sess" not in await a.evaluate("document.cookie"), "scripts on the page can't read the sign-in cookie")
        ok(c and 29 * 86400 < c["expires"] - __import__("time").time() < 31 * 86400, "it lasts about 30 days")

        # ---- staying signed in ----
        await a.reload()
        await a.wait_for_selector("h2:has-text('Riley')")
        ok(True, "after a reload the visitor is still signed in")
        await a.goto(B + "/text")
        await a.wait_for_selector("header a:has-text('Riley')")
        ok(True, "and the chat page knows who they are too")

        # ---- a second browser signs in; the password change must end its session ----
        ctx2, b = await new_person(br, scheme="dark")
        await b.goto(B + "/account"); await b.wait_for_selector("form[aria-label='Sign in']")
        await b.fill("#in-email", EMAIL); await b.fill("#in-password", "wrong password")
        await b.click("form[aria-label='Sign in'] button.go")
        ok("Wrong email or password" in await note(b, "alert"), "a wrong password gets a plain message")
        await b.fill("#in-password", PASSWORD)
        await b.click("form[aria-label='Sign in'] button.go")
        await b.wait_for_selector("h2:has-text('Riley')")
        ok(await b.locator("#in-password").count() == 0, "signing in from a second browser works")
        await b.screenshot(path=SHOTS + "account-profile-dark.png")

        await a.goto(B + "/account"); await a.wait_for_selector("h2:has-text('Riley')")
        await a.click("summary:has-text('Change password')")
        await a.fill("#pw-current", "nope nope nope"); await a.fill("#pw-new", NEW_PASSWORD)
        await a.click("form[aria-label='Change password'] button")
        ok("isn't right" in await note(a, "alert"), "changing the password needs the current one")
        await a.fill("#pw-current", PASSWORD); await a.fill("#pw-new", "short")
        await a.click("form[aria-label='Change password'] button")
        ok("8 to 128" in await note(a, "alert"), "a weak new password is refused")
        await a.fill("#pw-new", NEW_PASSWORD)
        await a.click("form[aria-label='Change password'] button")
        await a.wait_for_selector("main [role=status]:has-text('Password changed')")
        ok(await a.input_value("#pw-current") == "" and await a.input_value("#pw-new") == "", "the password is changed and both boxes are emptied")
        await a.reload(); await a.wait_for_selector("h2:has-text('Riley')")
        ok(True, "this browser carries on signed in")
        await b.reload(); await b.wait_for_selector("form[aria-label='Sign in']")
        ok(True, "the OTHER browser has been signed out by the password change")

        # ---- sign out, then in with old and new passwords ----
        await a.click("button:has-text('Sign out')")
        await a.wait_for_selector("form[aria-label='Sign in']")
        ok("signed out" in await note(a) and await a.locator("header a:has-text('Sign in')").count() == 1, "signing out returns to the signed-out page and header")
        await a.reload(); await a.wait_for_selector("form[aria-label='Sign in']")
        ok(True, "and it stays signed out after a reload")
        await a.fill("#in-email", EMAIL); await a.fill("#in-password", PASSWORD)
        await a.click("form[aria-label='Sign in'] button.go")
        ok("Wrong email or password" in await note(a, "alert"), "the old password no longer works")
        await a.fill("#in-password", NEW_PASSWORD)
        await a.click("form[aria-label='Sign in'] button.go")
        await a.wait_for_selector("h2:has-text('Riley')")
        ok(True, "the new password works")

        # ---- downloading my data ----
        async with a.expect_download() as dl:
            await a.click("a:has-text('Download my data')")
        download = await dl.value
        data = json.loads(open(await download.path(), encoding="utf-8").read())
        ok(download.suggested_filename == "my-data.json" and data["account"]["email"] == EMAIL, f"the download is {download.suggested_filename} with the account's details")
        text = json.dumps(data)
        ok("argon2" not in text and "passwordHash" not in text and "sessionVersion" not in text, "and holds no password hash or internal fields")

        # ---- deleting the account ----
        await a.click("summary:has-text('Delete my account')")
        await a.fill("#del-password", "wrong")
        await a.click("form[aria-label='Delete my account'] button")
        ok("isn't right" in await note(a, "alert") and await a.locator("h2:has-text('Riley')").count() == 1, "a wrong password does not delete the account")
        await a.fill("#del-password", NEW_PASSWORD)
        await a.click("form[aria-label='Delete my account'] button")
        await a.wait_for_selector("form[aria-label='Sign in']")
        ok("deleted" in await note(a), "the account is deleted and the visitor is told")
        await a.fill("#in-email", EMAIL); await a.fill("#in-password", NEW_PASSWORD)
        await a.click("form[aria-label='Sign in'] button.go")
        ok("Wrong email or password" in await note(a, "alert"), "a deleted account can't be signed in to")
        await a.click("button:has-text('Create account') >> nth=0")
        await a.fill("#up-name", "Riley Again"); await a.fill("#up-email", EMAIL); await a.fill("#up-password", PASSWORD)
        await a.check("form[aria-label='Create account'] input[type=checkbox]")
        await a.click("form[aria-label='Create account'] button.go")
        await a.wait_for_selector("h2:has-text('Riley Again')")
        ok(True, "the email can be used again afterwards")

        # ---- brute-force protection ----
        ctx3, g = await new_person(br)
        await g.goto(B + "/account"); await g.wait_for_selector("form[aria-label='Sign in']")
        message = ""
        for i in range(12):
            await g.fill("#in-email", f"guess{i}@e2e.test"); await g.fill("#in-password", "nope nope")
            await g.click("form[aria-label='Sign in'] button.go")
            await g.wait_for_selector("main [role=alert]")
            message = await g.inner_text("main [role=alert]")
            if "Too many" in message: break
        ok("Too many attempts" in message, f"repeated wrong passwords lock the visitor out after {i + 1} tries: {message!r}")

        # ---- accessibility and phones ----
        for path in ("/account", "/rules", "/privacy"):
            await a.goto(B + path); await a.wait_for_timeout(300)
            unl = await a.evaluate("[...document.querySelectorAll('input,select,textarea')].filter(e=>e.type!=='hidden'&&!e.closest('details:not([open])')).filter(e=>!(e.labels&&e.labels.length)&&!e.getAttribute('aria-label')).map(e=>e.id||e.type)")
            ok(not unl, f"every field on {path} has a label" + (f": {unl}" if unl else ""))
        ctx4, m = await new_person(br, vp=(375, 720))
        for path in ("/account", "/rules", "/terms", "/privacy"):
            await m.goto(B + path); await m.wait_for_timeout(300)
            fits = await m.evaluate("document.documentElement.scrollWidth <= innerWidth")
            if not fits: print("   sideways scroll on", path)
            ok(fits, f"phone width: no sideways scroll on {path}")
        await m.goto(B + "/account"); await m.click("button:has-text('Create account') >> nth=0"); await m.wait_for_timeout(300)
        await m.screenshot(path=SHOTS + "account-signup-mobile.png")

        errs = [x for pg in (a, b, g, m) for x in pg.errors]
        ok(not errs, "no script or console errors" + (": " + "; ".join(errs[:3]) if errs else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res)-sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
