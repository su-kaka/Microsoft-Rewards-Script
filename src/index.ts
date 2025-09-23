import cluster from 'cluster'
// Use Page type from playwright for typings; at runtime rebrowser-playwright extends playwright
// import type { Page } from 'playwright'
import { Page } from 'rebrowser-playwright'

import Browser from './browser/Browser'
import BrowserFunc from './browser/BrowserFunc'
import BrowserUtil from './browser/BrowserUtil'

import { log } from './util/Logger'
import Util from './util/Utils'
import { loadAccounts, loadConfig, saveSessionData } from './util/Load'

import { Login } from './functions/Login'
import { Workers } from './functions/Workers'
import Activities from './functions/Activities'

import { Account } from './interface/Account'
import Axios from './util/Axios'
import fs from 'fs'
import path from 'path'


// 主机器人类 - 负责管理Microsoft Rewards自动化任务
// 包含账户管理、浏览器操作、积分收集等功能
export class MicrosoftRewardsBot {
    public log: typeof log  // 日志记录器
    public config  // 配置信息
    public utils: Util  // 工具类实例
    public activities: Activities = new Activities(this)  // 活动处理器
    public browser: {
        func: BrowserFunc,  // 浏览器功能
        utils: BrowserUtil  // 浏览器工具
    }
    public isMobile: boolean  // 是否为移动端模式
    public homePage!: Page  // 浏览器主页实例

    private pointsCanCollect: number = 0  // 可收集积分
    private pointsInitial: number = 0  // 初始积分

    private activeWorkers: number  // 活跃工作线程数
    private mobileRetryAttempts: number  // 移动端重试次数
    private browserFactory: Browser = new Browser(this)  // 浏览器工厂
    private accounts: Account[]  // 账户列表
    private workers: Workers  // 工作线程管理器
    private login = new Login(this)  // 登录处理器
    private accessToken: string = ''  // 访问令牌
    // Summary collection (per process)
    private accountSummaries: AccountSummary[] = []
    // 添加 axios 属性
    //@ts-expect-error Will be initialized later
    public axios: Axios

    constructor(isMobile: boolean) {
        this.isMobile = isMobile
        this.log = log

        this.accounts = []
        this.utils = new Util()
        this.workers = new Workers(this)
        this.browser = {
            func: new BrowserFunc(this),
            utils: new BrowserUtil(this)
        }
        this.config = loadConfig()
        this.activeWorkers = this.config.clusters
        this.mobileRetryAttempts = 0
    }

    async initialize() {
        this.accounts = loadAccounts()
    }

    async run() {
        this.printBanner()
        log('main', 'MAIN', `机器人已启动，使用 ${this.config.clusters} 个集群`);

        // Only cluster when there's more than 1 cluster demanded
        if (this.config.clusters > 1) {
            if (cluster.isPrimary) {
                this.runMaster();
            } else {
                this.runWorker();
            }
        } else {
            await this.runTasks(this.accounts);
        }
    }

    private printBanner() {
        // Only print once (primary process or single cluster execution)
        if (this.config.clusters > 1 && !cluster.isPrimary) return
        try {
            const pkgPath = path.join(__dirname, '../', 'package.json')
            let version = 'unknown'
            if (fs.existsSync(pkgPath)) {
                const raw = fs.readFileSync(pkgPath, 'utf-8')
                const pkg = JSON.parse(raw)
                version = pkg.version || version
            }
            const banner = [
                '  __  __  _____       _____                            _     ',
                ' |  \/  |/ ____|     |  __ \\                          | |    ',
                ' | \  / | (___ ______| |__) |_____      ____ _ _ __ __| |___ ',
                ' | |\/| |\\___ \\______|  _  // _ \\ \\ /\\ / / _` | \'__/ _` / __|',
                ' | |  | |____) |     | | \\ \\  __/ \\ V  V / (_| | | | (_| \\__ \\',
                ' |_|  |_|_____/      |_|  \\_\\___| \\_/\\_/ \\__,_|_|  \\__,_|___/',
                '',
                ` Version: v${version}`,
                ''
            ].join('\n')
            console.log(banner)
        } catch { /* ignore banner errors */ }
    }

