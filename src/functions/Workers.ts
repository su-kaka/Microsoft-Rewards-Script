import { Page } from 'rebrowser-playwright'

import { DashboardData, MorePromotion, PromotionalItem, PunchCard } from '../interface/DashboardData'

import { MicrosoftRewardsBot } from '../index'

export class Workers {
    public bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    // Daily Set
    async doDailySet(page: Page, data: DashboardData) {
        const todayData = data.dailySetPromotions[this.bot.utils.getFormattedDate()]

        const activitiesUncompleted = todayData?.filter(x => !x.complete && x.pointProgressMax > 0) ?? []

        if (!activitiesUncompleted.length) {
            this.bot.log(this.bot.isMobile, '每日任务', '所有“每日任务”项目均已完成')
            return
        }

        // Solve Activities
        this.bot.log(this.bot.isMobile, '每日任务', '开始解决“每日任务”项目')

        await this.solveActivities(page, activitiesUncompleted)

        page = await this.bot.browser.utils.getLatestTab(page)

        // Always return to the homepage if not already
        await this.bot.browser.func.goHome(page)

        this.bot.log(this.bot.isMobile, '每日任务', '所有“每日任务”项目均已完成')
    }

    // Punch Card
    async doPunchCard(page: Page, data: DashboardData) {

        const punchCardsUncompleted = data.punchCards?.filter(x => x.parentPromotion && !x.parentPromotion.complete) ?? [] // Only return uncompleted punch cards

        if (!punchCardsUncompleted.length) {
            this.bot.log(this.bot.isMobile, '打卡', '所有“打卡”项目均已完成')
            return
        }

        for (const punchCard of punchCardsUncompleted) {

            // Ensure parentPromotion exists before proceeding
            if (!punchCard.parentPromotion?.title) {
                this.bot.log(this.bot.isMobile, '打卡', `跳过打卡活动 "${punchCard.name}" | 原因: 父推广活动缺失!`, 'warn')
                continue
            }

            // Get latest page for each card
            page = await this.bot.browser.utils.getLatestTab(page)

            const activitiesUncompleted = punchCard.childPromotions.filter(x => !x.complete) // Only return uncompleted activities

            // Solve Activities
            this.bot.log(this.bot.isMobile, '打卡', `开始解决打卡项目: "${punchCard.parentPromotion.title}"`)

            // Got to punch card index page in a new tab
            await page.goto(punchCard.parentPromotion.destinationUrl, { referer: this.bot.config.baseURL })

            // Wait for new page to load, max 10 seconds, however try regardless in case of error
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { })

            await this.solveActivities(page, activitiesUncompleted, punchCard)

            page = await this.bot.browser.utils.getLatestTab(page)

            const pages = page.context().pages()

            if (pages.length > 3) {
                await page.close()
            } else {
                await this.bot.browser.func.goHome(page)
            }

            this.bot.log(this.bot.isMobile, '打卡', `打卡项目: "${punchCard.parentPromotion.title}" 的所有项目均已完成`)
        }

