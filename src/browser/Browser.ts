import playwright, { BrowserContext } from 'rebrowser-playwright'

import { newInjectedContext } from 'fingerprint-injector'
import { FingerprintGenerator } from 'fingerprint-generator'

import { MicrosoftRewardsBot } from '../index'
import { loadSessionData, saveFingerprintData } from '../util/Load'
import { updateFingerprintUserAgent } from '../util/UserAgent'

import { AccountProxy } from '../interface/Account'

/* Test Stuff
https://abrahamjuliot.github.io/creepjs/
https://botcheck.luminati.io/
https://fv.pro/
https://pixelscan.net/
https://www.browserscan.net/
*/

class Browser {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async createBrowser(proxy: AccountProxy, email: string): Promise<BrowserContext> {
        let browser: playwright.Browser
        try {
            // FORCE_HEADLESS env takes precedence (used in Docker with headless shell only)
            const envForceHeadless = process.env.FORCE_HEADLESS === '1'
            // Support legacy config.headless OR nested config.browser.headless
            const legacyHeadless = (this.bot.config as { headless?: boolean }).headless
            const nestedHeadless = (this.bot.config.browser as { headless?: boolean } | undefined)?.headless
            const headlessValue = envForceHeadless ? true : (legacyHeadless ?? nestedHeadless ?? false)
            const headless: boolean = Boolean(headlessValue)

            const engineName = 'chromium' // 当前硬编码的引擎
            this.bot.log(this.bot.isMobile, 'BROWSER', `启动 ${engineName} (headless=${headless})`) // 明确的引擎日志
            browser = await playwright.chromium.launch({
                // Optional: uncomment to use Edge instead of Chromium
                // channel: 'msedge',
                headless,
                ...(proxy.url && { proxy: { username: proxy.username, password: proxy.password, server: `${proxy.url}:${proxy.port}` } }),
                args: [
                    '--no-sandbox',
                    '--mute-audio',
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                    '--ignore-ssl-errors',
                    '--disable-quic',
                ]
            })
        } catch (e: unknown) {
            const msg = (e instanceof Error ? e.message : String(e))
            // 常见的浏览器可执行文件缺失指导
            if (/Executable doesn't exist/i.test(msg)) {
                this.bot.log(this.bot.isMobile, 'BROWSER', 'Playwright未安装Chromium。运行"npm run pre-build"来安装所有依赖项（或设置AUTO_INSTALL_BROWSERS=1以自动尝试）。', 'error')
            } else {
                this.bot.log(this.bot.isMobile, 'BROWSER', '启动浏览器失败: ' + msg, 'error')
            }
            throw e
        }

    // “解析来自旧根目录的 saveFingerprint 或新的 fingerprinting.saveFingerprint”
    const legacyFp = (this.bot.config as { saveFingerprint?: { mobile: boolean; desktop: boolean } }).saveFingerprint
    const nestedFp = (this.bot.config.fingerprinting as { saveFingerprint?: { mobile: boolean; desktop: boolean } } | undefined)?.saveFingerprint
    const saveFingerprint = legacyFp || nestedFp || { mobile: false, desktop: false }

        const sessionData = await loadSessionData(this.bot.config.sessionPath, email, this.bot.isMobile, saveFingerprint)

        const fingerprint = sessionData.fingerprint ? sessionData.fingerprint : await this.generateFingerprint()

        const context = await newInjectedContext(browser as unknown as import('playwright').Browser, { fingerprint: fingerprint })

        // Set timeout to preferred amount (supports legacy globalTimeout or browser.globalTimeout)
        const legacyTimeout = (this.bot.config as { globalTimeout?: number | string }).globalTimeout
        const nestedTimeout = (this.bot.config.browser as { globalTimeout?: number | string } | undefined)?.globalTimeout
        const globalTimeout = legacyTimeout ?? nestedTimeout ?? 30000
        context.setDefaultTimeout(this.bot.utils.stringToMs(globalTimeout))

        // Normalize viewport and page rendering so content fits typical screens
        try {
            const desktopViewport = { width: 1280, height: 800 }
            const mobileViewport = { width: 390, height: 844 }

            context.on('page', async (page) => {
                try {
                    // Set a reasonable viewport size depending on device type
                    if (this.bot.isMobile) {
                        await page.setViewportSize(mobileViewport)
                    } else {
                        await page.setViewportSize(desktopViewport)
                    }

                    // Inject a tiny CSS to avoid gigantic scaling on some environments
                    await page.addInitScript(() => {
                        try {
                            const style = document.createElement('style')
                            style.id = '__mrs_fit_style'
                            style.textContent = `
                              html, body { overscroll-behavior: contain; }
                              /* Mild downscale to keep content within window on very large DPI */
                              @media (min-width: 1000px) {
                                html { zoom: 0.9 !important; }
                              }
                            `
                            document.documentElement.appendChild(style)
                        } catch { /* ignore */ }
                    })
                } catch { /* ignore */ }
            })
        } catch { /* ignore */ }

        await context.addCookies(sessionData.cookies)

        // Persist fingerprint when feature is configured
        if (saveFingerprint.mobile || saveFingerprint.desktop) {
            await saveFingerprintData(this.bot.config.sessionPath, email, this.bot.isMobile, fingerprint)
        }

        this.bot.log(this.bot.isMobile, '浏览器', `已创建浏览器，用户代理User-Agent: "${fingerprint.fingerprint.navigator.userAgent}"`)

        return context as BrowserContext
    }

    async generateFingerprint() {
        const fingerPrintData = new FingerprintGenerator().getFingerprint({
            devices: this.bot.isMobile ? ['mobile'] : ['desktop'],
            operatingSystems: this.bot.isMobile ? ['android'] : ['windows'],
            browsers: [{ name: 'edge' }]
        })

        const updatedFingerPrintData = await updateFingerprintUserAgent(fingerPrintData, this.bot.isMobile)

        return updatedFingerPrintData
    }
}

export default Browser