    // Return summaries (used when clusters==1)
    public getSummaries() {
        return this.accountSummaries
    }

    private runMaster() {
        log('main', 'MAIN-PRIMARY', '主进程已启动');

        const accountChunks = this.utils.chunkArray(this.accounts, this.config.clusters);

        for (let i = 0; i < accountChunks.length; i++) {
            const worker = cluster.fork()
            const chunk = accountChunks[i]
            ;(worker as any).send?.({ chunk })
            // Collect summaries from workers
            worker.on('message', (msg: any) => {
                if (msg && msg.type === 'summary' && Array.isArray(msg.data)) {
                    this.accountSummaries.push(...msg.data)
                }
            })
        }

    cluster.on('exit', (worker: any, code: number) => {
            this.activeWorkers -= 1

            log('main', 'MAIN-WORKER', `工作线程 ${worker.process.pid} 已销毁 | 退出码: ${code} | 活跃线程数: ${this.activeWorkers}`, 'warn');

            // Check if all workers have exited
            if (this.activeWorkers === 0) {
                // All workers done -> send conclusion (if enabled) then exit
                this.sendConclusion(this.accountSummaries).finally(() => {
                    log('main', 'MAIN-WORKER', 'All workers destroyed. Exiting main process!', 'warn')
                    process.exit(0)
                })
            }
        });
    }

    private runWorker() {
        log('main', 'MAIN-WORKER', `工作线程 ${process.pid} 已启动`);
        // Receive the chunk of accounts from the master
    ;(process as any).on('message', async ({ chunk }: { chunk: Account[] }) => {
            await this.runTasks(chunk)
        })
    }

