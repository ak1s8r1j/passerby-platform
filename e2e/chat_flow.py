"""
End-to-end test of the text chat with real browsers: matching, chatting, typing, skipping and the
cool-down, flood limit, and the under-18 removal.

It creates real reports and bans (for made-up addresses 10.20.0.x), so point it at a THROWAWAY database,
not your development data. Needs Python with Playwright:  pip install playwright && python -m playwright install chromium

  BASE_URL=http://localhost:5173 python e2e/chat_flow.py      (start the app first)
"""
import asyncio, os, sys, time
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5173")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

N = [0]
async def open_chat(br, scheme="light", vp=(1100, 800), tags=()):
    N[0] += 1  # every test browser is a different stranger with their own address
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": vp[0], "height": vp[1]}, extra_http_headers={"x-forwarded-for": f"10.20.0.{N[0]}"})
    pg = await ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    await pg.goto(B + "/text")
    await pg.click('button:has-text("18 or older")')
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    for t in tags:
        await pg.fill("#tags", t); await pg.keyboard.press("Enter")
    return pg

status = lambda pg: pg.inner_text("#status")
async def until_status(pg, text, timeout=15000):
    await pg.wait_for_function("t => document.getElementById('status').innerText.includes(t)", arg=text, timeout=timeout)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        a = await open_chat(br, tags=["Chess"])
        b = await open_chat(br, "dark", tags=["chess!"])
        ok(await a.locator(".chip").count() == 1, "interests become chips")
        await a.screenshot(path=SHOTS + "p1-setup.png")

        t0 = time.time()
        await a.click(".bar .btn.go"); await until_status(a, "Looking for someone")
        await b.click(".bar .btn.go")
        await until_status(a, "talking to a stranger"); await until_status(b, "talking to a stranger")
        ok(time.time() - t0 < 3, f"shared interest matched at once ({time.time()-t0:.1f}s)")
        ok("You both like chess" in await a.inner_text("[role=log]") and "You both like chess" in await b.inner_text("[role=log]"), "both are told what they have in common")
        ok(await a.locator('input[aria-label=Message]').is_enabled(), "message box opens once matched")

        # talk, both ways
        await a.fill('input[aria-label=Message]', "hello from A"); await a.keyboard.press("Enter")
        await b.wait_for_selector("text=hello from A")
        ok(await b.locator(".them", has_text="hello from A").count() == 1 and await a.locator(".me", has_text="hello from A").count() == 1, "A's message arrives as theirs on B and shows as mine on A")
        await b.type('input[aria-label=Message]', "hi A, <b>bold</b>", delay=30)
        await until_status(a, "Stranger is typing")
        ok(True, "typing indicator shows on the other side")
        await b.keyboard.press("Enter")
        await a.wait_for_selector("text=<b>bold</b>")
        ok(await a.locator("[role=log] b").count() == 0, "markup from a stranger is shown as text, not run")
        await until_status(a, "talking to a stranger")
        await a.screenshot(path=SHOTS + "p1-chat-light.png"); await b.screenshot(path=SHOTS + "p1-chat-dark.png")

        # Next: partner told, quick skipper waits out the cool-down
        await a.click(".bar .btn.go")
        await b.wait_for_selector("text=The stranger left.")
        ok("Chat ended" in await status(b) and await b.locator('input[aria-label=Message]').is_disabled(), "partner is told, and can't type to nobody")
        ok("Finding someone in" in await status(a), "a quick skip shows the cool-down countdown: " + await status(a))
        await until_status(a, "Looking for someone", timeout=6000)
        ok(True, "after the wait, A is searching again")

        # flood: only six get through (fresh pair)
        c = await open_chat(br); d = await open_chat(br)
        await c.click(".bar .btn.go"); await d.click(".bar .btn.go")
        await until_status(c, "talking to a stranger"); await until_status(d, "talking to a stranger")
        for i in range(9):
            await c.fill('input[aria-label=Message]', f"spam {i}"); await c.keyboard.press("Enter")
        await c.wait_for_selector("text=too fast", timeout=5000)
        await asyncio.sleep(0.5)
        got = await d.locator(".them").count()
        ok(got == 6, f"flooding is limited: {got} of 9 got through, sender was warned")

        # under 18
        await d.fill('input[aria-label=Message]', "hey im 14 f"); await d.keyboard.press("Enter")
        await until_status(d, "can't chat right now", timeout=8000)
        ok("adults only" in (await d.inner_text("[role=log]")).lower(), "someone who says they are under 18 sees why they were removed")
        await c.wait_for_selector("text=The stranger left.")
        ok(await c.locator(".them", has_text="hey im 14").count() == 0, "the under-18 message was never shown to the other person")
        ok(await d.locator(".bar .btn.go").is_disabled(), "they cannot start again")
        await d.screenshot(path=SHOTS + "p1-banned.png")
        await d.reload()
        await until_status(d, "can't chat right now", timeout=8000)
        ok(True, "still removed after a reload: the ban is remembered on the server, and the notice shows at once")
        await asyncio.sleep(2.5)
        ok("can't chat right now" in await status(d), "a removed visitor is not stuck in a reconnect loop")

        # connection loss mid-chat is handled gracefully
        await a.click(".bar .btn.ghost")  # A stops searching, so it is not matched with the next two
        e = await open_chat(br, vp=(375, 720)); f = await open_chat(br, vp=(375, 720))
        await e.click(".bar .btn.go"); await f.click(".bar .btn.go")
        await until_status(e, "talking to a stranger"); await until_status(f, "talking to a stranger")
        ok(await e.evaluate("document.documentElement.scrollWidth<=innerWidth"), "phone width: no sideways scroll in a chat")
        await e.screenshot(path=SHOTS + "p1-chat-mobile.png")
        await f.context.close()
        await e.wait_for_selector("text=The stranger left.")
        ok(True, "closing a tab ends the chat for the other person")

        errs = [x for pg in (a, b, c, e) for x in pg.errors]
        ok(not errs, "no script or console errors" + (": " + "; ".join(errs[:3]) if errs else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res)-sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
