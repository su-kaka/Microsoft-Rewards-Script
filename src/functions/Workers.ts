import { Page } from 'rebrowser-playwright'

import { DashboardData, MorePromotion, PromotionalItem, PunchCard } from '../interface/DashboardData'

import { MicrosoftRewardsBot } from '../index'
import JobState from '../util/JobState'
import Retry from '../util/Retry'
import { AdaptiveThrottler } from '../util/AdaptiveThrottler'

export class Workers {
    public bot: MicrosoftRewardsBot
    private jobState: JobState

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
        this.jobState = new JobState(this.bot.config)
    }

    // 每日任务
    async doDailySet(page: Page, data: DashboardData) {
        const todayData = data.dailySetPromotions[this.bot.utils.getFormattedDate()]

        const today = this.bot.utils.getFormattedDate()
        const activitiesUncompleted = (todayData?.filter(x => !x.complete && x.pointProgressMax > 0) ?? [])
            .filter(x => {
                if (this.bot.config.jobState?.enabled === false) return true
                const email = this.bot.currentAccountEmail || 'unknown'
                return !this.jobState.isDone(email, today, x.offerId)
            })

        if (!activitiesUncompleted.length) {
            this.bot.log(this.bot.isMobile, 'DAILY-SET', '所有"每日任务"项目已完成')
            return
        }

        // 解决活动
        this.bot.log(this.bot.isMobile, 'DAILY-SET', '开始解决"每日任务"项目')

        await this.solveActivities(page, activitiesUncompleted)

        // 标记为已完成以防止重复工作（如果启用了检查点）
        if (this.bot.config.jobState?.enabled !== false) {
            const email = this.bot.currentAccountEmail || '未知'
            for (const a of activitiesUncompleted) {
                this.jobState.markDone(email, today, a.offerId)
            }
        }

        page = await this.bot.browser.utils.getLatestTab(page)

        // 如果尚未在首页则始终返回首页
        await this.bot.browser.func.goHome(page)

        this.bot.log(this.bot.isMobile, 'DAILY-SET', '所有"每日任务"项目已完成')

        // 可选: 立即运行桌面搜索包
        if (!this.bot.isMobile && this.bot.config.workers.bundleDailySetWithSearch && this.bot.config.workers.doDesktopSearch) {
            try {
                await this.bot.utils.waitRandom(1200, 2600)
                await this.bot.activities.doSearch(page, data)
            } catch (e) {
                this.bot.log(this.bot.isMobile, 'DAILY-SET', `每日任务后搜索失败: ${e instanceof Error ? e.message : e}`, 'warn')
            }
        }
    }

    // 打卡卡
    async doPunchCard(page: Page, data: DashboardData) {

        const punchCardsUncompleted = data.punchCards?.filter(x => x.parentPromotion && !x.parentPromotion.complete) ?? [] // 仅返回未完成的打卡卡

        if (!punchCardsUncompleted.length) {
            this.bot.log(this.bot.isMobile, 'PUNCH-CARD', '所有"打卡卡"已完成')
            return
        }

        for (const punchCard of punchCardsUncompleted) {

            // 继续之前确保父推广存在
            if (!punchCard.parentPromotion?.title) {
                this.bot.log(this.bot.isMobile, 'PUNCH-CARD', `跳过打卡卡 "${punchCard.name}" | 原因: 缺少父推广！`, 'warn')
                continue
            }

            // 为每张卡获取最新页面
            page = await this.bot.browser.utils.getLatestTab(page)

            const activitiesUncompleted = punchCard.childPromotions.filter(x => !x.complete) // 仅返回未完成的活动

            // 解决活动
            this.bot.log(this.bot.isMobile, 'PUNCH-CARD', `开始解决打卡卡 "${punchCard.parentPromotion.title}" 的"打卡卡"项目`)

            // 在新选项卡中转到打卡卡索引页面
            await page.goto(punchCard.parentPromotion.destinationUrl, { referer: this.bot.config.baseURL })

            // 等待新页面加载，最多10秒，但即使出错也尝试
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { })

            await this.solveActivities(page, activitiesUncompleted, punchCard)

            page = await this.bot.browser.utils.getLatestTab(page)

            const pages = page.context().pages()

            if (pages.length > 3) {
                await page.close()
            } else {
                await this.bot.browser.func.goHome(page)
            }

            this.bot.log(this.bot.isMobile, 'PUNCH-CARD', `打卡卡 "${punchCard.parentPromotion.title}" 的所有项目已完成`)
        }

        this.bot.log(this.bot.isMobile, 'PUNCH-CARD', '所有"打卡卡"项目已完成')
    }

    // 更多推广
    async doMorePromotions(page: Page, data: DashboardData) {
        const morePromotions = data.morePromotions

        // 检查是否有推广项目
        if (data.promotionalItem) { // 转换并将推广项目添加到数组
            morePromotions.push(data.promotionalItem as unknown as MorePromotion)
        }

        const activitiesUncompleted = morePromotions?.filter(x => !x.complete && x.pointProgressMax > 0 && x.exclusiveLockedFeatureStatus !== 'locked') ?? []

        if (!activitiesUncompleted.length) {
            this.bot.log(this.bot.isMobile, 'MORE-PROMOTIONS', '所有"更多推广"项目已完成')
            return
        }

        // 解决活动
        this.bot.log(this.bot.isMobile, 'MORE-PROMOTIONS', '开始解决"更多推广"项目')

        page = await this.bot.browser.utils.getLatestTab(page)

        await this.solveActivities(page, activitiesUncompleted)

        page = await this.bot.browser.utils.getLatestTab(page)

        // 如果尚未在首页则始终返回首页
        await this.bot.browser.func.goHome(page)

        this.bot.log(this.bot.isMobile, 'MORE-PROMOTIONS', '所有"更多推广"项目已完成')
    }

    // 解决所有不同类型活动
    private async solveActivities(activityPage: Page, activities: PromotionalItem[] | MorePromotion[], punchCard?: PunchCard) {
        const activityInitial = activityPage.url()
        const retry = new Retry(this.bot.config.retryPolicy)
        const throttle = new AdaptiveThrottler()

        for (const activity of activities) {
            try {
                activityPage = await this.manageTabLifecycle(activityPage, activityInitial)
                await this.applyThrottle(throttle, 800, 1400)

                const selector = await this.buildActivitySelector(activityPage, activity, punchCard)
                await this.prepareActivityPage(activityPage, selector, throttle)

                const typeLabel = this.bot.activities.getTypeLabel(activity)
                if (typeLabel !== 'Unsupported') {
                    await this.executeActivity(activityPage, activity, selector, throttle, retry)
                } else {
                    this.bot.log(this.bot.isMobile, 'ACTIVITY', `跳过活动 "${activity.title}" | 原因: 不支持的类型: "${activity.promotionType}"!`, 'warn')
                }

                await this.applyThrottle(throttle, 1200, 2600)
            } catch (error) {
                this.bot.log(this.bot.isMobile, 'ACTIVITY', '发生错误:' + error, 'error')
                throttle.record(false)
            }
        }
    }

    private async manageTabLifecycle(page: Page, initialUrl: string): Promise<Page> {
        page = await this.bot.browser.utils.getLatestTab(page)

        const pages = page.context().pages()
        if (pages.length > 3) {
            await page.close()
            page = await this.bot.browser.utils.getLatestTab(page)
        }

        if (page.url() !== initialUrl) {
            await page.goto(initialUrl)
        }

        return page
    }

    private async buildActivitySelector(page: Page, activity: PromotionalItem | MorePromotion, punchCard?: PunchCard): Promise<string> {
        if (punchCard) {
            return await this.bot.browser.func.getPunchCardActivity(page, activity)
        }

        const name = activity.name.toLowerCase()
        if (name.includes('membercenter') || name.includes('exploreonbing')) {
            return `[data-bi-id^="${activity.name}"] .pointLink:not(.contentContainer .pointLink)`
        }

        return `[data-bi-id^="${activity.offerId}"] .pointLink:not(.contentContainer .pointLink)`
    }

    private async prepareActivityPage(page: Page, selector: string, throttle: AdaptiveThrottler): Promise<void> {
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
        await this.bot.browser.utils.humanizePage(page)
        await this.applyThrottle(throttle, 1200, 2600)
    }

    private async executeActivity(page: Page, activity: PromotionalItem | MorePromotion, selector: string, throttle: AdaptiveThrottler, retry: Retry): Promise<void> {
        this.bot.log(this.bot.isMobile, 'ACTIVITY', `Found activity type: "${this.bot.activities.getTypeLabel(activity)}" title: "${activity.title}"`)
        
        await page.click(selector)
        page = await this.bot.browser.utils.getLatestTab(page)

        const timeoutMs = this.bot.utils.stringToMs(this.bot.config?.globalTimeout ?? '30s') * 2
        const runWithTimeout = (p: Promise<void>) => Promise.race([
            p,
            new Promise<void>((_, rej) => setTimeout(() => rej(new Error('activity-timeout')), timeoutMs))
        ])

        await retry.run(async () => {
            try {
                await runWithTimeout(this.bot.activities.run(page, activity))
                throttle.record(true)
            } catch (e) {
                throttle.record(false)
                throw e
            }
        }, () => true)

        await this.bot.browser.utils.humanizePage(page)
    }

    private async applyThrottle(throttle: AdaptiveThrottler, min: number, max: number): Promise<void> {
        const multiplier = throttle.getDelayMultiplier()
        await this.bot.utils.waitRandom(Math.floor(min * multiplier), Math.floor(max * multiplier))
    }

}