    private async runTasks(accounts: Account[]) {
        // 遍历所有账户
        for (const account of accounts) {
            // 记录日志，表明开始为该账户执行任务
            log('main', 'MAIN-WORKER', `开始为账户 ${account.email} 执行任务`);
            const accountStart = Date.now()
            let desktopInitial = 0
            let mobileInitial = 0
            let desktopCollected = 0
            let mobileCollected = 0
            const errors: string[] = []
            // 初始化 Axios 实例，并传入代理信息
            this.axios = new Axios(account.proxy)
            const verbose = process.env.DEBUG_REWARDS_VERBOSE === '1'
            const formatFullErr = (label: string, e: any) => {
                const base = shortErr(e)
                if (verbose && e instanceof Error) {
                    return `${label}:${base} :: ${e.stack?.split('\n').slice(0,4).join(' | ')}`
                }
                return `${label}:${base}`
            }

            if (this.config.parallel) {
                const mobileInstance = new MicrosoftRewardsBot(true)
                mobileInstance.axios = this.axios
                // Run both and capture results with detailed logging
                const desktopPromise = this.Desktop(account).catch(e => {
                    log(false, 'TASK', `Desktop flow failed early for ${account.email}: ${e instanceof Error ? e.message : e}`,'error')
                    errors.push(formatFullErr('desktop', e)); return null
                })
                const mobilePromise = mobileInstance.Mobile(account).catch(e => {
                    log(true, 'TASK', `Mobile flow failed early for ${account.email}: ${e instanceof Error ? e.message : e}`,'error')
                    errors.push(formatFullErr('mobile', e)); return null
                })
                const [desktopResult, mobileResult] = await Promise.all([desktopPromise, mobilePromise])
                if (desktopResult) {
                    desktopInitial = desktopResult.initialPoints
                    desktopCollected = desktopResult.collectedPoints
                }
                if (mobileResult) {
                    mobileInitial = mobileResult.initialPoints
                    mobileCollected = mobileResult.collectedPoints
                }
            } else {
                this.isMobile = false
                const desktopResult = await this.Desktop(account).catch(e => {
                    log(false, 'TASK', `Desktop flow failed early for ${account.email}: ${e instanceof Error ? e.message : e}`,'error')
                    errors.push(formatFullErr('desktop', e)); return null
                })
                if (desktopResult) {
                    desktopInitial = desktopResult.initialPoints
                    desktopCollected = desktopResult.collectedPoints
                }

                this.isMobile = true
                const mobileResult = await this.Mobile(account).catch(e => {
                    log(true, 'TASK', `Mobile flow failed early for ${account.email}: ${e instanceof Error ? e.message : e}`,'error')
                    errors.push(formatFullErr('mobile', e)); return null
                })
                if (mobileResult) {
                    mobileInitial = mobileResult.initialPoints
                    mobileCollected = mobileResult.collectedPoints
                }
            }

            const accountEnd = Date.now()
            const durationMs = accountEnd - accountStart
            const totalCollected = desktopCollected + mobileCollected
            const initialTotal = (desktopInitial || 0) + (mobileInitial || 0)
            this.accountSummaries.push({
                email: account.email,
                durationMs,
                desktopCollected,
                mobileCollected,
                totalCollected,
                initialTotal,
                endTotal: initialTotal + totalCollected,
                errors
            })

            log('main', 'MAIN-WORKER', `账户 ${account.email} 的任务已完成`, 'log', 'green');
        }

        log(this.isMobile, 'MAIN-PRIMARY', '所有账户的任务已完成', 'log', 'green');
        // Extra diagnostic summary when verbose
        if (process.env.DEBUG_REWARDS_VERBOSE === '1') {
            for (const summary of this.accountSummaries) {
                log('main','SUMMARY-DEBUG',`Account ${summary.email} collected D:${summary.desktopCollected} M:${summary.mobileCollected} TOTAL:${summary.totalCollected} ERRORS:${summary.errors.length ? summary.errors.join(';') : 'none'}`)
            }
        }
        // If in worker mode (clusters>1) send summaries to primary
        if (this.config.clusters > 1 && !cluster.isPrimary) {
            if (process.send) {
                process.send({ type: 'summary', data: this.accountSummaries })
            }
        } else {
            // Single process mode -> build and send conclusion directly
            await this.sendConclusion(this.accountSummaries)
        }
        process.exit()
    }

