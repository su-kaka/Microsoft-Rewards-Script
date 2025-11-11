import cluster from 'cluster'
import type { Worker } from 'cluster'
// 使用 playwright 的 Page 类型进行类型定义；在运行时 rebrowser-playwright 扩展 playwright
import type { Page } from 'playwright'

import Browser from './browser/Browser'
import BrowserFunc from './browser/BrowserFunc'
import BrowserUtil from './browser/BrowserUtil'

import { log } from './util/Logger'
import Util from './util/Utils'
import { loadAccounts, loadConfig, saveSessionData } from './util/Load'
import { DISCORD } from './constants'

import { Login } from './functions/Login'
import { Workers } from './functions/Workers'
import Activities from './functions/Activities'

import { Account } from './interface/Account'
import Axios from './util/Axios'
import fs from 'fs'
import path from 'path'

import Humanizer from './util/Humanizer'
import { detectBanReason } from './util/BanDetector'

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
    public humanizer: Humanizer
    public isMobile: boolean  // 是否为移动端模式
    public homePage!: Page  // 浏览器主页实例
    public currentAccountEmail?: string
    public currentAccountRecoveryEmail?: string
    public compromisedModeActive: boolean = false
    public compromisedReason?: string
    public compromisedEmail?: string
    // 类似互斥锁的标志，防止在 config.parallel 被意外错误配置时并行执行
    private isDesktopRunning: boolean = false
    private isMobileRunning: boolean = false

    private pointsCanCollect: number = 0  // 可收集积分
    private pointsInitial: number = 0  // 初始积分

    private activeWorkers: number  // 活跃工作线程数
    private mobileRetryAttempts: number  // 移动端重试次数
    private browserFactory: Browser = new Browser(this)  // 浏览器工厂
    private accounts: Account[]  // 账户列表
    private workers: Workers  // 工作线程管理器
    private login = new Login(this)  // 登录处理器
    private accessToken: string = ''  // 访问令牌
    // 摘要收集（每个进程）
    private accountSummaries: AccountSummary[] = []
    private runId: string = Math.random().toString(36).slice(2)
    private bannedTriggered: { email: string; reason: string } | null = null
    private globalStandby: { active: boolean; reason?: string } = { active: false }

    // 添加 axios 属性
    public axios!: Axios

    constructor(isMobile: boolean) {
        this.isMobile = isMobile
        this.log = log

        this.accounts = []
        this.utils = new Util()
        this.config = loadConfig()
        this.browser = {
            func: new BrowserFunc(this),
            utils: new BrowserUtil(this)
        }
        this.workers = new Workers(this)
        this.humanizer = new Humanizer(this.utils, this.config.humanization)
        this.activeWorkers = this.config.clusters
        this.mobileRetryAttempts = 0
    }

    async initialize() {
        this.accounts = loadAccounts()
    }

    async run() {
        log('main', 'MAIN', `机器人已启动，使用 ${this.config.clusters} 个集群`)



        // 只有当需要超过1个集群时才进行集群
        if (this.config.clusters > 1) {
            if (cluster.isPrimary) {
                this.runMaster()
            } else {
                this.runWorker()
            }
        } else {
            await this.runTasks(this.accounts)
        }
    }

    // 返回摘要（当 clusters==1 时使用）
    public getSummaries() {
        return this.accountSummaries
    }

    private runMaster() {
        log('main', 'MAIN-PRIMARY', '主进程已启动')

        const totalAccounts = this.accounts.length
        
        // 验证账户是否存在
        if (totalAccounts === 0) {
            log('main', 'MAIN-PRIMARY', '未找到要处理的账户。退出。', 'warn')
            process.exit(0)
        }
        
        // 如果用户过度指定了集群（例如10个集群但只有2个账户），不要生成无用的空闲工作线程。
        const workerCount = Math.min(this.config.clusters, totalAccounts)
        const accountChunks = this.utils.chunkArray(this.accounts, workerCount)
        // 将 activeWorkers 重置为实际生成计数（构造函数使用原始集群数）
        this.activeWorkers = workerCount

        for (let i = 0; i < workerCount; i++) {
            const worker = cluster.fork()
            const chunk = accountChunks[i] || []
            
            // 验证账户块是否包含账户
            if (chunk.length === 0) {
                log('main', 'MAIN-PRIMARY', `警告: Worker ${i} 接收到空的账户块`, 'warn')
            }
            
            (worker as unknown as { send?: (m: { chunk: Account[] }) => void }).send?.({ chunk })
            worker.on('message', (msg: unknown) => {
                const m = msg as { type?: string; data?: AccountSummary[] }
                if (m && m.type === 'summary' && Array.isArray(m.data)) {
                    this.accountSummaries.push(...m.data)
                }
            })
        }

    cluster.on('exit', (worker: Worker, code: number) => {
            this.activeWorkers -= 1

            log('main', 'MAIN-WORKER', `Worker ${worker.process.pid} 已销毁 | 代码: ${code} | 活跃工作线程: ${this.activeWorkers}`, 'warn')

            // 可选: 如果允许崩溃恢复，则重启已崩溃的工作线程（基本启发式方法）
            try {
                const cr = this.config.crashRecovery
                if (cr?.restartFailedWorker && code !== 0) {
                    const attempts = (worker as unknown as { _restartAttempts?: number })._restartAttempts || 0
                    if (attempts < (cr.restartFailedWorkerAttempts ?? 1)) {
                        (worker as unknown as { _restartAttempts?: number })._restartAttempts = attempts + 1
                        log('main','CRASH-RECOVERY',`重新启动工作线程 (尝试 ${attempts + 1})`, 'warn','yellow')
                        const newW = cluster.fork()
                        // 注意: 账户块重新分配过于简单: 未使用；真实映射改进待办
                        newW.on('message', (msg: unknown) => {
                            const m = msg as { type?: string; data?: AccountSummary[] }
                            if (m && m.type === 'summary' && Array.isArray(m.data)) this.accountSummaries.push(...m.data)
                        })
                    }
                }
            } catch { /* ignore */ }

            // 检查是否所有工作线程已退出
            if (this.activeWorkers === 0) {
                // 所有工作线程完成
                (async () => {
                    try {
                        await this.sendConclusion(this.accountSummaries)
                    } catch {/* ignore */}
                    log('main', 'MAIN-WORKER', '所有工作线程已销毁。退出主进程！', 'warn')
                    process.exit(0)
                })()
            }
        })
    }

    private runWorker() {
        log('main', 'MAIN-WORKER', `Worker ${process.pid} 已启动`)
        // 接收来自主进程的账户块
    ;(process as unknown as { on: (ev: 'message', cb: (m: { chunk: Account[] }) => void) => void }).on('message', async ({ chunk }: { chunk: Account[] }) => {
            await this.runTasks(chunk)
        })
    }

    private async runTasks(accounts: Account[]) {
        for (const account of accounts) {
            // 如果由于安全/封禁而处于全局待机状态，则停止处理更多账户
            if (this.globalStandby.active) {
                log('main','SECURITY',`全局待机激活 (${this.globalStandby.reason || '安全问题'})。在解决之前不会处理下一个账户。`, 'warn', 'yellow')
                break
            }
            // 可选：第一次封禁后全局停止
            if (this.config?.humanization?.stopOnBan === true && this.bannedTriggered) {
                log('main','TASK',`由于 ${this.bannedTriggered.email} 上的封禁而停止剩余账户: ${this.bannedTriggered.reason}`,'warn')
                break
            }
            // 重置每个账户的受损状态
            this.compromisedModeActive = false
            this.compromisedReason = undefined
            this.compromisedEmail = undefined
            // 如果配置了人性化允许的时间窗口，在时间窗口内等待
            try {
                const windows: string[] | undefined = this.config?.humanization?.allowedWindows
                if (Array.isArray(windows) && windows.length > 0) {
                    const waitMs = this.computeWaitForAllowedWindow(windows)
                    if (waitMs > 0) {
                        log('main','HUMANIZATION',`等待 ${Math.ceil(waitMs/1000)} 秒直到下一个允许的时间窗口再启动 ${account.email}`,'warn')
                        await new Promise<void>(r => setTimeout(r, waitMs))
                    }
                }
            } catch {/* ignore */}
            this.currentAccountEmail = account.email
            this.currentAccountRecoveryEmail = account.recoveryEmail
            log('main', 'MAIN-WORKER', `已开始为账户 ${account.email} 执行任务`)

            const accountStart = Date.now()
            let desktopInitial = 0
            let mobileInitial = 0
            let desktopCollected = 0
            let mobileCollected = 0
            const errors: string[] = []
            const banned = { status: false, reason: '' }

            this.axios = new Axios(account.proxy)
            const verbose = process.env.DEBUG_REWARDS_VERBOSE === '1'
            const formatFullErr = (label: string, e: unknown) => {
                const base = shortErr(e)
                if (verbose && e instanceof Error) {
                    return `${label}:${base} :: ${e.stack?.split('\n').slice(0,4).join(' | ')}`
                }
                return `${label}:${base}`
            }

            if (this.config.parallel) {
                const mobileInstance = new MicrosoftRewardsBot(true)
                mobileInstance.axios = this.axios
                // 运行两个流程并捕获结果并进行详细日志记录
                const desktopPromise = this.Desktop(account).catch(e => {
                    const msg = e instanceof Error ? e.message : String(e)
                    log(false, 'TASK', `${account.email} 的桌面流程早期失败: ${msg}`,'error')
                    const bd = detectBanReason(e)
                    if (bd.status) {
                        banned.status = true; banned.reason = bd.reason.substring(0,200)
                        void this.handleImmediateBanAlert(account.email, banned.reason)
                    }
                    errors.push(formatFullErr('desktop', e)); return null
                })
                const mobilePromise = mobileInstance.Mobile(account).catch(e => {
                    const msg = e instanceof Error ? e.message : String(e)
                    log(true, 'TASK', `${account.email} 的移动流程早期失败: ${msg}`,'error')
                    const bd = detectBanReason(e)
                    if (bd.status) {
                        banned.status = true; banned.reason = bd.reason.substring(0,200)
                        void this.handleImmediateBanAlert(account.email, banned.reason)
                    }
                    errors.push(formatFullErr('mobile', e)); return null
                })
                const [desktopResult, mobileResult] = await Promise.allSettled([desktopPromise, mobilePromise])
                
                // 处理桌面结果
                if (desktopResult.status === 'fulfilled' && desktopResult.value) {
                    desktopInitial = desktopResult.value.initialPoints
                    desktopCollected = desktopResult.value.collectedPoints
                } else if (desktopResult.status === 'rejected') {
                    log(false, 'TASK', `桌面 Promise 意外被拒绝: ${shortErr(desktopResult.reason)}`,'error')
                    errors.push(formatFullErr('desktop-rejected', desktopResult.reason))
                }
                
                // 处理移动结果
                if (mobileResult.status === 'fulfilled' && mobileResult.value) {
                    mobileInitial = mobileResult.value.initialPoints
                    mobileCollected = mobileResult.value.collectedPoints
                } else if (mobileResult.status === 'rejected') {
                    log(true, 'TASK', `移动 Promise 意外被拒绝: ${shortErr(mobileResult.reason)}`,'error')
                    errors.push(formatFullErr('mobile-rejected', mobileResult.reason))
                }
            } else {
                // 顺序执行并进行安全检查
                if (this.isDesktopRunning || this.isMobileRunning) {
                    log('main', 'TASK', `检测到竞态条件: 桌面=${this.isDesktopRunning}, 移动=${this.isMobileRunning}。跳过以防止冲突。`, 'error')
                    errors.push('race-condition-detected')
                } else {
                    this.isMobile = false
                    this.isDesktopRunning = true
                    const desktopResult = await this.Desktop(account).catch(e => {
                        const msg = e instanceof Error ? e.message : String(e)
                        log(false, 'TASK', `${account.email} 的桌面流程早期失败: ${msg}`,'error')
                        const bd = detectBanReason(e)
                        if (bd.status) {
                            banned.status = true; banned.reason = bd.reason.substring(0,200)
                            void this.handleImmediateBanAlert(account.email, banned.reason)
                        }
                        errors.push(formatFullErr('desktop', e)); return null
                    })
                    if (desktopResult) {
                        desktopInitial = desktopResult.initialPoints
                        desktopCollected = desktopResult.collectedPoints
                    }
                    this.isDesktopRunning = false

                    // 如果检测到封禁或受损，则跳过移动以节省时间
                    if (!banned.status && !this.compromisedModeActive) {
                        this.isMobile = true
                        this.isMobileRunning = true
                        const mobileResult = await this.Mobile(account).catch(e => {
                            const msg = e instanceof Error ? e.message : String(e)
                            log(true, 'TASK', `${account.email} 的移动流程早期失败: ${msg}`,'error')
                            const bd = detectBanReason(e)
                            if (bd.status) {
                                banned.status = true; banned.reason = bd.reason.substring(0,200)
                                void this.handleImmediateBanAlert(account.email, banned.reason)
                            }
                            errors.push(formatFullErr('mobile', e)); return null
                        })
                        if (mobileResult) {
                            mobileInitial = mobileResult.initialPoints
                            mobileCollected = mobileResult.collectedPoints
                        }
                        this.isMobileRunning = false
                    } else {
                        const why = banned.status ? '封禁状态' : '受损状态'
                        log(true, 'TASK', `由于 ${why} 跳过为 ${account.email} 执行移动流程`, 'warn')
                    }
                }
            }

            const accountEnd = Date.now()
            const durationMs = accountEnd - accountStart
            const totalCollected = desktopCollected + mobileCollected
            // 修正初始积分（以前版本重复计算了桌面+移动基线）
            // 策略：选择最低的非零基线（desktopInitial 或 mobileInitial）作为真实起点。
            // 顺序流：获得积分后 desktopInitial < mobileInitial -> min = 原始基线。
            // 并行流：两个基线相等 -> min 是合适的。
            const baselines: number[] = []
            if (desktopInitial) baselines.push(desktopInitial)
            if (mobileInitial) baselines.push(mobileInitial)
            let initialTotal = 0
            if (baselines.length === 1) initialTotal = baselines[0]!
            else if (baselines.length === 2) initialTotal = Math.min(baselines[0]!, baselines[1]!)
            // 如果两者都缺失则回退
            if (initialTotal === 0 && (desktopInitial || mobileInitial)) initialTotal = desktopInitial || mobileInitial || 0
            const endTotal = initialTotal + totalCollected
            this.accountSummaries.push({
                email: account.email,
                durationMs,
                desktopCollected,
                mobileCollected,
                totalCollected,
                initialTotal,
                endTotal,
                errors,
                banned
            })

            if (banned.status) {
                this.bannedTriggered = { email: account.email, reason: banned.reason }
                // 进入全局待机：不处理下一个账户
                this.globalStandby = { active: true, reason: `封禁:${banned.reason}` }
                await this.sendGlobalSecurityStandbyAlert(account.email, `检测到封禁: ${banned.reason || '未知'}`)
            }

            await log('main', 'MAIN-WORKER', `账户 ${account.email} 的任务已完成`, 'log', 'green')
        }

    await log(this.isMobile, 'MAIN-PRIMARY', '所有账户的任务已完成', 'log', 'green')
        // 详细模式下的额外诊断摘要
        if (process.env.DEBUG_REWARDS_VERBOSE === '1') {
            for (const summary of this.accountSummaries) {
                log('main','SUMMARY-DEBUG',`账户 ${summary.email} 收集 D:${summary.desktopCollected} M:${summary.mobileCollected} 总计:${summary.totalCollected} 错误:${summary.errors.length ? summary.errors.join(';') : '无'}`)
            }
        }
        // 如果任何账户被标记为受损，不要退出；保持进程运行以使浏览器保持开启
        if (this.compromisedModeActive || this.globalStandby.active) {
            log('main','SECURITY','检测到受损或封禁。启用全局待机：在解决之前不会处理其他账户。保持进程运行。完成后按 CTRL+C 退出。安全检查由 @Light 提供','warn','yellow')
            const standbyInterval = setInterval(() => {
                log('main','SECURITY','仍在待机：会话保持开启以供手动恢复/审查...','warn','yellow')
            }, 5 * 60 * 1000)
            
            // 进程退出时清理
            process.once('SIGINT', () => { clearInterval(standbyInterval); process.exit(0) })
            process.once('SIGTERM', () => { clearInterval(standbyInterval); process.exit(0) })
            return
        }
        // 如果在工作线程模式下（clusters>1）将摘要发送给主进程
        if (this.config.clusters > 1 && !cluster.isPrimary) {
            if (process.send) {
                process.send({ type: 'summary', data: this.accountSummaries })
            }
        } else {
            // 单进程模式
        }
        process.exit()
    }

    /** Send immediate ban alert if configured. */
    private async handleImmediateBanAlert(email: string, reason: string): Promise<void> {
        try {
            const h = this.config?.humanization
            if (!h || h.immediateBanAlert === false) return
            const { ConclusionWebhook } = await import('./util/ConclusionWebhook')
            await ConclusionWebhook(
                this.config,
                '🚫 Ban Detected',
                `**Account:** ${email}\n**Reason:** ${reason || 'detected by heuristics'}`,
                undefined,
                DISCORD.COLOR_RED
            )
        } catch (e) {
            log('main','ALERT',`发送封禁警报失败: ${e instanceof Error ? e.message : e}`,'warn')
        }
    }

    /** Compute milliseconds to wait until within one of the allowed windows (HH:mm-HH:mm). Returns 0 if already inside. */
    private computeWaitForAllowedWindow(windows: string[]): number {
        const now = new Date()
        const minsNow = now.getHours() * 60 + now.getMinutes()
        let nextStartMins: number | null = null
        for (const w of windows) {
            const [start, end] = w.split('-')
            if (!start || !end) continue
            const pStart = start.split(':').map(v=>parseInt(v,10))
            const pEnd = end.split(':').map(v=>parseInt(v,10))
            if (pStart.length !== 2 || pEnd.length !== 2) continue
            const sh = pStart[0]!, sm = pStart[1]!
            const eh = pEnd[0]!, em = pEnd[1]!
            if ([sh,sm,eh,em].some(n=>Number.isNaN(n))) continue
            const s = sh*60 + sm
            const e = eh*60 + em
            if (s <= e) {
                // 当天时间窗口
                if (minsNow >= s && minsNow <= e) return 0
                if (minsNow < s) nextStartMins = Math.min(nextStartMins ?? s, s)
            } else {
                // 跨越午夜（例如，22:00-02:00）
                if (minsNow >= s || minsNow <= e) return 0
                // 今天下一次开始是 s
                nextStartMins = Math.min(nextStartMins ?? s, s)
            }
        }
        const msPerMin = 60*1000
        if (nextStartMins != null) {
            const targetTodayMs = (nextStartMins - minsNow) * msPerMin
            return targetTodayMs > 0 ? targetTodayMs : (24*60 + nextStartMins - minsNow) * msPerMin
        }
        // 未解析到有效时间窗口 -> 不要阻止
        return 0
    }

    // 桌面
    async Desktop(account: Account) {
        log(false,'FLOW','Desktop() 已调用')
        const browser = await this.browserFactory.createBrowser(account.proxy, account.email)
        this.homePage = await browser.newPage()

        log(this.isMobile, 'MAIN', '启动浏览器')

        // 登录 MS Rewards，然后可选择在受损时停止
    await this.login.login(this.homePage, account.email, account.password, account.totp)

        if (this.compromisedModeActive) {
            // 用户希望页面保持开启以进行手动恢复。不要继续执行任务。
            const reason = this.compromisedReason || 'security-issue'
            log(this.isMobile, 'SECURITY', `账户被标记为受损 (${reason}). 保持浏览器开启并跳过所有为 ${account.email} 的活动。安全检查由 @Light 提供`, 'warn', 'yellow')
            try {
                const { ConclusionWebhook } = await import('./util/ConclusionWebhook')
                await ConclusionWebhook(
                    this.config,
                    '🔐 安全警报 (登录后)',
                    `**账户:** ${account.email}\n**原因:** ${reason}\n**操作:** 保持浏览器开启；跳过任务\n\n_安全检查由 @Light 提供_`,
                    undefined,
                    0xFFAA00
                )
            } catch {/* ignore */}
            // 为方便起见保存会话，但不要关闭浏览器
            try { 
                await saveSessionData(this.config.sessionPath, this.homePage.context(), account.email, this.isMobile) 
            } catch (e) {
                log(this.isMobile, 'SECURITY', `保存会话失败: ${e instanceof Error ? e.message : String(e)}`, 'warn')
            }
            return { initialPoints: 0, collectedPoints: 0 }
        }

        await this.browser.func.goHome(this.homePage)

        const data = await this.browser.func.getDashboardData()

    this.pointsInitial = data.userStatus.availablePoints
    const initial = this.pointsInitial

        log(this.isMobile, 'MAIN-POINTS', `当前积分为: ${this.pointsInitial}`)

        const browserEnarablePoints = await this.browser.func.getBrowserEarnablePoints()

        // 统计所有桌面积分
        this.pointsCanCollect = browserEnarablePoints.dailySetPoints +
            browserEnarablePoints.desktopSearchPoints
            + browserEnarablePoints.morePromotionsPoints

        log(this.isMobile, 'MAIN-POINTS', `您今天可以获得 ${this.pointsCanCollect} 积分`)

        if (this.pointsCanCollect === 0) {
            // 额外的诊断细分，让用户知道为什么是零
            log(this.isMobile, 'MAIN-POINTS', `细分 (桌面): 每日任务=${browserEnarablePoints.dailySetPoints} 搜索=${browserEnarablePoints.desktopSearchPoints} 推广=${browserEnarablePoints.morePromotionsPoints}`)
            log(this.isMobile, 'MAIN-POINTS', '所有可赚取的桌面积分桶都为零。这通常意味着：今天任务已完成或者您的时区尚未发生每日重置。如果您仍想强制运行活动，请在配置中设置 execution.runOnZeroPoints=true。', 'log', 'yellow')
        }

        // 如果 runOnZeroPoints 为 false 且可赚取积分为0，则不要继续
        if (!this.config.runOnZeroPoints && this.pointsCanCollect === 0) {
            log(this.isMobile, 'MAIN', '没有可赚取的积分，且"runOnZeroPoints"设置为"false"，停止！', 'log', 'yellow')

            // 关闭桌面浏览器
            await this.browser.func.closeBrowser(browser, account.email)
            return
        }

        // 打开一个新选项卡以完成任务
        const workerPage = await browser.newPage()

        // 在工作页面上转到首页
        await this.browser.func.goHome(workerPage)

        // 完成每日任务
        if (this.config.workers.doDailySet) {
            await this.workers.doDailySet(workerPage, data)
        }

        // 完成更多推广
        if (this.config.workers.doMorePromotions) {
            await this.workers.doMorePromotions(workerPage, data)
        }

        // 完成打卡卡
        if (this.config.workers.doPunchCards) {
            await this.workers.doPunchCard(workerPage, data)
        }

        // 执行桌面搜索
        if (this.config.workers.doDesktopSearch) {
            await this.activities.doSearch(workerPage, data)
        }

        // 保存 Cookie
        await saveSessionData(this.config.sessionPath, browser, account.email, this.isMobile)

        // 关闭前获取积分（避免页面关闭重新加载错误）
        const after = await this.browser.func.getCurrentPoints().catch(()=>initial)
        // 关闭桌面浏览器
        await this.browser.func.closeBrowser(browser, account.email)
        return {
            initialPoints: initial,
            collectedPoints: (after - initial) || 0
        }
    }

    // 移动
    async Mobile(account: Account) {
        log(true,'FLOW','Mobile() 已调用')
        const browser = await this.browserFactory.createBrowser(account.proxy, account.email)
        this.homePage = await browser.newPage()

        log(this.isMobile, 'MAIN', '启动浏览器')

        // 登录 MS Rewards，然后遵守受损模式
    await this.login.login(this.homePage, account.email, account.password, account.totp)
        if (this.compromisedModeActive) {
            const reason = this.compromisedReason || 'security-issue'
            log(this.isMobile, 'SECURITY', `账户被标记为受损 (${reason}). 保持移动浏览器开启并跳过移动活动 ${account.email}. 安全检查由 @Light 提供`, 'warn', 'yellow')
            try {
                const { ConclusionWebhook } = await import('./util/ConclusionWebhook')
                await ConclusionWebhook(
                    this.config,
                    '🔐 安全警报 (移动)',
                    `**账户:** ${account.email}\n**原因:** ${reason}\n**操作:** 保持移动浏览器开启；跳过任务`,
                    undefined,
                    0xFFAA00
                )
            } catch {/* ignore */}
            try { 
                await saveSessionData(this.config.sessionPath, this.homePage.context(), account.email, this.isMobile) 
            } catch (e) {
                log(this.isMobile, 'SECURITY', `保存会话失败: ${e instanceof Error ? e.message : String(e)}`, 'warn')
            }
            return { initialPoints: 0, collectedPoints: 0 }
        }
        this.accessToken = await this.login.getMobileAccessToken(this.homePage, account.email)

        await this.browser.func.goHome(this.homePage)

    const data = await this.browser.func.getDashboardData()
    const initialPoints = data.userStatus.availablePoints || this.pointsInitial || 0

        const browserEnarablePoints = await this.browser.func.getBrowserEarnablePoints()
        const appEarnablePoints = await this.browser.func.getAppEarnablePoints(this.accessToken)

        this.pointsCanCollect = browserEnarablePoints.mobileSearchPoints + appEarnablePoints.totalEarnablePoints

        log(this.isMobile, 'MAIN-POINTS', `您今天可以获得 ${this.pointsCanCollect} 积分 (浏览器: ${browserEnarablePoints.mobileSearchPoints} 积分, 应用: ${appEarnablePoints.totalEarnablePoints} 积分)`)

        if (this.pointsCanCollect === 0) {
            log(this.isMobile, 'MAIN-POINTS', `细分 (移动): 浏览器搜索=${browserEnarablePoints.mobileSearchPoints} 应用总计=${appEarnablePoints.totalEarnablePoints}`)
            log(this.isMobile, 'MAIN-POINTS', '所有可赚取的移动积分桶都为零。原因：移动搜索已达到上限，每日任务已完成，或尚未达到每日重置时间。您可以通过设置 execution.runOnZeroPoints=true 来强制执行。', 'log', 'yellow')
        }

        // 如果 runOnZeroPoints 为 false 且可赚取积分为0，则不要继续
        if (!this.config.runOnZeroPoints && this.pointsCanCollect === 0) {
            log(this.isMobile, 'MAIN', '没有可赚取的积分，且"runOnZeroPoints"设置为"false"，停止！', 'log', 'yellow')

            // 关闭移动浏览器
            await this.browser.func.closeBrowser(browser, account.email)
            return {
                initialPoints: initialPoints,
                collectedPoints: 0
            }
        }
        // 执行每日签到
        if (this.config.workers.doDailyCheckIn) {
            await this.activities.doDailyCheckIn(this.accessToken, data)
        }

        // 执行阅读赚钱
        if (this.config.workers.doReadToEarn) {
            await this.activities.doReadToEarn(this.accessToken, data)
        }

        // 执行移动搜索
        if (this.config.workers.doMobileSearch) {
            // 如果未找到移动搜索数据，则停止（新账户中不一定存在）
            if (data.userStatus.counters.mobileSearch) {
                // 打开一个新选项卡以完成任务
                const workerPage = await browser.newPage()

                // 在工作页面上转到首页
                await this.browser.func.goHome(workerPage)

                await this.activities.doSearch(workerPage, data)

                // 获取当前搜索积分
                const mobileSearchPoints = (await this.browser.func.getSearchPoints()).mobileSearch?.[0]

                if (mobileSearchPoints && (mobileSearchPoints.pointProgressMax - mobileSearchPoints.pointProgress) > 0) {
                    // 递增重试计数
                    this.mobileRetryAttempts++
                }

                // 如果重试次数耗尽则退出
                if (this.mobileRetryAttempts > this.config.searchSettings.retryMobileSearchAmount) {
                    log(this.isMobile, 'MAIN', `已达到最大重试限制 ${this.config.searchSettings.retryMobileSearchAmount}。退出重试循环`, 'warn')
                } else if (this.mobileRetryAttempts !== 0) {
                    log(this.isMobile, 'MAIN', `尝试 ${this.mobileRetryAttempts}/${this.config.searchSettings.retryMobileSearchAmount}: 无法完成移动搜索，User-Agent 有问题？增加搜索延迟？正在重试...`, 'log', 'yellow')

                    // 关闭移动浏览器
                    await this.browser.func.closeBrowser(browser, account.email)

                    // 创建一个新浏览器并尝试
                    await this.Mobile(account)
                    return
                }
            } else {
                log(this.isMobile, 'MAIN', '无法获取搜索积分，您的账户可能对此来说太"新"了！请稍后重试！', 'warn')
            }
        }

        const afterPointAmount = await this.browser.func.getCurrentPoints()

        log(this.isMobile, 'MAIN-POINTS', `脚本今天收集了 ${afterPointAmount - initialPoints} 积分`)

        // 关闭移动浏览器
        await this.browser.func.closeBrowser(browser, account.email)
        return {
            initialPoints: initialPoints,
            collectedPoints: (afterPointAmount - initialPoints) || 0
        }
    }

    private async sendConclusion(summaries: AccountSummary[]) {
        const { ConclusionWebhookEnhanced } = await import('./util/ConclusionWebhook')
        const cfg = this.config

    const conclusionWebhookEnabled = !!(cfg.conclusionWebhook && cfg.conclusionWebhook.enabled)
    const ntfyEnabled = !!(cfg.ntfy && cfg.ntfy.enabled)
    const webhookEnabled = !!(cfg.webhook && cfg.webhook.enabled)

        const totalAccounts = summaries.length
        if (totalAccounts === 0) return

        let totalCollected = 0
        let totalInitial = 0
        let totalEnd = 0
        let totalDuration = 0
        let accountsWithErrors = 0
        let accountsBanned = 0
        let successes = 0

        // 计算摘要统计
        for (const s of summaries) {
            totalCollected += s.totalCollected
            totalInitial += s.initialTotal
            totalEnd += s.endTotal
            totalDuration += s.durationMs
            if (s.banned?.status) accountsBanned++
            if (s.errors.length) accountsWithErrors++
            if (!s.banned?.status && !s.errors.length) successes++
        }

        const avgDuration = totalDuration / totalAccounts
        const avgPointsPerAccount = Math.round(totalCollected / totalAccounts)

        // 读取包版本
        let version = 'unknown'
        try {
            const pkgPath = path.join(process.cwd(), 'package.json')
            if (fs.existsSync(pkgPath)) {
                const raw = fs.readFileSync(pkgPath, 'utf-8')
                const pkg = JSON.parse(raw)
                version = pkg.version || version
            }
        } catch { /* ignore */ }

        // 发送增强的webhook
        if (conclusionWebhookEnabled || ntfyEnabled || webhookEnabled) {
            await ConclusionWebhookEnhanced(cfg, {
                version,
                runId: this.runId,
                totalAccounts,
                successes,
                accountsWithErrors,
                accountsBanned,
                totalCollected,
                totalInitial,
                totalEnd,
                avgPointsPerAccount,
                totalDuration,
                avgDuration,
                summaries
            })
        }

        // 写入本地JSON报告
        try {
            const fs = await import('fs')
            const path = await import('path')
            const now = new Date()
            const day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
            const baseDir = path.join(process.cwd(), 'reports', day)
            if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true })
            const file = path.join(baseDir, `summary_${this.runId}.json`)
            const payload = {
                runId: this.runId,
                timestamp: now.toISOString(),
                totals: { totalCollected, totalInitial, totalEnd, totalDuration, totalAccounts, accountsWithErrors },
                perAccount: summaries
            }
            fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8')
            log('main','REPORT',`报告已保存到 ${file}`)
        } catch (e) {
            log('main','REPORT',`保存报告失败: ${e instanceof Error ? e.message : e}`,'warn')
        }


        // 可选社区通知（在约15%的成功运行中随机显示）
        if (Math.random() > 0.85 && successes > 0 && accountsWithErrors === 0) {
            log('main','INFO','想要更快的更新和增强的反检测？社区版本可用: https://discord.gg/kn3695Kx32')
        }

    }



    /** Public entry-point to engage global security standby from other modules (idempotent). */
    public async engageGlobalStandby(reason: string, email?: string): Promise<void> {
        try {
            if (this.globalStandby.active) return
            this.globalStandby = { active: true, reason }
            const who = email || this.currentAccountEmail || 'unknown'
            await this.sendGlobalSecurityStandbyAlert(who, reason)
        } catch {/* ignore */}
    }

    /** Send a strong alert to all channels and mention @everyone when entering global security standby. */
    private async sendGlobalSecurityStandbyAlert(email: string, reason: string): Promise<void> {
        try {
            const { ConclusionWebhook } = await import('./util/ConclusionWebhook')
            await ConclusionWebhook(
                this.config,
                '🚨 Global Security Standby Engaged',
                `@everyone\n\n**Account:** ${email}\n**Reason:** ${reason}\n**Action:** Pausing all further accounts. We will not proceed until this is resolved.`,
                undefined,
                DISCORD.COLOR_RED
            )
        } catch (e) {
            log('main','ALERT',`发送待机警报失败: ${e instanceof Error ? e.message : e}`,'warn')
        }
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
    banned?: { status: boolean; reason: string }
}

