import { Page } from 'rebrowser-playwright'

import { MicrosoftRewardsBot } from '../index'

import { Search } from './activities/Search'
import { ABC } from './activities/ABC'
import { Poll } from './activities/Poll'
import { Quiz } from './activities/Quiz'
import { ThisOrThat } from './activities/ThisOrThat'
import { UrlReward } from './activities/UrlReward'
import { SearchOnBing } from './activities/SearchOnBing'
import { ReadToEarn } from './activities/ReadToEarn'
import { DailyCheckIn } from './activities/DailyCheckIn'

import { DashboardData, MorePromotion, PromotionalItem } from '../interface/DashboardData'
import type { ActivityHandler } from '../interface/ActivityHandler'

type ActivityKind =
    | { type: 'poll' }
    | { type: 'abc' }
    | { type: 'thisOrThat' }
    | { type: 'quiz' }
    | { type: 'urlReward' }
    | { type: 'searchOnBing' }
    | { type: 'unsupported' }

// 活动处理类 - 负责执行各种Microsoft Rewards活动
export default class Activities {
    private bot: MicrosoftRewardsBot
    private handlers: ActivityHandler[] = []

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    // 注册外部/自定义处理器（可选扩展点）
    registerHandler(handler: ActivityHandler) {
        this.handlers.push(handler)
    }

    // 仪表板/打卡卡活动的集中调度器
    async run(page: Page, activity: MorePromotion | PromotionalItem): Promise<void> {
        // 首先，尝试自定义处理器（如果有的话）
        for (const h of this.handlers) {
            try {
                if (h.canHandle(activity)) {
                    await h.run(page, activity)
                    return
                }
            } catch (e) {
                this.bot.log(this.bot.isMobile, 'ACTIVITY', `自定义处理器 ${(h.id || '未知')} 失败: ${e instanceof Error ? e.message : e}`, 'error')
            }
        }

        const kind = this.classifyActivity(activity)
        try {
            switch (kind.type) {
                case 'poll':
                    await this.doPoll(page)
                    break
                case 'abc':
                    await this.doABC(page)
                    break
                case 'thisOrThat':
                    await this.doThisOrThat(page)
                    break
                case 'quiz':
                    await this.doQuiz(page)
                    break
                case 'searchOnBing':
                    await this.doSearchOnBing(page, activity)
                    break
                case 'urlReward':
                    await this.doUrlReward(page)
                    break
                default:
                    this.bot.log(this.bot.isMobile, 'ACTIVITY', `跳过活动 "${activity.title}" | 原因: 不支持的类型: "${String((activity as { promotionType?: string }).promotionType)}"!`, 'warn')
                    break
            }
        } catch (e) {
            this.bot.log(this.bot.isMobile, 'ACTIVITY', `"${activity.title}" 的调度器错误: ${e instanceof Error ? e.message : e}`, 'error')
        }
    }

    public getTypeLabel(activity: MorePromotion | PromotionalItem): string {
        const k = this.classifyActivity(activity)
        switch (k.type) {
            case 'poll': return 'Poll'
            case 'abc': return 'ABC'
            case 'thisOrThat': return 'ThisOrThat'
            case 'quiz': return 'Quiz'
            case 'searchOnBing': return 'SearchOnBing'
            case 'urlReward': return 'UrlReward'
            default: return 'Unsupported'
        }
    }

    private classifyActivity(activity: MorePromotion | PromotionalItem): ActivityKind {
        const type = (activity.promotionType || '').toLowerCase()
        if (type === 'quiz') {
            // 使用当前启发式方法区分投票/ABC/此或彼与一般测验
            const max = activity.pointProgressMax
            const url = (activity.destinationUrl || '').toLowerCase()
            if (max === 10) {
                if (url.includes('pollscenarioid')) return { type: 'poll' }
                return { type: 'abc' }
            }
            if (max === 50) return { type: 'thisOrThat' }
            return { type: 'quiz' }
        }
        if (type === 'urlreward') {
            const name = (activity.name || '').toLowerCase()
            if (name.includes('exploreonbing')) return { type: 'searchOnBing' }
            return { type: 'urlReward' }
        }
        return { type: 'unsupported' }
    }

    doSearch = async (page: Page, data: DashboardData): Promise<void> => {
        const search = new Search(this.bot)
        await search.doSearch(page, data)
    }

    // 执行ABC活动
    doABC = async (page: Page): Promise<void> => {
        const abc = new ABC(this.bot)
        await abc.doABC(page)
    }

    // 执行投票活动
    doPoll = async (page: Page): Promise<void> => {
        const poll = new Poll(this.bot)
        await poll.doPoll(page)
    }

    doThisOrThat = async (page: Page): Promise<void> => {
        const thisOrThat = new ThisOrThat(this.bot)
        await thisOrThat.doThisOrThat(page)
    }

    doQuiz = async (page: Page): Promise<void> => {
        const quiz = new Quiz(this.bot)
        await quiz.doQuiz(page)
    }

    doUrlReward = async (page: Page): Promise<void> => {
        const urlReward = new UrlReward(this.bot)
        await urlReward.doUrlReward(page)
    }

    doSearchOnBing = async (page: Page, activity: MorePromotion | PromotionalItem): Promise<void> => {
        const searchOnBing = new SearchOnBing(this.bot)
        await searchOnBing.doSearchOnBing(page, activity)
    }

    doReadToEarn = async (accessToken: string, data: DashboardData): Promise<void> => {
        const readToEarn = new ReadToEarn(this.bot)
        await readToEarn.doReadToEarn(accessToken, data)
    }

    doDailyCheckIn = async (accessToken: string, data: DashboardData): Promise<void> => {
        const dailyCheckIn = new DailyCheckIn(this.bot)
        await dailyCheckIn.doDailyCheckIn(accessToken, data)
    }

}