    // 桌面端任务执行方法
    async Desktop(account: Account) {
        // 创建浏览器实例，并传入代理信息和账户邮箱
        const browser = await this.browserFactory.createBrowser(account.proxy, account.email);
        // 打开一个新页面
        this.homePage = await browser.newPage();
        // 记录日志，表明开始启动浏览器
        log(this.isMobile, 'MAIN', '正在启动浏览器');


        // 登录微软奖励账户，然后跳转到奖励主页
        await this.login.login(this.homePage, account.email, account.password);

        // 导航到奖励主页
        await this.browser.func.goHome(this.homePage);
        
        // 获取仪表盘数据
        const data = await this.browser.func.getDashboardData();

        // 记录初始积分
        this.pointsInitial = data.userStatus.availablePoints
        const initial = this.pointsInitial

        // 记录当前积分数量
        log(this.isMobile, 'MAIN-POINTS', `当前积分数量: ${this.pointsInitial}`);

        // 获取浏览器端可赚取的积分
        const browserEnarablePoints = await this.browser.func.getBrowserEarnablePoints();

        // 统计桌面端可收集的总积分
        this.pointsCanCollect = browserEnarablePoints.dailySetPoints +
            browserEnarablePoints.desktopSearchPoints
            + browserEnarablePoints.morePromotionsPoints;

        // 记录今天可赚取的积分数量
        log(this.isMobile, 'MAIN-POINTS', `今天可赚取 ${this.pointsCanCollect} 积分`);

        // 如果 runOnZeroPoints 为 false 且没有可赚取的积分，则停止执行
        if (!this.config.runOnZeroPoints && this.pointsCanCollect === 0) {
            log(this.isMobile, 'MAIN', '没有可赚取的积分，且 "runOnZeroPoints" 设置为 "false"，停止执行！', 'log', 'yellow');

            // 关闭桌面浏览器
            await this.browser.func.closeBrowser(browser, account.email);
            return;
        }

        // 打开一个新标签页，用于完成任务
        log(this.isMobile, 'MAIN-POINTS', `打开一个新标签页，用于完成任务`);
        const workerPage = await browser.newPage();

        // 在新标签页中导航到主页
        log(this.isMobile, 'MAIN-POINTS', `在新标签页中导航到主页务`);
        await this.browser.func.goHome(workerPage);

        // // 如果配置允许，完成打卡任务
        if (this.config.workers.doPunchCards) {
            await this.workers.doPunchCard(workerPage, data);
        }

        // 如果配置允许，完成每日任务集
        if (this.config.workers.doDailySet) {
            await this.workers.doDailySet(workerPage, data);
        }

        // 如果配置允许，完成更多活动活动
        if (this.config.workers.doMorePromotions) {
            await this.workers.doMorePromotions(workerPage, data);
        }

        // 如果配置允许，进行桌面端搜索

        // // 如果配置允许，完成打卡任务
        if (this.config.workers.doPunchCards) {
            await this.workers.doPunchCard(workerPage, data);
        }
		// Do desktop searches
        if (this.config.workers.doDesktopSearch) {
            await this.activities.doSearch(workerPage, data);
        }

        // 保存会话数据
        await saveSessionData(this.config.sessionPath, browser, account.email, this.isMobile);
        // Fetch points BEFORE closing (avoid page closed reload error)
        const after = await this.browser.func.getCurrentPoints().catch(()=>initial)
        // 关闭桌面浏览器
        await this.browser.func.closeBrowser(browser, account.email);
        return {
            initialPoints: initial,
            collectedPoints: (after - initial) || 0
        }
    }

