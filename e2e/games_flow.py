"""
End-to-end test of games with two real browsers and the real server: the menu with a picture and name for
every game, asking, saying no, tic-tac-toe, Connect 4, rock paper scissors, trivia, would you rather, two
truths and a lie (both ways round), leaving a game, a game in a video chat, and the limit on how often
someone can be invited. Takes screenshots in e2e/shots.

Use a THROWAWAY database (npm run db:e2e). Needs Python with Playwright.

  BASE_URL=http://localhost:5200 python e2e/games_flow.py
"""
import asyncio, os, random, sys
from playwright.async_api import async_playwright

B = os.environ.get("BASE_URL", "http://localhost:5200")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots") + os.sep
os.makedirs(SHOTS, exist_ok=True)
res = []
def ok(c, n): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n, flush=True)

RUN = random.randint(10, 250)
N = [0]
ERRORS = []
FAKE_CAMERA = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]


async def person(br, path, scheme="light", vp=(1280, 800)):
    N[0] += 1
    ctx = await br.new_context(color_scheme=scheme, viewport={"width": vp[0], "height": vp[1]},
                               permissions=["camera", "microphone"],
                               extra_http_headers={"x-forwarded-for": f"10.50.{RUN}.{N[0]}"})
    await ctx.add_init_script("localStorage.setItem('pb_adult','true')")
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: ERRORS.append(str(e)))
    pg.on("console", lambda m: ERRORS.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text else None)
    await pg.goto(B + path)
    await pg.wait_for_selector(".bar .btn.go:not([disabled])")
    return pg


async def matched(a, b):
    await a.click(".bar .btn.go"); await b.click(".bar .btn.go")
    for pg in (a, b):
        await pg.wait_for_function("document.getElementById('status').innerText.includes('talking to a stranger')", timeout=20000)


async def invite(pg, name):
    await pg.click("button.gamebtn")
    await pg.click(f".game-pick:has-text('{name}')")


