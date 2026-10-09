"""
End-to-end test of video chat with real browsers and fake cameras: both people receive each other's live
picture, the microphone and camera buttons work, Next and Stop end the call and turn the camera off,
text and video people never meet, and a blocked camera is explained.

Chromium is started with a fake camera and microphone, so no real devices are needed.
It files nothing in the database, but start the app with a throwaway database anyway.
Needs Python with Playwright:  pip install playwright && python -m playwright install chromium

  BASE_URL=http://localhost:5173 python e2e/video_flow.py      (start the app first)
"""
import asyncio, os, sys, time
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5173")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

FAKE_CAMERA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
N = [0]

async def open_chat(br, path="/video", scheme="light", vp=(1280, 800), permissions=("camera", "microphone")):
    N[0] += 1  # every test browser is a different stranger with their own address
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": vp[0], "height": vp[1]},
                               permissions=list(permissions),
                               extra_http_headers={"x-forwarded-for": f"10.30.0.{N[0]}"})
    pg = await ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    await pg.goto(B + path)
    await pg.click('button:has-text("18 or older")')
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    return pg

status = lambda pg: pg.inner_text("#status")
async def until_status(pg, text, timeout=20000):
    await pg.wait_for_function("t => document.getElementById('status').innerText.includes(t)", arg=text, timeout=timeout)

# true once the other person's picture is really playing: it has a size and its clock is moving
PLAYING = """() => { const v = document.getElementById('remote');
  return !!(v && v.srcObject && v.videoWidth > 0 && v.currentTime > 0.3) }"""
async def playing(pg, timeout=25000):
    await pg.wait_for_function(PLAYING, timeout=timeout)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=FAKE_CAMERA)
        a = await open_chat(br)
        b = await open_chat(br, scheme="dark")

        ok("can reveal your IP address" in await a.inner_text(".pane"), "the video page warns that video can reveal the visitor's IP address")
        ok("camera turns on when you press Start" in await a.inner_text(".vnote") or await a.locator(".vids").is_visible(), "before Start, the camera is off and the page says so")
        ok(await a.evaluate("document.getElementById('local').srcObject === null"), "the camera has not been touched yet")
        await a.screenshot(path=SHOTS + "video-setup.png")

        # both start; both pictures must arrive
        t0 = time.time()
        await a.click(".bar .btn.go"); await b.click(".bar .btn.go")
        await playing(a); await playing(b)
        ok(True, f"both people receive the other's live picture ({time.time()-t0:.1f}s)")
        ok(await a.evaluate("document.getElementById('local').muted && document.getElementById('local').srcObject !== null"), "own preview is shown, and muted so there is no echo")
        ok(await a.evaluate("document.getElementById('remote').srcObject.getAudioTracks().length > 0"), "the other person's sound arrives too")
        ok((await a.inner_text(".vnote")).strip() == "", "the 'connecting' note disappears once connected")
        await asyncio.sleep(1.0)
        await a.screenshot(path=SHOTS + "video-call-light.png"); await b.screenshot(path=SHOTS + "video-call-dark.png")

        # text alongside
        await a.fill('input[aria-label=Message]', "can you see me?"); await a.keyboard.press("Enter")
        await b.wait_for_selector("text=can you see me?")
        ok(True, "text chat works alongside the video")

        # microphone and camera buttons
        await a.click('button:has-text("Mute mic")')
        ok(await a.evaluate("document.getElementById('local').srcObject.getAudioTracks()[0].enabled === false"), "Mute mic switches the microphone off")
        ok(await a.get_attribute('button:has-text("Unmute mic")', "aria-pressed") == "true", "the button shows it is on, and says Unmute")
        await a.click('button:has-text("Camera off")')
        ok(await a.evaluate("document.getElementById('local').srcObject.getVideoTracks()[0].enabled === false"), "Camera off switches the camera off")
        await a.click('button:has-text("Unmute mic")'); await a.click('button:has-text("Camera on")')
        ok(await a.evaluate("document.getElementById('local').srcObject.getAudioTracks()[0].enabled === true && document.getElementById('local').srcObject.getVideoTracks()[0].enabled === true"), "both can be switched back on")

        # Next: partner told, their picture cleared, own camera stays on
        track = await a.evaluate_handle("document.getElementById('local').srcObject.getVideoTracks()[0]")
        await a.click(".bar .btn.go")
        await b.wait_for_selector("text=The stranger left.")
        await b.wait_for_function("document.getElementById('remote').srcObject === null", timeout=8000)
        ok(True, "when A presses Next, B's view of A is cleared")
        ok(await track.evaluate("t => t.readyState") == "live", "A's camera stays on between chats")

        # a third person joins A's search; video connects again, fresh
        c = await open_chat(br)
        await c.click(".bar .btn.go")
        await playing(c, timeout=40000)
        await playing(a, timeout=40000)
        ok(True, "after Next, A and a new person connect with a fresh video call")

        # Stop turns the camera off for real
        track_c = await c.evaluate_handle("document.getElementById('local').srcObject.getVideoTracks()[0]")
        await c.click(".bar .btn.ghost")
        await c.wait_for_function("document.getElementById('local').srcObject === null", timeout=8000)
        ok(await track_c.evaluate("t => t.readyState") == "ended", "Stop turns the camera off for real (the browser's recording light goes out)")
        await a.wait_for_selector("text=The stranger left.")

        # text and video people never meet
        await a.click(".bar .btn.ghost")  # A stops searching
        t = await open_chat(br, path="/text"); v = await open_chat(br)
        await t.click(".bar .btn.go"); await v.click(".bar .btn.go")
        await asyncio.sleep(6)  # longer than the 4 second fallback
        ok("Looking for someone" in await status(t) and "Looking for someone" in await status(v), "a text chatter and a video chatter are never paired, even after the fallback")
        ok(await t.locator(".vids").count() == 0, "the text page has no video panel and never asked for the camera")

        # blocked camera
        denied = await br.new_context(permissions=[], extra_http_headers={"x-forwarded-for": "10.30.9.9"})
        await denied.grant_permissions([])
        d = await denied.new_page(); d.errors = []
        await d.add_init_script("navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))")
        await d.goto(B + "/video"); await d.click('button:has-text("18 or older")')
        await d.wait_for_selector(".bar .btn.go:not([disabled])")
        await d.click(".bar .btn.go")
        await d.wait_for_selector("text=needs your camera and microphone")
        ok("Ready when you are" in await status(d) and await d.locator(".bar .btn.go").is_enabled(), "a blocked camera is explained, and they can try again")
        await d.screenshot(path=SHOTS + "video-blocked.png")

        # phone layout
        m1 = await open_chat(br, vp=(375, 720)); m2 = await open_chat(br, vp=(375, 720))
        await m1.screenshot(path=SHOTS + "video-mobile-idle.png")
        await m1.click(".bar .btn.go"); await m2.click(".bar .btn.go")
        await playing(m1, timeout=40000)
        ok(await m1.evaluate("document.documentElement.scrollWidth <= innerWidth"), "phone width: no sideways scroll during a video call")
        await asyncio.sleep(1.0); await m1.screenshot(path=SHOTS + "video-mobile-call.png")

        errs = [x for pg in (a, b, c, t, v, m1, m2) for x in pg.errors]
        ok(not errs, "no script or console errors" + (": " + "; ".join(errs[:3]) if errs else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res)-sum(res)} failed")
    sys.exit(0 if all(res) else 1)

asyncio.run(main())