    // 移动端任务执行方法
    async Mobile(account: Account) {
        // 创建浏览器实例，并传入代理信息和账户邮箱
        const browser = await this.browserFactory.createBrowser(account.proxy, account.email);
        // 打开一个新页面
        this.homePage = await browser.newPage();

        // 记录日志，表明开始启动浏览器
        log(this.isMobile, 'MAIN', '正在启动浏览器');

        // 登录微软奖励账户，然后跳转到奖励主页
        await this.login.login(this.homePage, account.email, account.password);
        // 获取移动端访问令牌
        this.accessToken = await this.login.getMobileAccessToken(this.homePage, account.email);

        // 导航到奖励主页
        await this.browser.func.goHome(this.homePage);

        // 获取仪表盘数据
        const data = await this.browser.func.getDashboardData()
        const initialPoints = data.userStatus.availablePoints || this.pointsInitial || 0

        // 获取浏览器端可赚取的积分
        const browserEnarablePoints = await this.browser.func.getBrowserEarnablePoints();
        // 获取应用端可赚取的积分
        const appEarnablePoints = await this.browser.func.getAppEarnablePoints(this.accessToken);


        // 打开一个新标签页，用于完成任务-2025年6月23日17:15:13
        log(this.isMobile, 'MAIN-POINTS', `打开一个新标签页，用于完成任务`);
        const workerPage = await browser.newPage();

        // 在新标签页中导航到主页-2025年6月23日17:15:13
        log(this.isMobile, 'MAIN-POINTS', `在新标签页中导航到主页务`);
        await this.browser.func.goHome(workerPage);

        // 如果配置允许，完成每日任务集-2025年6月23日17:15:13
        if (this.config.workers.doDailySet) {
            await this.workers.doDailySet(workerPage, data);
        }
        // 如果配置允许，完成每日更多任务集-2025年8月15日16:57:56
        if (this.config.workers.doMorePromotions) {
            await this.workers.doMorePromotions(workerPage, data);
        }

        // 统计移动端可收集的总积分
        this.pointsCanCollect = browserEnarablePoints.mobileSearchPoints + appEarnablePoints.totalEarnablePoints;

        // 记录今天可赚取的积分数量，分别显示浏览器端和应用端的积分
        log(this.isMobile, 'MAIN-POINTS', `今天可赚取 ${this.pointsCanCollect} 积分（浏览器端: ${browserEnarablePoints.mobileSearchPoints} 积分，应用端: ${appEarnablePoints.totalEarnablePoints} 积分）`);

        // 如果 runOnZeroPoints 为 false 且没有可赚取的积分，则停止执行
        if (!this.config.runOnZeroPoints && this.pointsCanCollect === 0) {
            log(this.isMobile, 'MAIN', '没有可赚取的积分，且 "runOnZeroPoints" 设置为 "false"，停止执行！', 'log', 'yellow');

            // 关闭移动端浏览器
            await this.browser.func.closeBrowser(browser, account.email);
            return {
                initialPoints: initialPoints,
                collectedPoints: 0
            }
        }

        // 如果配置允许，进行每日签到
        if (this.config.workers.doDailyCheckIn) {
            await this.activities.doDailyCheckIn(this.accessToken, data);
        }


        // 如果配置允许，进行阅读赚取积分
        if (this.config.workers.doReadToEarn) {
            await this.activities.doReadToEarn(this.accessToken, data);
        }

        // 如果配置允许，进行移动端搜索
        if (this.config.workers.doMobileSearch) {
            // 如果没有找到移动端搜索数据，可能是新账户，停止执行
            if (data.userStatus.counters.mobileSearch) {
                // 打开一个新标签页，用于完成任务
                const workerPage = await browser.newPage();

                // 在新标签页中导航到主页
                await this.browser.func.goHome(workerPage);

                // 进行移动端搜索
                await this.activities.doSearch(workerPage, data);

                // 获取当前搜索积分
                const mobileSearchPoints = (await this.browser.func.getSearchPoints()).mobileSearch?.[0];

                // 如果还有未完成的搜索积分，增加重试次数
                if (mobileSearchPoints && (mobileSearchPoints.pointProgressMax - mobileSearchPoints.pointProgress) > 0) {
                    // 增加重试次数
                    this.mobileRetryAttempts++;
                }

                // 如果达到最大重试次数，退出重试循环
                if (this.mobileRetryAttempts > this.config.searchSettings.retryMobileSearchAmount) {
                    log(this.isMobile, 'MAIN', `已达到最大重试次数 ${this.config.searchSettings.retryMobileSearchAmount}，退出重试循环`, 'warn');
                } else if (this.mobileRetryAttempts !== 0) {
                    log(this.isMobile, 'MAIN', `尝试 ${this.mobileRetryAttempts}/${this.config.searchSettings.retryMobileSearchAmount}：无法完成移动端搜索，可能是 User-Agent 有误？是否增加搜索延迟？正在重试...`, 'log', 'yellow');

                    // 关闭移动端浏览器
                    await this.browser.func.closeBrowser(browser, account.email);

                    // 创建一个新的浏览器实例并重试
                    await this.Mobile(account);
                    return;
                }
            } else {
                log(this.isMobile, 'MAIN', '无法获取搜索积分，您的账户可能太新，稍后再试！', 'warn');
            }
        }

        // 获取执行脚本后的积分数量
        const afterPointAmount = await this.browser.func.getCurrentPoints();

        // 记录脚本今天收集的积分数量
        log(this.isMobile, 'MAIN-POINTS', `脚本今天收集了 ${afterPointAmount - initialPoints} 积分`);

        // 关闭移动端浏览器
        await this.browser.func.closeBrowser(browser, account.email);
        return {
            initialPoints: initialPoints,
            collectedPoints: (afterPointAmount - initialPoints) || 0
        }
    }

