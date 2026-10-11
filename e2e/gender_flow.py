"""
End-to-end test of the "Talk to" filter (Both / Male / Female) with real browsers: who gets matched with whom,
that a filter is never relaxed by waiting, and that it is remembered.

It makes made-up strangers, so use a THROWAWAY database (npm run db:e2e). Needs Python with Playwright.

  BASE_URL=http://localhost:5200 python e2e/gender_flow.py
"""
import asyncio, os, random, sys, time
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5200")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

RUN = random.randint(10, 240)
N = [0]
ERRORS = []

async def stranger(br, me="", seek="", scheme="light"):
    N[0] += 1
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": 1100, "height": 800},
                               extra_http_headers={"x-forwarded-for": f"10.80.{RUN}.{N[0]}"})
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: ERRORS.append(str(e)))
    pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    await pg.goto(B + "/text")
    await pg.click('button:has-text("18 or older")')
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    if me or seek:
        await pg.click(".filter-pill")
        await pg.click('[role=tab]:has-text("Preferences")')
        if me: await pg.select_option("#me", me)
        if seek: await pg.select_option("#seek", seek)
        await pg.keyboard.press("Escape")
    return pg

async def status(pg): return await pg.inner_text("#status")
async def matched(pg, timeout=12000):
    await pg.wait_for_function("document.getElementById('status').innerText.includes('talking to a stranger')", timeout=timeout)
async def searching(pg):
    await pg.wait_for_function("document.getElementById('status').innerText.includes('Looking for someone')", timeout=10000)

async def never_matches(pg, seconds):
    """Still looking after `seconds` (well past the 4 s when interests stop mattering)."""
    await pg.wait_for_timeout(int(seconds * 1000))
    return "Looking for someone" in await status(pg)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()

        # ---- the control itself ----
        a = await stranger(br)
        ok("Smart Match" in await a.inner_text(".filter-pill"), "the filters sit behind a 'Smart Match' pill")
        await a.click(".filter-pill")
        tabs = await a.locator("[role=tab]").all_inner_texts()
        ok(tabs == ["Country", "Language", "Preferences"], f"the panel has Country, Language and Preferences tabs: {tabs}")
        await a.click('[role=tab]:has-text("Preferences")')
        labels = await a.locator(".three label").all_inner_texts()
        ok(labels == ["Talk to", "I am"], f"'Talk to' comes first among the preferences: {labels}")
        options = await a.locator("#seek option").all_inner_texts()
        ok(options == ["Both", "Male", "Female"], f"with the choices Both, Male and Female: {options}")
        ok(await a.input_value("#seek") == "", "and it starts on Both")
        await a.select_option("#seek", "f")
        note = await a.inner_text("[role=note]")
        ok("Only people who say they are female" in note and "Choose what you are too" in note, "choosing one explains what it means")
        await a.screenshot(path=SHOTS + "talk-to.png")
        await a.reload()
        await a.wait_for_selector(".filter-pill")
        ok("Female" in await a.inner_text(".filter-pill"), "the pill itself shows the choice after a reload")
        await a.click(".filter-pill")
        await a.click('[role=tab]:has-text("Preferences")')
        await a.wait_for_selector("#seek")
        ok(await a.input_value("#seek") == "f", "it is remembered after a reload")

        # ---- a woman who wants men and a man who wants women find each other ----
        f1 = await stranger(br, me="f", seek="m")
        m1 = await stranger(br, me="m", seek="f")
        await f1.click(".bar .btn.go"); await m1.click(".bar .btn.go")
        t0 = time.time()
        await matched(f1); await matched(m1)
        ok(time.time() - t0 < 4, f"a woman wanting men and a man wanting women match at once ({time.time() - t0:.1f}s)")

        # ---- a man who wants men is NOT matched with a woman, even though she'd take anyone ----
        m2 = await stranger(br, me="m", seek="m")
        f2 = await stranger(br, me="f")
        await m2.click(".bar .btn.go"); await f2.click(".bar .btn.go")
        await searching(m2); await searching(f2)
        ok(await never_matches(m2, 7), "a man who wants men is not given a woman, even after the wait when interests stop mattering")
        ok("Looking for someone" in await status(f2), "and she isn't given him either")
        await m2.screenshot(path=SHOTS + "talk-to-waiting.png")

        await f2.click(".btn.ghost:has-text('Stop')")           # she leaves; only the man who wants men is still waiting
        # ---- someone who wants women is not matched with someone who never said ----
        m3 = await stranger(br, me="m", seek="f")
        anon = await stranger(br)
        await m3.click(".bar .btn.go"); await anon.click(".bar .btn.go")
        await searching(m3)
        ok(await never_matches(m3, 6), "someone who wants women is not matched with someone who didn't say what they are")
        await anon.click(".btn.ghost:has-text('Stop')")

        # ---- a suitable person arrives and is matched with the one who was waiting ----
        m4 = await stranger(br, me="m")                           # a man who takes anyone
        await m4.click(".bar .btn.go")
        await matched(m2); await matched(m4)
        ok(True, "when a man arrives, the man who wanted men is matched with him")
        ok("Looking for someone" in await status(m3), "and the man who wants women is still waiting for the right person")

        f3 = await stranger(br, me="f")
        await f3.click(".bar .btn.go")
        await matched(m3); await matched(f3)
        ok(True, "until a woman arrives, and then he is matched with her")

        ok(not ERRORS, "no script or console errors" + (": " + "; ".join(ERRORS[:3]) if ERRORS else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
