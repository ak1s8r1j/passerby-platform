"""
End-to-end test of reporting and the admin area with real browsers, real cookies and the real database.

What it does, in order:
  1. strangers chat and report one person; three different reporters trigger the automatic pause;
  2. the owner signs in and works the queue: reports, a ban with Undo, a dismissal with Undo, bans, a
     lifted ban (the banned stranger can chat again);
  3. the sheet is dragged, flicked and caught mid-flight with a real mouse;
  4. users: suspend (their sign-in ends), restore, reset a password (the new one works);
  5. the activity log, its CSV download, and the system page;
  6. sign-in safety: wrong keys, lock-out, a copied cookie after sign-out, requests from other sites;
  7. phones, dark mode, reduced motion, and no script errors anywhere.

It creates real accounts, reports, bans and log lines, so use a THROWAWAY database (npm run db:e2e), and start
the API with ADMIN_USER=owner ADMIN_KEY=e2e-admin-key-98765 and PUBLIC_URL matching BASE_URL.
Needs Python with Playwright:  pip install playwright && python -m playwright install chromium

  BASE_URL=http://localhost:5200 python e2e/admin_flow.py
"""
import asyncio, csv, io, os, random, re, sys, time
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5200")
ADMIN_USER = os.environ.get("ADMIN_USER", "owner")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "e2e-admin-key-98765")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

RUN = random.randint(10, 240)       # a different block of made-up addresses each run
STAMP = str(random.randint(10**6, 10**7))
N = [0]
ERRORS = []

async def make(br, scheme="light", vp=(1180, 820), reduced="no-preference", admin=False):
    """A separate browser profile with its own made-up address, like a different person."""
    N[0] += 1
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": vp[0], "height": vp[1]},
                               reduced_motion=reduced, accept_downloads=True,
                               extra_http_headers={"x-forwarded-for": f"10.70.{RUN}.{N[0]}"})
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: ERRORS.append(str(e)))
    pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)
    return ctx, pg

async def stranger(br):
    ctx, pg = await make(br)
    await pg.goto(B + "/text")
    await pg.click('button:has-text("18 or older")')
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    return pg

async def until_status(pg, text, timeout=20000):
    await pg.wait_for_function("t => document.getElementById('status').innerText.includes(t)", arg=text, timeout=timeout)

async def talk(pg, text):
    await pg.fill('input[aria-label=Message]', text)
    await pg.keyboard.press("Enter")

async def report(pg, reason="Harassment or hate"):
    await pg.click("button.link.danger")
    await pg.wait_for_selector("dialog.rep[open]")
    await pg.click(f'dialog.rep label:has-text("{reason}")')
    await pg.click('dialog.rep button:has-text("Send report")')
    await until_status(pg, "Chat ended")

# ---------- the admin side ----------
async def admin_login(pg, key=ADMIN_KEY, user=ADMIN_USER):
    await pg.goto(B + "/admin")
    await pg.wait_for_selector("#adm-user")
    await pg.fill("#adm-user", user)
    await pg.fill("#adm-key", key)
    await pg.click('form[aria-label="Admin sign in"] button')

async def goto_section(pg, name):
    await pg.click(f'.adm-side a:has-text("{name}")')
    await pg.wait_for_selector(f'h1.adm-title:has-text("{name}")')

async def sheet_x(pg):
    return await pg.evaluate("""() => {
        const el = document.querySelector('.adm-sheet'); if (!el) return null;
        const m = /translate3d\\((-?[\\d.]+)px/.exec(el.style.transform); return m ? parseFloat(m[1]) : null; }""")

async def sheet_open(pg, timeout=4000):
    """The sheet has finished arriving: at rest, at x = 0."""
    await pg.wait_for_function("""() => { const el = document.querySelector('.adm-sheet'); if (!el) return false;
        const m = /translate3d\\((-?[\\d.]+)px/.exec(el.style.transform); return m && Math.abs(parseFloat(m[1])) < 0.2; }""", timeout=timeout)

