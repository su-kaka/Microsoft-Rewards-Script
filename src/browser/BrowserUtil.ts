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

        for (const button of buttons) {
            try {
                const element = button.isXPath ? page.locator(`xpath=${button.selector}`) : page.locator(button.selector)
                await element.first().click({ timeout: 500 })
                await page.waitForTimeout(500)

                this.bot.log(this.bot.isMobile, '关闭所有消息', `已关闭: ${button.label}`)

            } catch (error) {
                // Silent fail
            }
        }
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