function shortErr(e: unknown): string {
    if (e == null) return 'unknown'
    if (e instanceof Error) return e.message.substring(0, 120)
    const s = String(e)
    return s.substring(0, 120)
}

async function main() {
    const rewardsBot = new MicrosoftRewardsBot(false)

    const crashState = { restarts: 0 }
    const config = rewardsBot.config

    const attachHandlers = () => {
        process.on('unhandledRejection', (reason) => {
            log('main','FATAL','未处理的拒绝: ' + (reason instanceof Error ? reason.message : String(reason)), 'error')
            gracefulExit(1)
        })
        process.on('uncaughtException', (err) => {
            log('main','FATAL','未捕获的异常: ' + err.message, 'error')
            gracefulExit(1)
        })
        process.on('SIGTERM', () => gracefulExit(0))
        process.on('SIGINT', () => gracefulExit(0))
    }

    const gracefulExit = (code: number) => {
        if (config?.crashRecovery?.autoRestart && code !== 0) {
            const max = config.crashRecovery.maxRestarts ?? 2
            if (crashState.restarts < max) {
                const backoff = (config.crashRecovery.backoffBaseMs ?? 2000) * (crashState.restarts + 1)
                log('main','CRASH-RECOVERY',`计划在 ${backoff}ms 后重启 (尝试 ${crashState.restarts + 1}/${max})`, 'warn','yellow')
                setTimeout(() => {
                    crashState.restarts++
                    bootstrap()
                }, backoff)
                return
            }
        }
        process.exit(code)
    }

    const bootstrap = async () => {
        try {
            await rewardsBot.initialize()
            await rewardsBot.run()
        } catch (e) {
            log('main','MAIN-ERROR','运行期间致命错误: ' + (e instanceof Error ? e.message : e),'error')
            gracefulExit(1)
        }
    }

    attachHandlers()
    await bootstrap()
}

// 启动机器人
if (require.main === module) {
    main().catch(error => {
        log('main', 'MAIN-ERROR', `运行机器人时出错: ${error}`, 'error')
        process.exit(1)
    })
}