async def sheet_gone(pg, timeout=4000):
    await pg.wait_for_selector(".adm-sheet", state="detached", timeout=timeout)

async def toast_text(pg, contains=None):
    """The message at the bottom of the screen. Pass `contains` to wait for the NEW one, not the previous one."""
    await pg.wait_for_selector(f'.adm-toast:has-text("{contains}")' if contains else ".adm-toast")
    return (await pg.inner_text(".adm-toast")).strip()

async def count_rows(pg, list_label):
    return await pg.locator(f'ul[aria-label="{list_label}"] > li').count()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()

        # =========================================================================
        # 1. reporting, and the automatic pause
        # =========================================================================
        x = await stranger(br)                     # the person who will be reported
        a, b, c = await stranger(br), await stranger(br), await stranger(br)

        ok(await a.locator("button.link.danger").count() == 0, "no Report button before anyone is matched")
        await x.click(".bar .btn.go")
        await a.click(".bar .btn.go")
        await until_status(a, "talking to a stranger"); await until_status(x, "talking to a stranger")
        ok(await a.locator("button.link.danger").count() == 1, "a Report button appears once matched")
        await talk(a, "hello there"); await x.wait_for_selector("text=hello there")
        await talk(x, "something rude from X"); await a.wait_for_selector("text=something rude from X")

        await a.click("button.link.danger")
        await a.wait_for_selector("dialog.rep[open]")
        await a.screenshot(path=SHOTS + "report-dialog.png")
        reasons = await a.locator('dialog.rep input[type=radio]').count()
        ok(reasons == 5, f"the report form lists five reasons: {reasons}")
        await a.click('dialog.rep button:has-text("Cancel")')
        await a.wait_for_selector("dialog.rep", state="hidden")
        ok(await a.locator("button.link.danger").count() == 1 and "talking to a stranger" in await a.inner_text("#status"), "Cancel leaves the chat as it was")

        await a.click("button.link.danger"); await a.click('dialog.rep label:has-text("Nudity or sexual content")')
        await a.click('dialog.rep button:has-text("Send report")')
        await until_status(a, "Chat ended")
        ok("Your report was saved" in await a.inner_text("[role=log]"), "the reporter is thanked and the chat ends")
        ok(await a.locator("button.link.danger").count() == 0, "the Report button is gone once it has been used")
        await x.wait_for_selector("text=The stranger left.")
        ok("report" not in (await x.inner_text("[role=log]")).lower() and await x.locator("dialog.rep").count() == 1, "the reported person is only told the stranger left")

        # a second and third different person report the same person (one after the chat already ended)
        await x.click(".bar .btn.go")
        await b.click(".bar .btn.go")
        await until_status(b, "talking to a stranger", 25000); await until_status(x, "talking to a stranger", 25000)
        await talk(b, "hi from B"); await talk(x, "more rude words")
        await x.wait_for_selector("text=hi from B")
        await x.click(".bar .btn.go")                        # X moves on; B's chat has ended: B reports AFTER it ended
        await b.wait_for_selector("text=The stranger left.")
        ok(await b.locator("button.link.danger").count() == 1, "the Report button is still there after the other person left")
        await b.click("button.link.danger"); await b.click('dialog.rep label:has-text("Harassment or hate")')
        await b.click('dialog.rep button:has-text("Send report")')
        await b.wait_for_selector("text=Your report was saved")
        ok(True, "a chat can be reported after the other person has left")

        await until_status(x, "Looking for someone", 15000)
        await c.click(".bar .btn.go")
        await until_status(c, "talking to a stranger", 25000); await until_status(x, "talking to a stranger", 25000)
        await talk(c, "hi from C"); await talk(x, "<img src=x onerror=alert(1)> rude")
        await c.wait_for_selector("text=rude")
        await report(c, "Spam or advertising")
        await x.wait_for_selector("text=removed for breaking the rules", timeout=15000)
        ok(True, "the third different reporter pauses the person automatically, and they are told")
        await x.screenshot(path=SHOTS + "report-banned.png")
        ok(await x.locator(".bar .btn.go").is_disabled(), "the paused person can't start another chat")

        # =========================================================================
        # 2. the owner works the queue
        # =========================================================================
        octx, ad = await make(br)
        await admin_login(ad, key="not-the-key-12345")
        await ad.wait_for_selector('[role=alert]')
        ok("Wrong name or key" in await ad.inner_text('[role=alert]') and await ad.input_value("#adm-key") == "", "a wrong key is explained and the key box is emptied")
        await ad.screenshot(path=SHOTS + "admin-login.png")
        await ad.fill("#adm-key", ADMIN_KEY)
        await ad.click('form[aria-label="Admin sign in"] button')
        await ad.wait_for_selector("text=Online now")
        cookies = {c["name"]: c for c in await octx.cookies()}
        ck = cookies.get("pb_admin")
        ok(ck and ck["httpOnly"] and ck["sameSite"] == "Strict" and ck["path"] == "/api/v1/admin", f"the admin cookie is HttpOnly, SameSite=Strict, limited to the admin API: {ck and (ck['httpOnly'], ck['sameSite'], ck['path'])}")
        ok("pb_admin" not in await ad.evaluate("document.cookie"), "scripts on the page can't read the admin cookie")
        ok(await ad.locator('meta[name=robots]').get_attribute("content") == "noindex, nofollow", "the admin pages ask search engines to stay away")

        await ad.wait_for_function("document.querySelector('.adm-nav .adm-badge') && document.querySelector('.adm-nav .adm-badge').innerText.trim() === '3'", timeout=8000)
        ok(True, "the Reports link carries a badge with the 3 open reports")
        tiles = await ad.inner_text(".adm-tiles")
        ok("Online now" in tiles and "Open reports" in tiles and "3" in tiles, "the overview shows live counts and open reports")
        await ad.screenshot(path=SHOTS + "admin-overview-light.png")

        # reports
        await goto_section(ad, "Reports")
        await ad.wait_for_selector('ul[aria-label="Reports"]')
        ok(await count_rows(ad, "Reports") == 3, "three open reports are listed")
        rows = await ad.inner_text('ul[aria-label="Reports"]')
        ok("Nudity or sexual content" in rows and "Harassment or hate" in rows and "Spam or advertising" in rows, "each shows its reason")
        await ad.screenshot(path=SHOTS + "admin-reports.png")

        await ad.click('ul[aria-label="Reports"] button:has-text("Spam or advertising")')
        await ad.wait_for_selector('[role=dialog][aria-label], .adm-sheet')
        await sheet_open(ad)
        sheet = await ad.inner_text(".adm-sheet")
        ok("3 different people have reported them today" in sheet, "the sheet says three different people reported this person")
        ok("Banned until" in sheet, "and that the automatic pause is in force")
        ok("<img src=x onerror=alert(1)> rude" in sheet and await ad.locator(".adm-sheet img").count() == 0, "what the stranger wrote is shown as text, never run")
        lines = await ad.locator(".adm-chat li").count()
        ok(lines == 2, f"the saved conversation has both sides: {lines}")
        await ad.screenshot(path=SHOTS + "admin-report-sheet-light.png")
        ok(await ad.evaluate("document.querySelector('.shell, .adm-shell').hasAttribute('inert')"), "the page behind the sheet is inert while it is open")
        ok(await ad.evaluate("document.activeElement === document.querySelector('.adm-sheet') || document.querySelector('.adm-sheet').contains(document.activeElement)"), "focus moved into the sheet")

        # ---- 3. the sheet, handled with a real mouse ----
        box = await ad.locator(".adm-sheet-title h2").bounding_box()
        width = (await ad.locator(".adm-sheet").bounding_box())["width"]
        x0, y0 = box["x"] + 10, box["y"] + 4
        await ad.mouse.move(x0, y0); await ad.mouse.down()
        await ad.mouse.move(x0 + 120, y0, steps=8)
        tx = await sheet_x(ad)
        ok(abs(tx - 120) < 3, f"dragging follows the mouse 1:1: moved 120px, sheet moved {tx:.0f}px")
        op = float(await ad.evaluate("document.querySelector('.adm-scrim').style.opacity"))
        ok(abs(op - (1 - 120 / width)) < 0.03, f"and the dimming follows the sheet: {op:.2f}")
        await ad.mouse.move(x0 - 150, y0, steps=8)
        tl = await sheet_x(ad)
        ok(-150 < tl < 0, f"pulling the wrong way stretches instead of following: {tl:.0f}px for 150px of mouse")
        await ad.mouse.move(x0 + 100, y0, steps=6)
        await ad.wait_for_timeout(300)               # rest before letting go: no flick
        await ad.mouse.up()
        await sheet_open(ad, 5000)
        ok(await ad.locator(".adm-sheet").count() == 1, "released short of half way, it settles back open")

        await ad.mouse.move(x0, y0); await ad.mouse.down()
        await ad.mouse.move(x0 + width * 0.7, y0, steps=8)
        await ad.wait_for_timeout(250)
        await ad.mouse.up()
        await sheet_gone(ad)
        ok(True, "released past half way, it carries on out of the screen")
        await ad.wait_for_function("!document.querySelector('.adm-shell').hasAttribute('inert')")
        ok(await ad.evaluate("document.documentElement.style.overflow") != "hidden", "the page behind is usable again")

        await ad.click('ul[aria-label="Reports"] button:has-text("Spam or advertising")'); await sheet_open(ad)
        # A flick of 80 px in about 64 ms, made of events timed inside the page, so it does not depend on how fast
        # this script's own mouse commands happen to arrive.
        await ad.evaluate("""async () => {
            const head = document.querySelector('.adm-sheet-head');
            const r = head.getBoundingClientRect(); const x0 = r.left + 40, y = r.top + 20;
            const fire = (type, x) => head.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true }));
            fire('pointerdown', x0);
            for (let i = 1; i <= 4; i++) { await new Promise((res) => setTimeout(res, 16)); fire('pointermove', x0 + i * 20); }
            fire('pointerup', x0 + 80);
        }""")
        await sheet_gone(ad)
        ok(True, "a quick flick sends it away even from a short distance (it follows where the flick was heading)")

        await ad.click('ul[aria-label="Reports"] button:has-text("Spam or advertising")'); await sheet_open(ad)
        # record where the sheet is at the very instant of a press, before anything reacts to it
        await ad.evaluate("""() => { window.__x0 = null; document.addEventListener('pointerdown', () => {
            const el = document.querySelector('.adm-sheet'); const m = el && /translate3d\\((-?[\\d.]+)px/.exec(el.style.transform);
            window.__x0 = m ? parseFloat(m[1]) : null; }, true); }""")
        # press at the far right edge of the title bar: it stays under the pointer while the sheet leaves to the right
        hb = await ad.locator(".adm-sheet-head").bounding_box()
        x0, y0 = ad.viewport_size["width"] - 8, hb["y"] + hb["height"] / 2
        await ad.mouse.move(x0, y0)
        await ad.keyboard.press("Escape")
        await ad.wait_for_timeout(60)
        await ad.mouse.down(); await ad.mouse.move(x0 - 1, y0)
        pressed = await ad.evaluate("window.__x0")
        grabbed = await sheet_x(ad)
        ok(pressed is not None and 5 < pressed < width and abs(grabbed - (pressed - 1)) < 1.5,
           f"grabbed while leaving, it carries on from exactly where it was, with no jump (it was at {pressed:.0f}px, now {grabbed:.0f}px)")
        await ad.mouse.move(x0 - 330, y0, steps=10)
        await ad.wait_for_timeout(300)
        await ad.mouse.up()
        await sheet_open(ad, 5000)
        ok(await ad.locator(".adm-sheet").count() == 1, "pulled back, it stays: changing your mind mid-way works")

        await ad.keyboard.press("Tab")
        inside = await ad.evaluate("document.querySelector('.adm-sheet').contains(document.activeElement)")
        ok(inside, "Tab stays inside the sheet")

        # ---- ban from the report, with Undo that restores the automatic pause ----
        await ad.click('.adm-seg button:has-text("7 days")')
        await ad.click('button:has-text("Ban for 7 days")')
        txt = await toast_text(ad, "Banned for 7 days")
        ok("Banned for 7 days" in txt and "Undo" in txt, f"banning confirms with a toast that offers Undo: {txt!r}")
        await sheet_gone(ad)
        await ad.wait_for_function("document.querySelectorAll('ul[aria-label=Reports] > li').length === 0", timeout=6000)
        ok(True, "the sheet leaves and all open reports about that person are closed")
        await ad.screenshot(path=SHOTS + "admin-toast.png")
        await goto_section(ad, "Bans")
        await ad.wait_for_selector('ul[aria-label="Bans in force"]')
        bantext = await ad.inner_text('ul[aria-label="Bans in force"]')
        ok("in 7 days" in bantext or "in 6 days" in bantext, f"the ban now runs for about 7 days: {' '.join(bantext.split())[:90]}")
        await ad.screenshot(path=SHOTS + "admin-bans.png")
        await ad.click(".adm-toast-btn")
        await ad.wait_for_timeout(600)
        await ad.reload(); await ad.wait_for_selector("h1.adm-title")
        await goto_section(ad, "Bans")
        await ad.wait_for_selector('ul[aria-label="Bans in force"]')
        bantext = await ad.inner_text('ul[aria-label="Bans in force"]')
        ok("in 7 days" not in bantext and "Reported by several people" in bantext, "Undo put the earlier automatic pause back (not nothing, and not 7 days)")
        await goto_section(ad, "Reports")
        await ad.wait_for_selector('ul[aria-label="Reports"]')
        ok(await count_rows(ad, "Reports") == 3, "and the reports are open again")

        # ---- dismiss one, and undo ----
        await ad.click('ul[aria-label="Reports"] button:has-text("Nudity or sexual content")'); await sheet_open(ad)
        await ad.click('.adm-sheet button:has-text("Dismiss")')
        txt = await toast_text(ad, "Report dismissed")
        ok("Report dismissed" in txt, "dismissing confirms with a toast")
        await sheet_gone(ad)
        await ad.wait_for_function("document.querySelectorAll('ul[aria-label=Reports] > li').length === 2", timeout=6000)
        await ad.click(".adm-toast-btn")
        await ad.wait_for_function("document.querySelectorAll('ul[aria-label=Reports] > li').length === 3", timeout=6000)
        ok(True, "Undo brings the dismissed report back")
        await ad.click('ul[aria-label="Reports"] button:has-text("Nudity or sexual content")'); await sheet_open(ad)
        await ad.click('.adm-sheet button:has-text("Dismiss")'); await sheet_gone(ad)
        await ad.click('.adm-seg button:has-text("Dismissed")')
        await ad.wait_for_selector('ul[aria-label="Reports"] li')
        ok(await count_rows(ad, "Reports") == 1, "the Dismissed filter shows it")

        # ---- the paused stranger gets back in when the owner lifts the ban ----
        await goto_section(ad, "Bans")
        await ad.wait_for_selector('ul[aria-label="Bans in force"] button:has-text("Lift")')
        await ad.click('ul[aria-label="Bans in force"] button:has-text("Lift")')
        txt = await toast_text(ad, "lifted")
        ok("lifted" in txt and "Undo" in txt, f"lifting a ban confirms with Undo: {txt!r}")
        await ad.wait_for_selector("text=No one is banned")
        await x.reload()
        await x.wait_for_selector(".bar .btn.go:not([disabled])")
        await x.click(".bar .btn.go")
        await until_status(x, "Looking for someone", 15000)
        ok(True, "the stranger can chat again once the owner lifts the ban")

        # =========================================================================
        # 4. users
        # =========================================================================
        uctx, u = await make(br)
        email = f"pat{STAMP}@e2e.test"; first_password = "correct horse battery"
        await u.goto(B + "/account"); await u.wait_for_selector("form[aria-label='Sign in']")
        await u.click("button:has-text('Create account') >> nth=0")
        await u.fill("#up-name", "Pat Tester"); await u.fill("#up-email", email); await u.fill("#up-password", first_password)
        await u.select_option("#up-gender", "m")
        await u.check("form[aria-label='Create account'] input[type=checkbox]")
        await u.click("form[aria-label='Create account'] button.go")
        await u.wait_for_selector("h2:has-text('Pat Tester')")

        await goto_section(ad, "Users")
        await ad.fill('input[type=search]', f"pat{STAMP}")
        await ad.wait_for_selector(f'ul[aria-label="Accounts"] li:has-text("{email}")')
        ok(await count_rows(ad, "Accounts") == 1, "searching for the person finds exactly them")
        await ad.screenshot(path=SHOTS + "admin-users.png")
        await ad.click('ul[aria-label="Accounts"] button:has-text("Pat Tester")'); await sheet_open(ad)
        await ad.screenshot(path=SHOTS + "admin-user-sheet.png")
        await ad.click('.adm-sheet button:has-text("Suspend account")')
        txt = await toast_text(ad, "suspended")
        ok("suspended" in txt and "signed out everywhere" in txt, f"suspending says they are signed out everywhere: {txt!r}")
        await u.reload(); await u.wait_for_selector("form[aria-label='Sign in']")
        ok(True, "the suspended person's existing sign-in stopped working at once")
        await u.fill("#in-email", email); await u.fill("#in-password", first_password)
        await u.click("form[aria-label='Sign in'] button.go")
        await u.wait_for_selector("main [role=alert]")
        ok("suspended" in (await u.inner_text("main [role=alert]")).lower(), "and they are told why when they try again")
        await ad.click(".adm-toast-btn")                          # Undo
        await ad.wait_for_selector('.adm-sheet button:has-text("Suspend account")')
        await u.click("form[aria-label='Sign in'] button.go")
        await u.wait_for_selector("h2:has-text('Pat Tester')")
        ok(True, "Undo restores the account, and they can sign in again")

        await ad.click('.adm-sheet button:has-text("Reset password…")')
        await ad.click('.adm-sheet button:has-text("Reset password") >> nth=-1')
        await ad.wait_for_selector('.adm-secret code')
        temp = (await ad.inner_text('.adm-secret code')).strip()
        ok(re.fullmatch(r"[A-Za-z0-9_-]{12}", temp) is not None, f"a new random password is shown once: {len(temp)} characters")
        await ad.screenshot(path=SHOTS + "admin-password-reset.png")
        await u.reload(); await u.wait_for_selector("form[aria-label='Sign in']")
        ok(True, "resetting also signed them out everywhere")
        await u.fill("#in-email", email); await u.fill("#in-password", first_password)
        await u.click("form[aria-label='Sign in'] button.go")
        await u.wait_for_selector("main [role=alert]")
        ok("Wrong email or password" in await u.inner_text("main [role=alert]"), "the old password no longer works")
        await u.fill("#in-password", temp)
        await u.click("form[aria-label='Sign in'] button.go")
        await u.wait_for_selector("h2:has-text('Pat Tester')")
        ok(True, "the new password works")
        await ad.keyboard.press("Escape"); await sheet_gone(ad)

        # =========================================================================
        # 5. activity, export, system
        # =========================================================================
        await goto_section(ad, "Activity")
        await ad.wait_for_selector('ul[aria-label="Activity"] li')
        text = await ad.inner_text('ul[aria-label="Activity"]')
        for label in ("Chat reported", "Ban", "Account created", "Admin signed in", "Account suspended", "Password reset"):
            ok(label in text, f"the activity log shows '{label}'")
        ok(email not in text and first_password not in text and temp not in text and "rude" not in text, "and never an email, a password, or what anyone said")
        await ad.screenshot(path=SHOTS + "admin-activity.png")
        await ad.click('.adm-seg button:has-text("Admin")')
        await ad.wait_for_function("[...document.querySelectorAll('ul[aria-label=Activity] li')].every(li => !/Chat reported|Account created/.test(li.innerText))")
        ok(True, "filtering to Admin hides visitor events")
        await ad.fill('input[type=search]', "suspend")
        await ad.wait_for_function("document.querySelectorAll('ul[aria-label=Activity] li').length >= 1 && [...document.querySelectorAll('ul[aria-label=Activity] li')].every(li => /suspend|restored/i.test(li.innerText))")
        ok(True, "searching narrows the list")
        await ad.fill('input[type=search]', ""); await ad.click('.adm-seg button:has-text("All")')
        # the link follows the filter after the search box has settled (a quarter of a second)
        await ad.wait_for_function("document.querySelector('a[download]').getAttribute('href') === '/api/v1/admin/events.csv?days=30'")
        async with ad.expect_download() as dl:
            await ad.click('a:has-text("Download CSV")')
        download = await dl.value
        raw = open(await download.path(), encoding="utf-8-sig").read()
        rows = list(csv.reader(io.StringIO(raw)))
        ok(rows[0] == ["id", "time", "kind", "type", "visitor", "detail"] and len(rows) > 8, f"the CSV has a header and {len(rows) - 1} rows")
        ok(re.fullmatch(r"activity-\d{4}-\d{2}-\d{2}\.csv", download.suggested_filename) is not None, f"saved as {download.suggested_filename}")
        ok(email not in raw and temp not in raw and first_password not in raw, "the CSV holds no emails or passwords")
        ok(not any(r[5].startswith(("=", "+", "-", "@")) for r in rows[1:]), "no cell in it could run as a spreadsheet formula")

        await goto_section(ad, "System")
        await ad.wait_for_selector('ul[aria-label="Health"]')
        health = await ad.inner_text('ul[aria-label="Health"]')
        ok("Connected" in health and "Running for" in health, "the system page shows the database is connected and the uptime")
        settings = await ad.inner_text('ul[aria-label="Settings"]')
        ok("localhost:5200" in settings and "Video chat" in settings, "and the settings")
        ok(ADMIN_KEY not in await ad.inner_text("body") and "e2e-admin-secret" not in await ad.inner_text("body"), "and never a secret")
        await ad.screenshot(path=SHOTS + "admin-system.png")

        # =========================================================================
        # 6. sign-in safety
        # =========================================================================
        old = await octx.cookies()
        await goto_section(ad, "Overview")
        await ad.wait_for_timeout(900)          # let the numbers finish counting up
        ok(await ad.locator(".adm-bars .adm-bar").count() == 24, "the chart has 24 bars, one for each hour")
        await ad.screenshot(path=SHOTS + "admin-overview-full.png", full_page=True)
        await ad.click('.adm-side button:has-text("Sign out")')
        await ad.wait_for_selector("#adm-user")
        ok(True, "signing out returns to the sign-in form")
        thief, tpg = await make(br)
        await thief.add_cookies([{k: v for k, v in c.items() if k in ("name", "value", "domain", "path", "httpOnly", "secure", "sameSite")} for c in old if c["name"] == "pb_admin"])
        me = await thief.request.get(B + "/api/v1/admin/me")
        ok((await me.json())["admin"] is None, "a copy of the cookie stops working the moment the owner signs out")
        evil = await thief.request.post(B + "/api/v1/admin/login", data={"user": ADMIN_USER, "key": ADMIN_KEY}, headers={"origin": "https://evil.example"})
        ok(evil.status == 403, f"a sign-in attempt from another website is refused: {evil.status}")
        probe = await thief.request.get(B + "/api/v1/admin/overview")
        ok(probe.status == 401, "admin data is refused without a sign-in")

        bad = []
        for i in range(9):
            r = await thief.request.post(B + "/api/v1/admin/login", data={"user": ADMIN_USER, "key": f"guess-number-{i}-xxxx"})
            bad.append(r.status)
        ok(bad[:8] == [401] * 8 and bad[8] == 429, f"repeated wrong keys lock the address out after 8: {bad}")
        right = await thief.request.post(B + "/api/v1/admin/login", data={"user": ADMIN_USER, "key": ADMIN_KEY})
        ok(right.status == 429, "even the right key is refused while locked out")

        # the owner (a different address) can still sign in, and the public site has no link to the admin area
        ctx2, ad2 = await make(br, scheme="dark")
        await admin_login(ad2)
        await ad2.wait_for_selector("text=Online now")
        ok(True, "a different address is not locked out")
        pub, pg = await make(br)
        await pg.goto(B + "/")
        ok(await pg.locator('a[href*="admin"]').count() == 0, "the public site never links to the admin area")

        # =========================================================================
        # 7. dark mode, phones, reduced motion
        # =========================================================================
        await ad2.screenshot(path=SHOTS + "admin-overview-dark.png")
        await goto_section(ad2, "Reports")
        await ad2.wait_for_selector('ul[aria-label="Reports"], .adm-empty')
        await ad2.click('.adm-seg button:has-text("All")')
        await ad2.wait_for_selector('ul[aria-label="Reports"] li')
        await ad2.click('ul[aria-label="Reports"] li >> nth=0 >> button'); await sheet_open(ad2)
        await ad2.screenshot(path=SHOTS + "admin-report-sheet-dark.png")
        await ad2.keyboard.press("Escape"); await sheet_gone(ad2)

        mctx, m = await make(br, vp=(390, 844))
        await admin_login(m)
        await m.wait_for_selector("text=Online now")
        ok(await m.evaluate("getComputedStyle(document.querySelector('.adm-tabs')).display") == "flex", "on a phone the sidebar becomes a bar along the bottom")
        ok(await m.evaluate("getComputedStyle(document.querySelector('.adm-side')).display") == "none", "and the sidebar is hidden")
        await m.screenshot(path=SHOTS + "admin-mobile-overview.png")
        for name in ("Reports", "Bans", "Users", "Activity", "System", "Overview"):
            await m.click(f'.adm-tabs a:has-text("{name}")')
            await m.wait_for_selector(f'h1.adm-title:has-text("{name}")')
            await m.wait_for_timeout(250)
            fits = await m.evaluate("document.documentElement.scrollWidth <= innerWidth")
            if not fits: print("   sideways scroll on", name)
            ok(fits, f"phone width: no sideways scroll on {name}")
        await m.click('.adm-tabs a:has-text("Reports")')
        await m.click('.adm-seg button:has-text("All")')
        await m.wait_for_selector('ul[aria-label="Reports"] li')
        await m.click('ul[aria-label="Reports"] li >> nth=0 >> button'); await sheet_open(m)
        sw = (await m.locator(".adm-sheet").bounding_box())["width"]
        ok(sw >= 389, f"on a phone the sheet is full width: {sw:.0f}px")
        await m.screenshot(path=SHOTS + "admin-mobile-sheet.png")
        await m.keyboard.press("Escape"); await sheet_gone(m)

        rctx, r = await make(br, reduced="reduce")
        await admin_login(r)
        await r.wait_for_selector("text=Online now")
        await goto_section(r, "Reports")
        await r.click('.adm-seg button:has-text("All")')
        await r.wait_for_selector('ul[aria-label="Reports"] li')
        await r.click('ul[aria-label="Reports"] li >> nth=0 >> button')
        await r.wait_for_selector(".adm-layer[data-fade='in']")
        ok(await sheet_x(r) is None, "with reduced motion the sheet fades instead of sliding (no movement)")
        await r.keyboard.press("Escape")
        await sheet_gone(r)
        ok(True, "and fades out")

        ok(not ERRORS, "no script or console errors anywhere" + (": " + "; ".join(ERRORS[:3]) if ERRORS else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
