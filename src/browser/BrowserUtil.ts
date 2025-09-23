import { Page } from 'rebrowser-playwright'
import { load } from 'cheerio'

import { MicrosoftRewardsBot } from '../index'


export default class BrowserUtil {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async tryDismissAllMessages(page: Page): Promise<void> {
        const buttons = [
            { selector: '#acceptButton', label: 'AcceptButton' },
            { selector: '.ext-secondary.ext-button', label: '"Skip for now" Button' },
            { selector: '#iLandingViewAction', label: 'iLandingViewAction' },
            { selector: '#iShowSkip', label: 'iShowSkip' },
            { selector: '#iNext', label: 'iNext' },
            { selector: '#iLooksGood', label: 'iLooksGood' },
            { selector: '#idSIButton9', label: 'idSIButton9' },
            { selector: '.ms-Button.ms-Button--primary', label: 'Primary Button' },
            { selector: '.c-glyph.glyph-cancel', label: 'Mobile Welcome Button' },
            { selector: '.maybe-later', label: 'Mobile Rewards App Banner' },
            { selector: '//div[@id="cookieConsentContainer"]//button[contains(text(), "Accept")]', label: 'Accept Cookie Consent Container', isXPath: true },
            { selector: '#bnp_btn_accept', label: 'Bing Cookie Banner' },
            { selector: '#reward_pivot_earn', label: 'Reward Coupon Accept' }
        ]

        // 随机化按钮点击顺序以模拟人类行为
        const shuffledButtons = this.bot.utils.shuffleArray([...buttons]);

        for (const button of shuffledButtons) {
            try {
                const element = button.isXPath ? page.locator(`xpath=${button.selector}`) : page.locator(button.selector)
                await element.first().click({ timeout: 500 })
                await this.bot.utils.waitRandom(300, 800)

                this.bot.log(this.bot.isMobile, '关闭所有消息', `已关闭: ${button.label}`)

            } catch (error) {
                // Silent fail
            }
        }
                // Handle blocking Bing privacy overlay intercepting clicks (#bnp_overlay_wrapper)
        try {
            const overlay = await page.locator('#bnp_overlay_wrapper').first()
            if (await overlay.isVisible({ timeout: 500 }).catch(()=>false)) {
                // Try common dismiss buttons inside overlay
                const rejectBtn = await page.locator('#bnp_btn_reject, button[aria-label*="Reject" i]').first()
                const acceptBtn = await page.locator('#bnp_btn_accept').first()
                if (await rejectBtn.isVisible().catch(()=>false)) {
                    await rejectBtn.click({ timeout: 500 }).catch(()=>{})
                    this.bot.log(this.bot.isMobile, 'DISMISS-ALL-MESSAGES', 'Dismissed: Bing Overlay Reject')
                } else if (await acceptBtn.isVisible().catch(()=>false)) {
                    await acceptBtn.click({ timeout: 500 }).catch(()=>{})
                    this.bot.log(this.bot.isMobile, 'DISMISS-ALL-MESSAGES', 'Dismissed: Bing Overlay Accept (fallback)')
                }
                await page.waitForTimeout(300)
            }
        } catch { /* ignore */ }
    }

    async getLatestTab(page: Page): Promise<Page> {
        try {
            await this.bot.utils.waitRandom(1000,4000)

            const browser = page.context()
            const pages = browser.pages()
            const newTab = pages[pages.length - 1]

            if (newTab) {
                return newTab
            }

            throw this.bot.log(this.bot.isMobile, '获取新标签页', '无法获取最新标签页', 'error')
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取新标签页', '发生错误:' + error, 'error')
        }
    }

    async getTabs(page: Page) {
        try {
            const browser = page.context()
            const pages = browser.pages()

            const homeTab = pages[1]
            let homeTabURL: URL

            if (!homeTab) {
                throw this.bot.log(this.bot.isMobile, '获取标签页', '未找到主页标签页!', 'error')

            } else {
                homeTabURL = new URL(homeTab.url())

                if (homeTabURL.hostname !== 'rewards.bing.com') {
                    throw this.bot.log(this.bot.isMobile, '获取标签页', '奖励页面主机名无效: ' + homeTabURL.host, 'error')
                }
            }

            const workerTab = pages[2]
            if (!workerTab) {
                throw this.bot.log(this.bot.isMobile, '获取标签页', '未找到工作标签页!', 'error')
            }

            return {
                homeTab: homeTab,
                workerTab: workerTab
            }

        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '重新加载异常页面', '发生错误:' + error, 'error')
        }
    }

    async reloadBadPage(page: Page): Promise<void> {
        try {
            const html = await page.content().catch(() => '')
            const $ = load(html)

            const isNetworkError = $('body.neterror').length

            if (isNetworkError) {
                this.bot.log(this.bot.isMobile, '重新加载异常页面', '检测到异常页面，正在重新加载!')
                await page.reload()
            }

        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '重新加载异常页面', '发生错误:' + error, 'error')
        }
    }

}