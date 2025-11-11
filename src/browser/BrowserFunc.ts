import { BrowserContext, Page } from 'rebrowser-playwright'
import { CheerioAPI, load } from 'cheerio'
import { AxiosRequestConfig } from 'axios'

import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'
import { TIMEOUTS, RETRY_LIMITS, SELECTORS, URLS } from '../constants'

import { Counters, DashboardData, MorePromotion, PromotionalItem } from '../interface/DashboardData'
import { QuizData } from '../interface/QuizData'
import { AppUserData } from '../interface/AppUserData'
import { EarnablePoints } from '../interface/Points'


export default class BrowserFunc {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }


    /**
     * Navigate the provided page to rewards homepage
     * @param {Page} page Playwright page
    */
    async goHome(page: Page) {
        const navigateHome = async () => {
            try {
                await page.goto(this.bot.config.baseURL, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                })
            } catch (e: any) {
                if (typeof e?.message === 'string' && e.message.includes('ERR_ABORTED')) {
                    this.bot.log(this.bot.isMobile, 'GO-HOME', 'Navigation aborted, retrying...', 'warn')
                    await this.bot.utils.wait(1500)
                    await page.goto(this.bot.config.baseURL, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    })
                } else {
                    throw e
                }
            }
        }

        try {
            const dashboardURL = new URL(this.bot.config.baseURL)

            if (new URL(page.url()).hostname !== dashboardURL.hostname) {
                await navigateHome()
            }

            let success = false

            for (let iteration = 1; iteration <= RETRY_LIMITS.GO_HOME_MAX; iteration++) {
                await this.bot.utils.wait(TIMEOUTS.LONG)
                await this.bot.browser.utils.tryDismissAllMessages(page)

                try {
                    await page.waitForSelector(SELECTORS.MORE_ACTIVITIES, { timeout: 1000 })
                    this.bot.log(this.bot.isMobile, 'GO-HOME', '成功访问主页')
                    success = true

                    break
                } catch {
                    const suspendedByHeader = await page
                        .waitForSelector(SELECTORS.SUSPENDED_ACCOUNT, { state: 'visible', timeout: 500 })
                        .then(() => true)
                        .catch(() => false)

                    if (suspendedByHeader) {
                        this.bot.log(this.bot.isMobile, 'GO-HOME', `通过标题选择器检测到账户暂停 (迭代 ${iteration})`, 'error')
                        throw new Error('Account has been suspended!')
                    }

                    try {
                        const mainContent =
                            (await page
                                .locator('#contentContainer, #main, .main-content')
                                .first()
                                .textContent({ timeout: 500 })
                                .catch(() => '')) || ''

                        const suspensionPatterns = [
                            /account\s+has\s+been\s+suspended/i,
                            /suspended\s+due\s+to\s+unusual\s+activity/i,
                            /your\s+account\s+is\s+temporarily\s+suspended/i
                        ]

                        const isSuspended = suspensionPatterns.some((p) => p.test(mainContent))
                        if (isSuspended) {
                            this.bot.log(this.bot.isMobile, 'GO-HOME', `通过内容文本检测到账户暂停 (迭代 ${iteration})`, 'error')
                            throw new Error('账户已被暂停！')
                        }
                    } catch (e) {
                        // 忽略文本检查中的错误 - 不关键
                        this.bot.log(this.bot.isMobile, 'GO-HOME', `跳过暂停文本检查: ${e instanceof Error ? e.message : String(e)}`, 'warn')
                    }

                    const currentURL = new URL(page.url())
                    if (currentURL.hostname !== dashboardURL.hostname) {
                        await this.bot.browser.utils.tryDismissAllMessages(page)
                        await this.bot.utils.waitRandom(2000,5000, 'normal')
                        try {
                            await navigateHome()
                        } catch (e: any) {
                            if (typeof e?.message === 'string' && e.message.includes('ERR_ABORTED')) {
                                this.bot.log(this.bot.isMobile, 'GO-HOME', '导航再次中止；继续进行...', 'warn')
                            } else {
                                throw e
                            }
                        }
                    } else {
                        this.bot.log(
                            this.bot.isMobile,
                            'GO-HOME',
                            `Activities not found yet (iteration ${iteration}/${RETRY_LIMITS.GO_HOME_MAX}), retrying...`,
                            'warn'
                        )
                    }
                }
                const backoff = Math.min(TIMEOUTS.VERY_LONG, 1000 + iteration * 500)
                await this.bot.utils.wait(backoff)
            }

            if (!success) {
                throw new Error('Failed to reach homepage or find activities within retry limit')
            }
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '返回主页', '发生错误:' +  (error instanceof Error ? ` ${error.message}` : ` ${String(error)}`), 'error')
        }
    }


    /**
     * Fetch user dashboard data
     * @returns {DashboardData} Object of user bing rewards dashboard data
    */
    async getDashboardData(page?: Page): Promise<DashboardData> {
        const target = page ?? this.bot.homePage
        const dashboardURL = new URL(this.bot.config.baseURL)
        const currentURL = new URL(target.url())

        try {
            // Should never happen since tasks are opened in a new tab!
            if (currentURL.hostname !== dashboardURL.hostname) {
                this.bot.log(this.bot.isMobile, 'DASHBOARD-DATA', '提供的页面不是仪表盘页面，正在重定向到仪表盘页面')
                await this.goHome(target)
            }
            let lastError: unknown = null
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    // Reload the page to get new data
                    await target.reload({ waitUntil: 'domcontentloaded' })
                    lastError = null
                    break
                } catch (re) {
                    lastError = re
                    const msg = (re instanceof Error ? re.message : String(re))
                    this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', `重载失败尝试 ${attempt}: ${msg}`, 'warn')
                    // If page/context closed => bail early after first retry
                    if (msg.includes('has been closed')) {
                        if (attempt === 1) {
                            this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', '页面似乎已关闭；尝试一次导航回退', 'warn')
                            try {
                                await this.goHome(target)
                            } catch {/* ignore */ }
                        } else {
                            break
                        }
                    }
                    if (attempt === 2 && lastError) throw lastError
                    await this.bot.utils.wait(1000)
                }
            }

            // Wait a bit longer for scripts to load, especially on mobile
            await this.bot.utils.wait(this.bot.isMobile ? TIMEOUTS.LONG : TIMEOUTS.MEDIUM)

            // Wait for the more-activities element to ensure page is fully loaded
            await target.waitForSelector(SELECTORS.MORE_ACTIVITIES, { timeout: TIMEOUTS.DASHBOARD_WAIT }).catch(() => {
                this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', '未找到活动元素，仍然继续', 'warn')
            })

            let scriptContent = await target.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script'))
                const targetScript = scripts.find(script => script.innerText.includes('var dashboard'))

                return targetScript?.innerText ? targetScript.innerText : null
            })

            if (!scriptContent) {
                this.bot.log(this.bot.isMobile, '获取仪表盘数据', '首次尝试未找到仪表盘脚本，正在尝试恢复。', 'warn')
                
                // 在硬失败之前强制导航重试一次
                try {
                    await this.goHome(target)
                    await target.waitForLoadState('domcontentloaded', { timeout: TIMEOUTS.VERY_LONG }).catch((e) => {
                        this.bot.log(this.bot.isMobile, '获取仪表盘数据', `等待加载状态失败: ${e}`, 'warn')
                    })
                    await this.bot.utils.wait(this.bot.isMobile ? TIMEOUTS.LONG : TIMEOUTS.MEDIUM)
                } catch (e) {
                    this.bot.log(this.bot.isMobile, '获取仪表盘数据', `导航重试失败: ${e}`, 'warn')
                }

                const retryContent = await target.evaluate(() => {
                    const scripts = Array.from(document.querySelectorAll('script'))
                    const targetScript = scripts.find(script => script.innerText.includes('var dashboard'))
                    return targetScript?.innerText ? targetScript.innerText : null
                }).catch(() => null)

                if (!retryContent) {
                    // 记录额外的调试信息
                    const scriptsDebug = await target.evaluate(() => {
                        const scripts = Array.from(document.querySelectorAll('script'))
                        return scripts.map(s => s.innerText.substring(0, 100)).join(' | ')
                    }).catch(() => '无法获取脚本调试信息')
                    
                    this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', `可用脚本预览: ${scriptsDebug}`, 'warn')
                    throw this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', '在脚本中未找到仪表盘数据', 'error')
                }
                scriptContent = retryContent
            }

            // Extract the dashboard object from the script content
            const dashboardData = await target.evaluate((scriptContent: string) => {
                // Try multiple regex patterns for better compatibility
                const patterns = [
                    /var dashboard = (\{.*?\});/s,           // Original pattern
                    /var dashboard=(\{.*?\});/s,             // No spaces
                    /var\s+dashboard\s*=\s*(\{.*?\});/s,     // Flexible whitespace
                    /dashboard\s*=\s*(\{[\s\S]*?\});/        // More permissive
                ]

                for (const regex of patterns) {
                    const match = regex.exec(scriptContent)
                    if (match && match[1]) {
                        try {
                            return JSON.parse(match[1])
                        } catch (e) {
                            // Try next pattern if JSON parsing fails
                            continue
                        }
                    }
                }

                return null

            }, scriptContent)

            if (!dashboardData) {
                // 记录脚本内容片段用于调试
                const scriptPreview = scriptContent.substring(0, 200)
                this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', `脚本预览: ${scriptPreview}`, 'warn')
                throw this.bot.log(this.bot.isMobile, 'GET-DASHBOARD-DATA', '无法解析仪表盘脚本', 'error')
            }

            return dashboardData

        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取仪表盘数据', `获取仪表盘数据时出错: ${error}`, 'error')
        }

    }

    /**
     * Get search point counters
     * @returns {Counters} Object of search counter data
    */
    async getSearchPoints(): Promise<Counters> {
        const dashboardData = await this.getDashboardData() // Always fetch newest data

        return dashboardData.userStatus.counters
    }

    /**
     * Get total earnable points with web browser
     * @returns {number} Total earnable points
    */
    async getBrowserEarnablePoints(): Promise<EarnablePoints> {
        try {
            let desktopSearchPoints = 0
            let mobileSearchPoints = 0
            let dailySetPoints = 0
            let morePromotionsPoints = 0

            const data = await this.getDashboardData()

            // Desktop Search Points
            if (data.userStatus.counters.pcSearch?.length) {
                data.userStatus.counters.pcSearch.forEach(x => desktopSearchPoints += (x.pointProgressMax - x.pointProgress))
            }

            // Mobile Search Points
            if (data.userStatus.counters.mobileSearch?.length) {
                data.userStatus.counters.mobileSearch.forEach(x => mobileSearchPoints += (x.pointProgressMax - x.pointProgress))
            }

            // Daily Set
            data.dailySetPromotions[this.bot.utils.getFormattedDate()]?.forEach(x => dailySetPoints += (x.pointProgressMax - x.pointProgress))

            // More Promotions
            if (data.morePromotions?.length) {
                data.morePromotions.forEach(x => {
                    // Only count points from supported activities
                    if (['quiz', 'urlreward'].includes(x.promotionType) && x.exclusiveLockedFeatureStatus !== 'locked') {
                        morePromotionsPoints += (x.pointProgressMax - x.pointProgress)
                    }
                })
            }

            const totalEarnablePoints = desktopSearchPoints + mobileSearchPoints + dailySetPoints + morePromotionsPoints

            return {
                dailySetPoints,
                morePromotionsPoints,
                desktopSearchPoints,
                mobileSearchPoints,
                totalEarnablePoints
            }
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取浏览器可赚积分', '发生错误:' + error, 'error')
        }
    }

    /**
     * Get total earnable points with mobile app
     * @returns {number} Total earnable points
    */
    async getAppEarnablePoints(accessToken: string) {
        try {
            const points = {
                readToEarn: 0,
                checkIn: 0,
                totalEarnablePoints: 0
            }

            const eligibleOffers = [
                'ENUS_readarticle3_30points',
                'Gamification_Sapphire_DailyCheckIn'
            ]

            const data = await this.getDashboardData()
            // Guard against missing profile/attributes and undefined settings
            let geoLocale = data?.userProfile?.attributes?.country || 'CN'
            const useGeo = !!(this.bot?.config?.searchSettings?.useGeoLocaleQueries)
            geoLocale = (useGeo && typeof geoLocale === 'string' && geoLocale.length === 2)
                ? geoLocale.toLowerCase()
                : 'cn'

            const userDataRequest: AxiosRequestConfig = {
                url: URLS.APP_USER_DATA,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'X-Rewards-Country': geoLocale,
                    'X-Rewards-Language': 'en'
                }
            }

            const userDataResponse: AppUserData = (await this.bot.axios.request(userDataRequest)).data
            const userData = userDataResponse.response
            const eligibleActivities = userData.promotions.filter((x) => eligibleOffers.includes(x.attributes.offerid ?? ''))

            for (const item of eligibleActivities) {
                if (item.attributes.type === 'msnreadearn') {
                    points.readToEarn = parseInt(item.attributes.pointmax ?? '') - parseInt(item.attributes.pointprogress ?? '')
                    break
                } else if (item.attributes.type === 'checkin') {
                    const checkInDay = parseInt(item.attributes.progress ?? '') % 7

                    if (checkInDay < 6 && (new Date()).getDate() != (new Date(item.attributes.last_updated ?? '')).getDate()) {
                        points.checkIn = parseInt(item.attributes['day_' + (checkInDay + 1) + '_points'] ?? '')
                    }
                    break
                }
            }

            points.totalEarnablePoints = points.readToEarn + points.checkIn

            return points
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取应用可赚积分', '发生错误:' + error, 'error')
        }
    }

    /**
     * Get current point amount
     * @returns {number} Current total point amount
    */
    async getCurrentPoints(): Promise<number> {
        try {
            const data = await this.getDashboardData()

            return data.userStatus.availablePoints
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '获取当前积分', '发生错误:' + error, 'error')
        }
    }

    /**
     * Parse quiz data from provided page
     * @param {Page} page Playwright page
     * @returns {QuizData} Quiz data object
    */
    async getQuizData(page: Page): Promise<QuizData> {
        try {
            // Wait for page to be fully loaded
            await page.waitForLoadState('domcontentloaded')
            await this.bot.utils.wait(TIMEOUTS.MEDIUM)

            const html = await page.content()
            const $ = load(html)

            // Try multiple possible variable names
            const possibleVariables = [
                '_w.rewardsQuizRenderInfo',
                'rewardsQuizRenderInfo',
                '_w.quizRenderInfo',
                'quizRenderInfo'
            ]

            let scriptContent = ''
            let foundVariable = ''

            for (const varName of possibleVariables) {
                scriptContent = $('script')
                    .toArray()
                    .map(el => $(el).text())
                    .find(t => t.includes(varName)) || ''

                if (scriptContent) {
                    foundVariable = varName
                    break
                }
            }

            if (scriptContent && foundVariable) {
                // 为正则表达式转义变量名中的点
                const escapedVar = foundVariable.replace(/\./g, '\\.')
                const regex = new RegExp(`${escapedVar}\\s*=\\s*({.*?});`, 's')
                const match = regex.exec(scriptContent)

                if (match && match[1]) {
                    const quizData = JSON.parse(match[1])
                    this.bot.log(this.bot.isMobile, 'GET-QUIZ-DATA', `使用变量找到测验数据: ${foundVariable}`, 'log')
                    return quizData
                } else {
                    throw this.bot.log(this.bot.isMobile, 'GET-QUIZ-DATA', `找到变量 ${foundVariable} 但无法提取JSON数据`, 'error')
                }
            } else {
                // Log available scripts for debugging
                const allScripts = $('script')
                    .toArray()
                    .map(el => $(el).text())
                    .filter(t => t.length > 0)
                    .map(t => t.substring(0, 100))
                
                this.bot.log(this.bot.isMobile, 'GET-QUIZ-DATA', `未找到脚本。尝试的变量: ${possibleVariables.join(', ')}`, 'error')
                this.bot.log(this.bot.isMobile, 'GET-QUIZ-DATA', `在页面上找到 ${allScripts.length} 个脚本`, 'warn')
                
                throw this.bot.log(this.bot.isMobile, 'GET-QUIZ-DATA', '包含测验数据的脚本未找到', 'error')
            }

        } catch (error) {
            throw this.bot.log(this.bot.isMobile, 'GET-QUIZ-DATA', '发生错误: ' + error, 'error')
        }

    }

    async waitForQuizRefresh(page: Page): Promise<boolean> {
        try {
            await page.waitForSelector(SELECTORS.QUIZ_CREDITS, { state: 'visible', timeout: TIMEOUTS.DASHBOARD_WAIT })
            await this.bot.utils.wait(TIMEOUTS.MEDIUM_LONG)

            return true
        } catch (error) {
            this.bot.log(this.bot.isMobile, '测验刷新', '发生错误:' + error, 'error')
            return false
        }
    }

    async checkQuizCompleted(page: Page): Promise<boolean> {
        try {
            await page.waitForSelector(SELECTORS.QUIZ_COMPLETE, { state: 'visible', timeout: TIMEOUTS.MEDIUM_LONG })
            await this.bot.utils.wait(TIMEOUTS.MEDIUM_LONG)

            return true
        } catch (error) {
            return false
        }
    }

    async loadInCheerio(page: Page): Promise<CheerioAPI> {
        const html = await page.content()
        const $ = load(html)

        return $
    }

    async getPunchCardActivity(page: Page, activity: PromotionalItem | MorePromotion): Promise<string> {
        let selector = ''
        try {
            const html = await page.content()
            const $ = load(html)

            const element = $('.offer-cta').toArray().find((x: unknown) => {
                const el = x as { attribs?: { href?: string } }
                return !!el.attribs?.href?.includes(activity.offerId)
            })
            if (element) {
                selector = `a[href*="${element.attribs.href}"]`
            }
        } catch (error) {
            this.bot.log(this.bot.isMobile, '获取打卡活动', '发生错误:' + error, 'error')
        }

        return selector
    }

    async closeBrowser(browser: BrowserContext, email: string) {
        try {
            // Save cookies
            await saveSessionData(this.bot.config.sessionPath, browser, email, this.bot.isMobile)

            await this.bot.utils.waitRandom(2000,5000)

            // Close browser
            await browser.close()
            this.bot.log(this.bot.isMobile, '关闭浏览器', '浏览器已成功关闭!')
        } catch (error) {
            throw this.bot.log(this.bot.isMobile, '关闭浏览器', '发生错误:' + error, 'error')
        }
    }
}