def text(pg, sel=".game"):
    return pg.inner_text(sel)


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(args=FAKE_CAMERA)
        a = await person(br, "/text")
        b = await person(br, "/text", scheme="dark")
        ok(await a.locator("button.gamebtn").count() == 0, "no Games button before a chat starts")
        await matched(a, b)
        ok(await a.locator("button.gamebtn").count() == 1 and await b.locator("button.gamebtn").count() == 1, "both people get a Games button once matched")

        # ---- the list, an invitation, and a no ----
        await a.click("button.gamebtn")
        names = await a.locator(".game-pick strong").all_inner_texts()
        ok(names == ["Would you rather", "Rock paper scissors", "Tic-tac-toe", "Connect 4", "Trivia", "Two truths and a lie"], f"six games are offered: {names}")
        await a.screenshot(path=SHOTS + "games-menu.png")
        await a.click(".game-pick:has-text('Tic-tac-toe')")
        await b.wait_for_selector(".game:has-text('wants to play Tic-tac-toe')")
        ok("Waiting for the stranger" in await text(a), "the inviter sees that they are waiting")
        await b.screenshot(path=SHOTS + "games-invite.png")
        await b.click(".game button:has-text('No thanks')")
        await a.wait_for_selector(".game:has-text('said no thanks')")
        ok(True, "a no is shown to the inviter")
        await a.click(".game button:has-text('OK')")

        # ---- tic-tac-toe to a win ----
        await a.wait_for_timeout(15500)  # invitations are spaced out
        await invite(a, "Tic-tac-toe")
        await b.wait_for_selector(".game button:has-text('Play')")
        await b.click(".game button:has-text('Play')")
        await a.wait_for_selector(".ttt")
        await b.wait_for_selector(".ttt")
        ok(True, "the board appears for both once accepted")
        # whoever's turn it is plays the top row for the inviter (X) and the middle row for the other (O)
        async def turn():
            for pg, name in ((a, "a"), (b, "b")):
                if "Your turn" in await text(pg):
                    return pg, name
            return None, None
        plan = {"a": [0, 1, 2], "b": [3, 4, 5]}
        done = {"a": 0, "b": 0}
        for _ in range(8):
            pg, who = await turn()
            if pg is None:
                await a.wait_for_timeout(150)
                continue
            if "Tic-tac-toe:" in await text(pg, "[role=log]"):
                break
            if done[who] >= 3:
                break
            cell = plan[who][done[who]]
            await pg.click(f".ttt-cell >> nth={cell}")
            done[who] += 1
            await a.wait_for_timeout(250)
            if await a.locator(".ttt-cell.win").count():
                break
        await a.wait_for_selector(".ttt-cell.win", timeout=8000)
        await a.screenshot(path=SHOTS + "games-ttt-win.png")
        for pg in (a, b):  # the other browser hears a moment later
            try: await pg.wait_for_function("() => /Tic-tac-toe: (You|They) won/.test(document.querySelector('[role=log]').innerText)", timeout=5000)
            except Exception: pass
        ra, rb = await text(a, "[role=log]"), await text(b, "[role=log]")
        ok(("Tic-tac-toe: You won." in ra and "Tic-tac-toe: They won." in rb) or ("Tic-tac-toe: They won." in ra and "Tic-tac-toe: You won." in rb), "the winner and the loser are each told, in the conversation (whoever moved first)")
        await a.click(".game button:has-text('Close')"); await b.click(".game button:has-text('Close')")

        # ---- rock paper scissors ----
        await a.wait_for_timeout(15500)
        await invite(b, "Rock paper scissors")  # the other person asks this time
        await a.click(".game button:has-text('Play')")
        for r in range(2):
            await a.click("button[aria-label=Paper]")
            await b.click("button[aria-label=Rock]")
            await a.wait_for_selector(".game-note:has-text('You win this round')")
            await b.wait_for_selector(".game-note:has-text('They win this round')")
            if r == 0:
                await a.screenshot(path=SHOTS + "games-rps.png")
                await a.wait_for_selector("button[aria-label=Paper]:not([disabled])", timeout=6000)
        await a.wait_for_selector(".game-result:has-text('You won, 2 to 0')", timeout=8000)
        await b.wait_for_selector(".game-result:has-text('They won, 0 to 2')", timeout=8000)
        ok(True, "rock paper scissors ends at two wins with the right result for each")
        await a.click(".game button:has-text('Close')"); await b.click(".game button:has-text('Close')")

        # ---- the menu shows a picture and a name for every game ----
        await a.wait_for_timeout(15500)
        await a.click("button.gamebtn")
        tiles = await a.locator(".game-pick").count()
        arts = await a.locator(".game-pick .game-art svg").count()
        names = await a.locator(".game-pick strong").all_inner_texts()
        ok(tiles == 6 and arts == 6, f"all six games have a picture and a name: {names}")
        await a.screenshot(path=SHOTS + "games-menu-six.png")

        # ---- connect 4 to a win ----
        await a.click(".game-pick:has-text('Connect 4')")
        await b.click(".game button:has-text('Play')")
        await a.wait_for_selector(".c4"); await b.wait_for_selector(".c4")
        for _ in range(16):
            if await a.locator(".c4-cell.win").count():
                break
            for pg, col in ((a, 0), (b, 1)):
                if "Your turn" in await text(pg):
                    await pg.click(f"button[aria-label='Drop a disc in column {col + 1}']")
                    break
            await a.wait_for_timeout(200)
        await a.wait_for_selector(".c4-cell.win", timeout=8000)
        await a.screenshot(path=SHOTS + "games-c4-win.png")
        for pg in (a, b):
            try: await pg.wait_for_function("() => /Connect 4: (You|They) won/.test(document.querySelector('[role=log]').innerText)", timeout=5000)
            except Exception: pass
        la, lb = await text(a, "[role=log]"), await text(b, "[role=log]")
        ok(("Connect 4: You won." in la and "Connect 4: They won." in lb) or ("Connect 4: They won." in la and "Connect 4: You won." in lb), "connect 4 finds four in a column and tells each person the result")
        await a.click(".game button:has-text('Close')"); await b.click(".game button:has-text('Close')")

        # ---- trivia ----
        await a.wait_for_timeout(15500)
        await invite(b, "Trivia")
        await a.click(".game button:has-text('Play')")
        await a.wait_for_selector(".trivia-opt"); await b.wait_for_selector(".trivia-opt")
        qa, qb = await text(a, ".trivia-q"), await text(b, ".trivia-q")
        ok(qa == qb and bool(qa), f"both get the same trivia question: {qa}")
        await a.locator(".trivia-opt").nth(0).click()
        await b.locator(".trivia-opt").nth(1).click()
        await a.wait_for_selector(".trivia-opt.right"); await b.wait_for_selector(".trivia-opt.right")
        await a.screenshot(path=SHOTS + "games-trivia.png")
        ok(True, "the right answer is shown to both once both have answered")
        await a.click(".game button:has-text('Leave game')")
        await b.click(".game button:has-text('OK')")

        # ---- two truths and a lie, both ways round ----
        await a.wait_for_timeout(15500)
        await invite(a, "Two truths and a lie")
        await b.click(".game button:has-text('Play')")
        await a.wait_for_selector("input[aria-label='Statement 1']")
        await b.wait_for_selector("text=writing three statements")
        lines = ["I have a twin", "I have been to Japan", "I can juggle"]
        for i, t in enumerate(lines):
            await a.fill(f"input[aria-label='Statement {i + 1}']", t)
        await a.check("input[aria-label='Statement 3 is the lie']")
        await a.screenshot(path=SHOTS + "games-ttl-write.png")
        await a.click("button:has-text('Send to the stranger')")
        await b.wait_for_selector(".lies-opt")
        shown = sorted(await b.locator(".lies-opt").all_inner_texts())
        ok(shown == sorted(lines), f"the guesser sees the three statements: {shown}")
        await b.screenshot(path=SHOTS + "games-ttl-guess.png")
        # the guesser picks whichever statement is 'I can juggle', so the guess is right
        idx = [t.strip() for t in await b.locator(".lies-opt").all_inner_texts()].index("I can juggle")
        await b.locator(".lies-opt").nth(idx).click()
        await b.wait_for_selector("text=You spotted the lie")
        await a.wait_for_selector("text=They spotted your lie")
        ok(True, "the guess is checked, and each person is told the outcome")
        # round two: the other person writes
        await b.wait_for_selector("input[aria-label='Statement 1']", timeout=8000)
        await a.wait_for_selector("text=writing three statements")
        for i, t in enumerate(["I like tea", "I like coffee", "I have a boat"]):
            await b.fill(f"input[aria-label='Statement {i + 1}']", t)
        await b.check("input[aria-label='Statement 1 is the lie']")
        await b.click("button:has-text('Send to the stranger')")
        await a.wait_for_selector(".lies-opt")
        await a.locator(".lies-opt").nth(0).click()  # a guess
        await a.wait_for_selector(".game-result", timeout=10000)
        await b.wait_for_selector(".game-result", timeout=10000)
        ra, rb = await text(a, "[role=log]"), await text(b, "[role=log]")
        ok("Two truths and a lie: you" in ra and "Two truths and a lie: you" in rb, "both are told how it went at the end")
        await a.click(".game button:has-text('Close')"); await b.click(".game button:has-text('Close')")

        # ---- would you rather, and leaving ----
        await a.wait_for_timeout(15500)
        await invite(a, "Would you rather")
        await b.click(".game button:has-text('Play')")
        await a.wait_for_selector(".wyr-opt"); await b.wait_for_selector(".wyr-opt")
        qa = await a.locator(".wyr-opt").all_inner_texts()
        qb = await b.locator(".wyr-opt").all_inner_texts()
        ok(qa == qb, f"both get the same question: {qa}")
        await a.locator(".wyr-opt").nth(0).click()
        await b.locator(".wyr-opt").nth(1).click()
        await a.wait_for_selector(".game-note:has-text('they picked')")
        await a.screenshot(path=SHOTS + "games-wyr.png")
        ok("you picked" in (await text(a, ".game-note")).lower() and "round 1" in (await text(a)).lower(), "each sees what the other picked")
        await a.click(".game button:has-text('Leave game')")
        await b.wait_for_selector(".game:has-text('left the game')")
        ok(True, "leaving a game tells the other person")
        await b.click(".game button:has-text('OK')")

        # ---- asking too often ----
        await invite(a, "Would you rather")  # inside the 15 second gap since the last invitation
        await a.wait_for_selector(".game:has-text('Waiting for the stranger')")
        await b.wait_for_timeout(1200)
        ok(await b.locator(".game:has-text('wants to play')").count() == 0, "an invitation sent too soon is not delivered")
        await a.click(".game button[aria-label='Cancel']")

        # ---- the chat ending clears the game ----
        await a.wait_for_timeout(15500)
        await invite(a, "Tic-tac-toe")
        await b.click(".game button:has-text('Play')")
        await a.wait_for_selector(".ttt")
        await a.click(".bar .btn.go")  # Skip
        await b.wait_for_function("document.getElementById('status').innerText.includes('left') || document.getElementById('status').innerText.includes('Press')", timeout=10000)
        ok(await b.locator(".ttt").count() == 0, "a game does not survive the chat it was in")
        await a.context.close(); await b.context.close()

        # ---- in a video chat, and on a phone ----
        v1 = await person(br, "/video", vp=(390, 844))
        v2 = await person(br, "/video", scheme="dark", vp=(390, 844))
        await matched(v1, v2)
        await v1.click("button.gamebtn")
        await v1.screenshot(path=SHOTS + "games-video-menu-mobile.png")
        await v1.click(".game-pick:has-text('Tic-tac-toe')")
        await v2.click(".game button:has-text('Play')")
        await v1.wait_for_selector(".ttt"); await v2.wait_for_selector(".ttt")
        await v2.screenshot(path=SHOTS + "games-video-mobile.png")
        ok(await v1.evaluate("document.documentElement.scrollWidth <= innerWidth"), "a game in a phone-sized video chat causes no sideways scroll")
        ok(True, "games work in a video chat")
        await v1.context.close(); await v2.context.close()

        ok(not ERRORS, "no script or console errors" + (": " + "; ".join(ERRORS[:3]) if ERRORS else ""))
        await br.close()
    print(f"\n{sum(res)} passed, {len(res) - sum(res)} failed")
    sys.exit(0 if all(res) else 1)


asyncio.run(main())
