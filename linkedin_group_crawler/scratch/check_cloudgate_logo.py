import asyncio
import sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding="utf-8")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.goto("http://localhost:3021/auth/login")
        await page.wait_for_timeout(2000)
        await page.screenshot(path="scratch/cloudgate_login_check.png")
        title = await page.title()
        print("page title:", title)
        await browser.close()


asyncio.run(main())
