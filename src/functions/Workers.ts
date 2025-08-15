import { Page } from 'rebrowser-playwright'

import { DashboardData, MorePromotion, PromotionalItem, PunchCard } from '../interface/DashboardData'

import { MicrosoftRewardsBot } from '../index'

export class Workers {
    public bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    // 每日任务
    async doDailySet(page: Page, data: DashboardData) {
        const todayData = data.dailySetPromotions[this.bot.utils.getFormattedDate()]

        const activitiesUncompleted = todayData?.filter(x => !x.complete && x.pointProgressMax > 0) ?? []

        if (!activitiesUncompleted.length) {
            this.bot.log(this.bot.isMobile, '每日任务', '所有“每日任务”项目均已完成')
            return
        }

        // 解决活动
        this.bot.log(this.bot.isMobile, '每日任务', '开始解决“每日任务”项目')

        await this.solveActivities(page, activitiesUncompleted)

        page = await this.bot.browser.utils.getLatestTab(page)

        // 如果不在主页，则始终返回主页
        await this.bot.browser.func.goHome(page)

        this.bot.log(this.bot.isMobile, '每日任务', '所有“每日任务”项目均已完成')
    }

    // 打卡任务
    async doPunchCard(page: Page, data: DashboardData) {

        const punchCardsUncompleted = data.punchCards?.filter(x => x.parentPromotion && !x.parentPromotion.complete) ?? [] // 仅返回未完成的打卡任务

        if (!punchCardsUncompleted.length) {
            this.bot.log(this.bot.isMobile, '打卡', '所有“打卡”项目均已完成')
            return
        }

        for (const punchCard of punchCardsUncompleted) {

            // 确保父推广活动存在后再继续
            if (!punchCard.parentPromotion?.title) {
                this.bot.log(this.bot.isMobile, '打卡', `跳过打卡活动 "${punchCard.name}" | 原因: 父推广活动缺失!`, 'warn')
                continue
            }

            // 获取每个卡片的最新页面
            page = await this.bot.browser.utils.getLatestTab(page)

            const activitiesUncompleted = punchCard.childPromotions.filter(x => !x.complete) // 仅返回未完成的活动

            // 解决活动
            this.bot.log(this.bot.isMobile, '打卡', `开始解决打卡项目: "${punchCard.parentPromotion.title}"`)

            // 在新标签页中跳转到打卡索引页面
            await page.goto(punchCard.parentPromotion.destinationUrl, { referer: this.bot.config.baseURL })

            // 等待新页面加载，最长10秒，但如果出错仍继续执行
            const randomLoadTimeout = this.bot.utils.randomNumber(6000, 10000);
            await page.waitForLoadState('networkidle', { timeout: randomLoadTimeout }).catch(() => { })

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

    // 更多活动
    async doMorePromotions(page: Page, data: DashboardData) {
        const morePromotions = data.morePromotions

        // 检查是否有促销项目
        if (data.promotionalItem) { // 转换并添加促销项目到数组
            morePromotions.push(data.promotionalItem as unknown as MorePromotion)
        }

        const activitiesUncompleted = morePromotions?.filter(x => !x.complete && x.pointProgressMax > 0 && x.exclusiveLockedFeatureStatus !== 'locked') ?? []

        if (!activitiesUncompleted.length) {
            this.bot.log(this.bot.isMobile, '更多活动', '所有“更多活动”项目均已完成')
            return
        }

        // 解决活动
        this.bot.log(this.bot.isMobile, '更多活动', '开始解决“更多活动”项目')

        page = await this.bot.browser.utils.getLatestTab(page)

        await this.solveActivities(page, activitiesUncompleted)

        page = await this.bot.browser.utils.getLatestTab(page)

        // 如果不在主页，则始终返回主页
        await this.bot.browser.func.goHome(page)

        this.bot.log(this.bot.isMobile, '更多活动', '所有“更多活动”项目均已完成')
    }

    // 解决所有不同类型的活动
    private async solveActivities(activityPage: Page, activities: PromotionalItem[] | MorePromotion[], punchCard?: PunchCard) {
        const activityInitial = activityPage.url() // 每日/更多任务的主页或促销的索引页

        for (const activity of activities) {
            try {
                // 重新选择工作页面
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

                //"[data-bi-id^="Gamification_DailySet_ZHCN_20250624_Child1"] .pointLink:not(.contentContainer .pointLink)"
                let selector = `[data-bi-id^="${activity.offerId}"] .pointLink:not(.contentContainer .pointLink)`
                if (this.bot.isMobile){
                    selector = `[data-bi-id^="${activity.offerId}"] .pointLink`
                }
                if (punchCard) {
                    selector = await this.bot.browser.func.getPunchCardActivity(activityPage, activity)

                } else if (activity.name.toLowerCase().includes('membercenter') || activity.name.toLowerCase().includes('exploreonbing')) {
                    selector = `[data-bi-id^="${activity.name}"] .pointLink:not(.contentContainer .pointLink)`
                }

                // 等待新标签页完全加载，忽略错误
                /*
                由于此函数常见虚假超时，我们无论是否成功都忽略错误，如果成功了会更快，
                如果不成功也给了页面足够加载的时间。
                */
                const randomTimeout = this.bot.utils.randomNumber(8000, 12000);
                await activityPage.waitForLoadState('networkidle', { timeout: randomTimeout }).catch(() => { })
                await this.bot.utils.waitRandom(2000,5000)

                switch (activity.promotionType) {
                    // 测验 (投票、测验或ABC)
                    case 'quiz':
                        switch (activity.pointProgressMax) {
                            // 投票或ABC (通常10分)
                            case 10:
                                // 普通投票
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

                            // 二选一测验 (通常50分)
                            case 50:
                                this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "二选一测验" 标题: "${activity.title}"`)
                                await activityPage.click(selector)
                                activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                                await this.bot.activities.doThisOrThat(activityPage)
                                break

                            // 测验通常30-40分
                            default:
                                this.bot.log(this.bot.isMobile, '活动', `找到活动类型: "测验" 标题: "${activity.title}"`)
                                await activityPage.click(selector)
                                activityPage = await this.bot.browser.utils.getLatestTab(activityPage)
                                await this.bot.activities.doQuiz(activityPage)
                                break
                        }
                        break

                    // 网址奖励 (访问)
                    case 'urlreward':
                        // 必应搜索是"urlreward"的子类型
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

                    // 不支持的类型
                    default:
                        this.bot.log(this.bot.isMobile, '活动', `跳过活动 "${activity.title}" | 原因: 不支持的类型: "${activity.promotionType}"!`, 'warn')
                        break
                }

                // 冷却时间
                await this.bot.utils.waitRandom(2000,5000)

            } catch (error) {
                this.bot.log(this.bot.isMobile, '活动', '发生错误:' + error, 'error')
            }

        }
    }

}