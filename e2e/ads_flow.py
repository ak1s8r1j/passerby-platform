"""
End-to-end test of the ad slots with real browsers. Google's ad script is replaced by a small stand-in that fills the
box with a visible "Test ad", so the layout, the placement rules and the unlock flow can be checked without an AdSense
account or network.

Start the API serving the BUILT web app (so the real security policy is in force), with ads on:

  npm run build -w apps/web
  ADSENSE_CLIENT=ca-pub-1138895012480462 ADSENSE_SLOT_PROFILE=1111111111 ADSENSE_SLOT_LANDING=2222222222 \\
  REWARDED_ADS=demo PLUS_FILTERS=true WEB_DIST=<absolute path to apps/web/dist> PORT=3200 \\
  ADS_SPONSORS='[{"id":"acme","name":"Acme","logo":"/icon.svg","headline":"Cheaper flights","cta":"See deals","url":"https://acme.example"}]' \\
  npm run start -w apps/api        (or: tsx src/index.ts, with the usual DATABASE_URL and SESSION_SECRET)

  BASE_URL=http://localhost:3200 python e2e/ads_flow.py

It creates chats and needs a throwaway database (see chat_flow.py).
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:3200")
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

STUB = """
(function () {
  window.adsbygoogle = window.adsbygoogle || [];
  window.adsbygoogle.push = function () {
    document.querySelectorAll("ins.adsbygoogle:not([data-done])").forEach(function (ins) {
      ins.setAttribute("data-done", "1"); ins.setAttribute("data-ad-status", "filled");
      var d = document.createElement("div");
      d.style.cssText = "width:100%;height:100%;background:#fde68a;display:grid;place-items:center;color:#000";
      d.textContent = "Test ad"; ins.appendChild(d);
    });
  };
})();
"""
RECT = """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  return {x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right}; }"""
N = [0]

async def context(br, vp, scheme="light", mobile=False, delay=0, seen=None):
    N[0] += 1
    c = await br.new_context(viewport={"width": vp[0], "height": vp[1]}, color_scheme=scheme, is_mobile=mobile, has_touch=mobile,
                             permissions=["camera", "microphone"], extra_http_headers={"x-forwarded-for": f"10.70.{N[0]}.1"})
    async def google(route):
        if seen is not None: seen.append(route.request.url)
        if delay: await asyncio.sleep(delay)
        await route.fulfill(status=200, content_type="application/javascript", body=STUB)
    await c.route("**/pagead2.googlesyndication.com/**", google)
    return c

async def page(c, path):
    pg = await c.new_page(); pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    await pg.goto(B + path)
    await pg.click('button:has-text("18 or older")')
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    return pg

async def pair(br, vp, path="/text", mobile=False, seen=None):
    a = await page(await context(br, vp, "light", mobile, seen=seen), path)
    b = await page(await context(br, (1100, 800)), path)
    await a.click(".bar .btn.go"); await b.click(".bar .btn.go")
    await a.wait_for_selector("#status:has-text('talking to a stranger')", timeout=30000)
    return a, b

async def say(b, a, text):
    await b.fill('input[aria-label=Message]', text); await b.keyboard.press("Enter")
    await a.wait_for_selector(f"text={text}")

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])

        # ---- slot 5: landing banner (desktop) ----
        seen = []
        pg = await (await context(br, (1280, 800), delay=1.0, seen=seen)).new_page()
        await pg.goto(B + "/")
        await pg.wait_for_selector(".home-ad .ad")
        before, note = await pg.evaluate(RECT, ".home-ad .ad-box"), await pg.evaluate(RECT, ".home-note")
        ok(before["w"] == 728 and before["h"] == 90, "landing: 728x90 is reserved before the ad arrives")
        await pg.wait_for_selector("ins[data-ad-status=filled]", timeout=10000)
        after, note2 = await pg.evaluate(RECT, ".home-ad .ad-box"), await pg.evaluate(RECT, ".home-note")
        ok(after == before and note["y"] == note2["y"], "landing: nothing moves when the ad arrives")
        points, banner, foot = await pg.evaluate(RECT, ".home-points"), await pg.evaluate(RECT, ".home-ad .ad"), await pg.evaluate(RECT, "footer")
        ok(round(banner["y"] - points["b"]) == 20 and banner["b"] < foot["y"], "landing: 20px under the feature row and above the footer")
        ok(abs(banner["x"] + banner["w"] / 2 - 640) <= 2, "landing: centred")
        ok(await pg.locator(".ad-head .ad-tag").inner_text() == "ad" and await pg.locator(".ad-remove").inner_text() == "remove ads ✦", "the slot has an 'ad' label and a 'remove ads' link")
        await pg.click(".ad-remove")
        ok(await pg.locator("[role=dialog]:has-text('Passerby Plus')").count() == 1, "'remove ads' opens the Plus box")
        await pg.context.close()

        # ---- slot 5 on a phone: nothing, and Google's script is never asked for ----
        seen = []
        pg = await (await context(br, (390, 844), mobile=True, seen=seen)).new_page()
        await pg.goto(B + "/"); await pg.wait_for_selector("h1"); await asyncio.sleep(1.2)
        ok(await pg.locator(".ad").count() == 0 and not seen, "landing on a phone: no banner, and no request to Google")
        await pg.context.close()

        # ---- slots 2 and 4 on desktop ----
        a, b = await pair(br, (1280, 800))
        box, looking, safe, peer = [await a.evaluate(RECT, s) for s in (".peer .ad-box", ".peer-looking", ".peer-safe", ".peer")]
        ok(box["w"] == 300 and box["h"] == 250, "profile panel: 300x250")
        ok(box["y"] - looking["b"] >= 24 and safe["y"] - box["b"] >= 24, "profile panel: at least 24px above and below")
        ok(abs(box["x"] + box["w"] / 2 - (peer["x"] + peer["w"] / 2)) <= 2 and box["b"] <= peer["b"], "profile panel: centred and inside the panel")
        ok(await a.locator(".sponsor").count() == 0, "sponsored card: not shown before the stranger says anything")
        await say(b, a, "hey there")
        card, bubble, pane, react = [await a.evaluate(RECT, s) for s in (".sponsor", ".log .b.them", ".pane", ".reactions")]
        ok(await a.locator(".sponsor").count() == 1, "sponsored card: one, after the stranger's first message")
        ok(card["w"] == 420 and 76 <= card["h"] <= 84, "sponsored card: 420 wide and about 80 tall on desktop")
        ok(abs(card["x"] + card["w"] / 2 - (pane["x"] + pane["w"] / 2)) <= 6 and card["y"] >= bubble["b"], "sponsored card: centred, below that message")
        ok(react["y"] - card["b"] >= 24, "sponsored card: at least 24px from the reaction buttons")
        ok("sponsored" in (await a.inner_text(".sponsor .sponsor-tag")).lower() and await a.locator(".sponsor img").get_attribute("width") == "52", "sponsored card: labelled, with a 52px logo")
        await say(b, a, "and another one")
        ok(await a.locator(".sponsor").count() == 1, "sponsored card: not repeated in the same match")
        ok(not a.errors, "no script errors with the real security policy")
        await a.context.close(); await b.context.close()

        # ---- a short window shrinks the picture, not the ad ----
        a, b = await pair(br, (1280, 700))
        box, av, peer = await a.evaluate(RECT, ".peer .ad-box"), await a.evaluate(RECT, ".peer-avatar"), await a.evaluate(RECT, ".peer")
        ok(box["w"] == 300 and box["h"] == 250 and box["b"] <= peer["b"], "short window: the ad keeps 300x250 and fits")
        ok(av["w"] <= 80 and av["h"] == av["w"], "short window: the picture shrank instead, and stayed round")
        await a.context.close(); await b.context.close()

        # ---- slot 4 on a phone, and no profile banner ----
        seen = []
        a, b = await pair(br, (390, 844), mobile=True, seen=seen)
        await say(b, a, "hi from desktop")
        card, pane = await a.evaluate(RECT, ".sponsor"), await a.evaluate(RECT, ".pane")
        ok(await a.locator(".sponsor").count() == 1 and 72 <= card["h"] <= 84, "sponsored card on a phone: about 76px tall")
        ok(card["w"] >= pane["w"] - 48 and card["r"] <= pane["r"], "sponsored card on a phone: the width of the message area")
        ok(await a.locator(".ad").count() == 0 and not seen, "phone: no banner and no request to Google")
        await a.context.close(); await b.context.close()

        # ---- video chat: nothing, anywhere ----
        for name, vp, mob in (("desktop", (1280, 800), False), ("phone", (390, 844), True)):
            seen = []
            a, b = await pair(br, vp, "/video", mob, seen)
            await say(b, a, "hello in video")
            await asyncio.sleep(0.8)
            ok(await a.locator(".ad, .sponsor").count() == 0 and not seen, f"video chat on {name}: no ad, no sponsor, no request to Google")
            await a.context.close(); await b.context.close()

        # ---- slot 3: locked filter -> Plus box -> rewarded ad ----
        for name, vp, mob in (("desktop", (1280, 800), False), ("phone", (390, 844), True)):
            pg = await page(await context(br, vp, mobile=mob), "/text")
            await pg.click(".filter-pill")
            await pg.click('button.tile:has-text("Canada")')
            await pg.wait_for_selector("[role=dialog]")
            ok(await pg.inner_text(".filter-pill") != "" and "Canada" not in await pg.inner_text(".filter-pill"), f"{name}: a locked country opens the Plus box and is not applied")
            main, rew = await pg.evaluate(RECT, ".plus-main"), await pg.evaluate(RECT, ".plus-rewarded")
            ok(await pg.locator(".plus-or").count() == 1 and rew["y"] > main["b"] and abs(rew["w"] - main["w"]) < 1, f"{name}: 'or', then a full-width watch-an-ad button under the main one")
            await pg.click(".plus-rewarded")
            await pg.wait_for_selector(".rewarded-video")
            v = await pg.evaluate(RECT, ".rewarded-video")
            dlg = await pg.evaluate(RECT, ".plus")
            ok(abs(v["w"] / v["h"] - 16 / 9) < 0.02 and v["w"] >= dlg["w"] - 48, f"{name}: 16:9 across the box ({round(v['w'])}x{round(v['h'])})")
            ok(await pg.locator(".rewarded-bar").count() == 1 and await pg.locator(".rewarded-close").count() == 1, f"{name}: a progress bar and a close button")
            await pg.click(".rewarded-close")
            ok(await pg.evaluate("localStorage.getItem('pb_unlock_until')") is None, f"{name}: closing early gives nothing")
            await pg.click(".plus-rewarded")
            await pg.wait_for_selector("text=filters unlocked for 30 min", timeout=12000)
            until, now = await pg.evaluate("Number(localStorage.getItem('pb_unlock_until'))"), await pg.evaluate("Date.now()")
            ok(29 <= (until - now) / 60000 <= 30.1, f"{name}: finishing the ad unlocks the filters for 30 minutes, with a toast")
            ok(await pg.locator("[role=dialog]").count() == 0 and await pg.locator(".filter-pop").count() == 1, f"{name}: back at the filters")
            await pg.click('button.tile:has-text("Canada")')
            ok("Canada" in await pg.inner_text(".filter-pill"), f"{name}: the country can now be chosen")
            await pg.context.close()

        await br.close()
    print(f"\n{sum(res)} passed, {len(res)-sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