    private async sendConclusion(summaries: AccountSummary[]) {
        const { ConclusionWebhook } = await import('./util/ConclusionWebhook')
        const cfg = this.config
        if (!cfg.conclusionWebhook || !cfg.conclusionWebhook.enabled) return

        const totalAccounts = summaries.length
        if (totalAccounts === 0) return

        let totalCollected = 0
        let totalInitial = 0
        let totalEnd = 0
        let totalDuration = 0
        let accountsWithErrors = 0

        const accountFields: any[] = []
        for (const s of summaries) {
            totalCollected += s.totalCollected
            totalInitial += s.initialTotal
            totalEnd += s.endTotal
            totalDuration += s.durationMs
            if (s.errors.length) accountsWithErrors++

            const statusEmoji = s.errors.length ? '⚠️' : '✅'
            const diff = s.totalCollected
            const duration = formatDuration(s.durationMs)
            const valueLines: string[] = [
                `Points: ${s.initialTotal} → ${s.endTotal} ( +${diff} )`,
                `Breakdown: 🖥️ ${s.desktopCollected} | 📱 ${s.mobileCollected}`,
                `Duration: ⏱️ ${duration}`
            ]
            if (s.errors.length) {
                valueLines.push(`Errors: ${s.errors.slice(0,2).join(' | ')}`)
            }
            accountFields.push({
                name: `${statusEmoji} ${s.email}`.substring(0, 256),
                value: valueLines.join('\n').substring(0, 1024),
                inline: false
            })
        }

        const avgDuration = totalDuration / totalAccounts
        const embed = {
            title: '🎯 Microsoft Rewards Summary',
            description: `Processed **${totalAccounts}** account(s)${accountsWithErrors ? ` • ${accountsWithErrors} with issues` : ''}`,
            color: accountsWithErrors ? 0xFFAA00 : 0x32CD32,
            fields: [
                {
                    name: 'Global Totals',
                    value: [
                        `Total Points: ${totalInitial} → ${totalEnd} ( +${totalCollected} )`,
                        `Average Duration: ${formatDuration(avgDuration)}`,
                        `Cumulative Runtime: ${formatDuration(totalDuration)}`
                    ].join('\n')
                },
                ...accountFields
            ].slice(0, 25), // Discord max 25 fields
            timestamp: new Date().toISOString(),
            footer: {
                text: 'Script conclusion webhook'
            }
        }

        // Fallback plain text (rare) & embed send
        const fallback = `Microsoft Rewards Summary\nAccounts: ${totalAccounts}\nTotal: ${totalInitial} -> ${totalEnd} (+${totalCollected})\nRuntime: ${formatDuration(totalDuration)}`
        await ConclusionWebhook(cfg, fallback, { embeds: [embed] })
    }
}

interface AccountSummary {
    email: string
    durationMs: number
    desktopCollected: number
    mobileCollected: number
    totalCollected: number
    initialTotal: number
    endTotal: number
    errors: string[]
}

function shortErr(e: any): string {
    if (!e) return 'unknown'
    if (e instanceof Error) return e.message.substring(0, 120)
    const s = String(e)
    return s.substring(0, 120)
}

function formatDuration(ms: number): string {
    if (!ms || ms < 1000) return `${ms}ms`
    const sec = Math.floor(ms / 1000)
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const parts: string[] = []
    if (h) parts.push(`${h}h`)
    if (m) parts.push(`${m}m`)
    if (s) parts.push(`${s}s`)
    return parts.join(' ') || `${ms}ms`
}

async function main() {
    // 创建微软奖励机器人实例，非移动端模式
    const rewardsBot = new MicrosoftRewardsBot(false);

    try {
        await rewardsBot.initialize();
        await rewardsBot.run();
    } catch (error) {
        log(false, 'MAIN-ERROR', `运行桌面端机器人时出错: ${error}`, 'error');
    }
}

// Start the bots
main().catch(error => {
    log('main', 'MAIN-ERROR', `运行机器人时出错: ${error}`, 'error');
    process.exit(1);
});