        this.bot.log(this.bot.isMobile, '打卡', '所有“打卡”项目均已完成')
    }

    // More Promotions
    async doMorePromotions(page: Page, data: DashboardData) {
        const morePromotions = data.morePromotions

        // Check if there is a promotional item
        if (data.promotionalItem) { // Convert and add the promotional item to the array
            morePromotions.push(data.promotionalItem as unknown as MorePromotion)
        }

        const activitiesUncompleted = morePromotions?.filter(x => !x.complete && x.pointProgressMax > 0 && x.exclusiveLockedFeatureStatus !== 'locked') ?? []

        if (!activitiesUncompleted.length) {
            this.bot.log(this.bot.isMobile, '更多促销', '所有“更多促销”项目均已完成')
            return
        }

        // Solve Activities
        this.bot.log(this.bot.isMobile, '更多促销', '开始解决“更多促销”项目')

        page = await this.bot.browser.utils.getLatestTab(page)

        await this.solveActivities(page, activitiesUncompleted)

        page = await this.bot.browser.utils.getLatestTab(page)

        // Always return to the homepage if not already
        await this.bot.browser.func.goHome(page)

        this.bot.log(this.bot.isMobile, '更多促销', '所有“更多促销”项目均已完成')
    }

    // Solve all the different types of activities
    private async solveActivities(activityPage: Page, activities: PromotionalItem[] | MorePromotion[], punchCard?: PunchCard) {
        const activityInitial = activityPage.url() // Homepage for Daily/More and Index for promotions

        for (const activity of activities) {
            try {
                // Reselect the worker page
                activityPage = await this.bot.browser.utils.getLatestTab(activityPage)

                const pages = activityPage.context().pages()
                if (pages.length > 3) {
                    await activityPage.close()

                    activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                }

                await this.bot.utils.waitRandom(1000,4000)

                if (activityPage.url() !== activityInitial) {
                    await activityPage.goto(activityInitial)
                }


                let selector = `[data-bi-id^="${activity.offerId}"] .pointLink:not(.contentContainer .pointLink)`

                if (punchCard) {
                    selector = await this.bot.browser.func.getPunchCardActivity(activityPage, activity)

                } else if (activity.name.toLowerCase().includes('membercenter') || activity.name.toLowerCase().includes('exploreonbing')) {
                    selector = `[data-bi-id^="${activity.name}"] .pointLink:not(.contentContainer .pointLink)`
                }

                // Wait for the new tab to fully load, ignore error.
                /*
                Due to common false timeout on this function, we're ignoring the error regardless, if it worked then it's faster,
                if it didn't then it gave enough time for the page to load.
                */
                await activityPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { })
                await this.bot.utils.waitRandom(2000,5000)

                switch (activity.promotionType) {
                    // Quiz (Poll, Quiz or ABC)
                    case 'quiz':
                        switch (activity.pointProgressMax) {
                            // Poll or ABC (Usually 10 points)
                            case 10:
                                // Normal poll
                                if (activity.destinationUrl.toLowerCase().includes('pollscenarioid')) {
                                    this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "投票" 标题: "${activity.title}"`)
                                    await activityPage.click(selector)
                                    activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                                    await this.bot.activities.doPoll(activityPage)
                                } else { // ABC
                                    this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "ABC" 标题: "${activity.title}"`)
                                    await activityPage.click(selector)
                                    activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                                    await this.bot.activities.doABC(activityPage)
                                }
                                break

                            // This Or That Quiz (Usually 50 points)
                            case 50:
                                this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "二选一测验" 标题: "${activity.title}"`)
                                await activityPage.click(selector)
                                activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                                await this.bot.activities.doThisOrThat(activityPage)
                                break

                            // Quizzes are usually 30-40 points
                            default:
                                this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "测验" 标题: "${activity.title}"`)
                                await activityPage.click(selector)
                                activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                                await this.bot.activities.doQuiz(activityPage)
                                break
                        }
                        break

                    // UrlReward (Visit)
                    case 'urlreward':
                        // Search on Bing are subtypes of "urlreward"
                        if (activity.name.toLowerCase().includes('exploreonbing')) {
                            this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "必应搜索" 标题: "${activity.title}"`)
                            await activityPage.click(selector)
                            activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                            await this.bot.activities.doSearchOnBing(activityPage, activity)

                        } else {
                            this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "网址奖励" 标题: "${activity.title}"`)
                            await activityPage.click(selector)
                            activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                            await this.bot.activities.doUrlReward(activityPage)
                        }
                        break

                    // Unsupported types
                    default:
                        this.bot.log(this.bot.isMobile, '活动', `跳过活动 "${activity.title}" | 原因: 不支持的类型: "${activity.promotionType}"!`, 'warn')
                        break
                }

                // Cooldown
                await this.bot.utils.waitRandom(2000,5000)

            } catch (error) {
                this.bot.log(this.bot.isMobile, '活动', '发生错误:' + error, 'error')
            }

        }
    }

}