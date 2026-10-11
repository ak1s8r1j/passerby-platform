"""
End-to-end test of the Match filter panel (Country / Language / Preferences) and country matching, with real
browsers and real public addresses: the server works each person's country out from their connection, so the
test connects "from" addresses that really are in the US, the UK, France and so on.

Start the API WITHOUT ACCOUNT_LINK (the default), so the header's Sign in link is hidden, as in production.
Needs a THROWAWAY database (npm run db:e2e) and Python with Playwright.

  BASE_URL=http://localhost:5200 python e2e/country_flow.py
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5200")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)
ERRORS = []

US, US2, GB, FR, NL, LOCAL = "8.8.8.8", "8.8.4.4", "81.2.69.142", "2.2.2.2", "91.198.174.192", "10.77.0.9"

async def person(br, ip, scheme="light", vp=(1300, 860)):
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": vp[0], "height": vp[1]},
                               extra_http_headers={"x-forwarded-for": ip})
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: ERRORS.append(str(e)))
    pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Optimize Dep" not in m.text else None)
    await pg.goto(B + "/text")
    await pg.click('button:has-text("18 or older")')
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    return pg

async def tile(pg, name):
    await pg.click(f'.filter-pop button.tile:has-text("{name}")')

async def pick_country(pg, *names, multiple=False):
    await pg.click(".filter-pill")
    if multiple:
        await pg.click('.filter-pop [role=switch][aria-labelledby="multi-label"]')
    for n in names:
        await tile(pg, n)
    await pg.keyboard.press("Escape")

async def matched(pg, timeout=12000):
    await pg.wait_for_function("document.getElementById('status').innerText.includes('talking to a stranger')", timeout=timeout)
async def looking(pg):
    await pg.wait_for_function("document.getElementById('status').innerText.includes('Looking for someone')", timeout=10000)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()

        # ---- the panel ----
        a = await person(br, US)
        ok(await a.locator(".top a:has-text('Sign in')").count() == 0, "the header's Sign in link is hidden")
        await a.goto(B + "/account")
        await a.wait_for_selector("form[aria-label='Sign in']")
        ok(True, "but the account page is still there at /account")
        await a.goto(B + "/text")
        await a.wait_for_selector(".filter-pill")
        ok(await a.locator("text=Get Premium").count() == 0 and await a.locator(".top a:has-text('Sign in')").count() == 0, "no premium offer and no sign-in link is shown")
        ok(await a.inner_text(".filter-pill") == "Smart Match", "the pill says Smart Match with nothing chosen")
        await a.click(".filter-pill")
        tabs = await a.locator("[role=tab]").all_inner_texts()
        ok(tabs == ["Country", "Language", "Preferences"], f"tabs: {tabs}")
        ok(await a.locator('button.tile.on:has-text("Smart Match")').count() == 1, "Country opens with Smart Match chosen")
        first = await a.locator(".filter-body .tiles button.tile").all_inner_texts()
        ok([t.splitlines()[-1] for t in first[:4]] == ["United States", "United Kingdom", "Canada", "Australia"], f"popular countries first: {first[:4]}")
        ok(await a.locator(".filter-body .tiles button.tile").count() > 200, "then every other country")
        ok("ALL COUNTRIES" in (await a.inner_text(".filter-sub")).upper(), "under an 'All countries (A-Z)' heading")
        await a.fill("#country-search", "germ")
        ok(await a.locator('.filter-pop button.tile:has-text("Germany")').count() == 1 and await a.locator('.filter-pop button.tile:has-text("France")').count() == 0, "search narrows the list")
        await a.fill("#country-search", "")
        await a.screenshot(path=SHOTS + "filter-country.png")
        await a.click('[role=tab]:has-text("Language")')
        ok(await a.locator('button.tile.on:has-text("Any language")').count() == 1, "Language opens on Any language")
        await a.screenshot(path=SHOTS + "filter-language.png")
        await a.click('[role=tab]:has-text("Preferences")')
        ok(await a.locator("#seek").count() == 1 and await a.locator("#me").count() == 1 and await a.locator("#tags").count() == 1, "Preferences holds Talk to, I am and interests")
        await a.keyboard.press("Escape")

        # ---- a country filter matches people from there, and says where they are from ----
        want_gb = await person(br, US)
        gb = await person(br, GB)
        await pick_country(want_gb, "United Kingdom")
        ok("United Kingdom" in await want_gb.inner_text(".filter-pill"), "the pill shows the chosen country")
        await want_gb.click(".bar .btn.go"); await gb.click(".bar .btn.go")
        await matched(want_gb); await matched(gb)
        log_a, log_b = await want_gb.inner_text("[role=log]"), await gb.inner_text("[role=log]")
        ok("United Kingdom" in log_a, "the person is told the other is from the United Kingdom")
        ok("United States" in log_b, "and the other is told they are from the United States")
        badge = await want_gb.inner_text(".origin")
        ok("United Kingdom" in badge and await want_gb.locator(".origin .fi-gb").count() == 1, f"the top right of the chat shows the flag and country: {badge!r}")
        await want_gb.screenshot(path=SHOTS + "chat-country.png")

        # ---- but not people from elsewhere, however long they wait ----
        want_fr = await person(br, US2)
        nl = await person(br, NL)
        await pick_country(want_fr, "France")
        await want_fr.click(".bar .btn.go"); await nl.click(".bar .btn.go")
        await looking(want_fr); await looking(nl)
        await want_fr.wait_for_timeout(7000)
        ok("Looking for someone" in await want_fr.inner_text("#status"), "someone who wants France is not given a Dutch person, even after the wait")

        # ---- someone whose country cannot be told is not guessed at ----
        local = await person(br, LOCAL)
        await local.click(".bar .btn.go")
        await local.wait_for_timeout(5000)
        ok("Looking for someone" in await want_fr.inner_text("#status"), "and not given a person whose country is unknown either")
        await local.click(".btn.ghost:has-text('Stop')")
        await nl.click(".btn.ghost:has-text('Stop')")

        # ---- the right person arrives ----
        fr = await person(br, FR)
        await fr.click(".bar .btn.go")
        await matched(want_fr); await matched(fr)
        ok("United States" in await fr.inner_text("[role=log]"), "the one from France is matched with them")

        # ---- several countries at once ----
        multi = await person(br, NL, scheme="dark")
        await pick_country(multi, "United States", "United Kingdom", "Canada", multiple=True)
        ok("3 countries" in await multi.inner_text(".filter-pill"), "several countries can be chosen with 'Select multiple'")
        await multi.click(".filter-pill")
        await multi.screenshot(path=SHOTS + "filter-multi-dark.png")
        await multi.keyboard.press("Escape")

        # ---- the theme switch ----
        t = await person(br, US)
        before = await t.evaluate("document.documentElement.dataset.theme")
        await t.click(".theme-toggle")
        after = await t.evaluate("document.documentElement.dataset.theme")
        ok(before != after and after in ("light", "dark"), f"the theme switch flips the page: {before} -> {after}")
        await t.reload()
        await t.wait_for_selector(".theme-toggle")
        ok(await t.evaluate("document.documentElement.dataset.theme") == after, "and the choice is remembered after a reload")

        ok(not ERRORS, "no script or console errors" + (": " + "; ".join(ERRORS[:3]) if ERRORS else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
