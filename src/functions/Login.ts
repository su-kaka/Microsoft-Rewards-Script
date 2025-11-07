// 干净重构的登录实现
// 保留的公共API：login()，getMobileAccessToken()

import type { Page, Locator } from 'playwright'
import * as crypto from 'crypto'
import readline from 'readline'
import { AxiosRequestConfig } from 'axios'
import { generateTOTP } from '../util/Totp'
import { saveSessionData } from '../util/Load'
import { MicrosoftRewardsBot } from '../index'
import { OAuth } from '../interface/OAuth'

// -------------------------------
// 常量/可调参数
// -------------------------------
const SELECTORS = {
  emailInput: 'input[type="email"]',
  passwordInput: 'input[type="password"]',
  submitBtn: 'button[type="submit"]',
  passkeySecondary: 'button[data-testid="secondaryButton"]',
  passkeyPrimary: 'button[data-testid="primaryButton"]',
  passkeyTitle: '[data-testid="title"]',
  kmsiVideo: '[data-testid="kmsiVideo"]',
  biometricVideo: '[data-testid="biometricVideo"]'
} as const

const LOGIN_TARGET = { host: 'rewards.bing.com', path: '/' }

const DEFAULT_TIMEOUTS = {
  loginMaxMs: (() => {
    const val = Number(process.env.LOGIN_MAX_WAIT_MS || 180000)
    if (isNaN(val) || val < 10000 || val > 600000) {
      console.warn(`[Login] Invalid LOGIN_MAX_WAIT_MS: ${process.env.LOGIN_MAX_WAIT_MS}. Using default 180000ms`)
      return 180000
    }
    return val
  })(),
  short: 500,
  medium: 1500,
  long: 3000
}

// 安全模式包
const SIGN_IN_BLOCK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /we can['’`]?t sign you in/i, label: 'cant-sign-in' },
  { re: /incorrect account or password too many times/i, label: 'too-many-incorrect' },
  { re: /used an incorrect account or password too many times/i, label: 'too-many-incorrect-variant' },
  { re: /sign-in has been blocked/i, label: 'sign-in-blocked-phrase' },
  { re: /your account has been locked/i, label: 'account-locked' },
  { re: /your account or password is incorrect too many times/i, label: 'incorrect-too-many-times' }
]

interface SecurityIncident {
  kind: string
  account: string
  details?: string[]
  next?: string[]
  docsUrl?: string
}

export class Login {
  private bot: MicrosoftRewardsBot
  private clientId = '0000000040170455'
  private authBaseUrl = 'https://login.live.com/oauth20_authorize.srf'
  private redirectUrl = 'https://login.live.com/oauth20_desktop.srf'
  private tokenUrl = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
  private scope = 'service::prod.rewardsplatform.microsoft.com::MBI_SSL'

  private currentTotpSecret?: string
  private compromisedInterval?: NodeJS.Timeout
  private passkeyHandled = false
  private noPromptIterations = 0
  private lastNoPromptLog = 0

  constructor(bot: MicrosoftRewardsBot) { this.bot = bot }

  // --------------- Public API ---------------
  async login(page: Page, email: string, password: string, totpSecret?: string) {
    try {
      // 清除之前运行的任何现有间隔
      if (this.compromisedInterval) {
        clearInterval(this.compromisedInterval)
        this.compromisedInterval = undefined
      }
      
      this.bot.log(this.bot.isMobile, 'LOGIN', '开始登录过程')
      this.currentTotpSecret = (totpSecret && totpSecret.trim()) || undefined

      await page.goto('https://www.bing.com/rewards/dashboard')
      await this.disableFido(page)
      await page.waitForLoadState('domcontentloaded').catch(()=>{})
      await this.bot.browser.utils.reloadBadPage(page)
      await this.checkAccountLocked(page)

      const already = await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 8000 }).then(()=>true).catch(()=>false)
      if (!already) {
        await this.performLoginFlow(page, email, password)
      } else {
        this.bot.log(this.bot.isMobile, 'LOGIN', '会话已认证')
        await this.checkAccountLocked(page)
      }

      await this.verifyBingContext(page)
      await saveSessionData(this.bot.config.sessionPath, page.context(), email, this.bot.isMobile)
      this.bot.log(this.bot.isMobile, 'LOGIN', '登录完成（会话已保存）')
      this.currentTotpSecret = undefined
    } catch (e) {
      throw this.bot.log(this.bot.isMobile, 'LOGIN', '登录失败: ' + e, 'error')
    }
  }

  async getMobileAccessToken(page: Page, email: string) {
    // 重用相同的FIDO禁用
    await this.disableFido(page)
    const url = new URL(this.authBaseUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('redirect_uri', this.redirectUrl)
    url.searchParams.set('scope', this.scope)
    url.searchParams.set('state', crypto.randomBytes(16).toString('hex'))
    url.searchParams.set('access_type', 'offline_access')
    url.searchParams.set('login_hint', email)

    await page.goto(url.href)
    const start = Date.now()
    this.bot.log(this.bot.isMobile, 'LOGIN-APP', '授权移动范围...')
    let code = ''
    while (Date.now() - start < DEFAULT_TIMEOUTS.loginMaxMs) {
      await this.handlePasskeyPrompts(page, 'oauth')
      const u = new URL(page.url())
      if (u.hostname === 'login.live.com' && u.pathname === '/oauth20_desktop.srf') {
        code = u.searchParams.get('code') || ''
        break
      }
      await this.bot.utils.wait(1000)
    }
    if (!code) throw this.bot.log(this.bot.isMobile, 'LOGIN-APP', '未及时收到OAuth代码', 'error')

    const form = new URLSearchParams()
    form.append('grant_type', 'authorization_code')
    form.append('client_id', this.clientId)
    form.append('code', code)
    form.append('redirect_uri', this.redirectUrl)

    const req: AxiosRequestConfig = { url: this.tokenUrl, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: form.toString() }
    const resp = await this.bot.axios.request(req)
    const data: OAuth = resp.data
    this.bot.log(this.bot.isMobile, 'LOGIN-APP', `在 ${Math.round((Date.now()-start)/1000)} 秒内授权`)
    return data.access_token
  }

  // --------------- Main Flow ---------------
  private async performLoginFlow(page: Page, email: string, password: string) {
    await this.inputEmail(page, email)
    await this.bot.utils.wait(1000)
    await this.bot.browser.utils.reloadBadPage(page)
    await this.bot.utils.wait(500)
    await this.tryRecoveryMismatchCheck(page, email)
    if (this.bot.compromisedModeActive && this.bot.compromisedReason === 'recovery-mismatch') {
      this.bot.log(this.bot.isMobile,'LOGIN','检测到恢复不匹配 – 在输入密码前停止','warn')
      return
    }
    // 如果存在本地化链接（法语/英语），尝试切换到密码
    await this.switchToPasswordLink(page)
    await this.inputPasswordOr2FA(page, password)
    if (this.bot.compromisedModeActive && this.bot.compromisedReason === 'sign-in-blocked') {
      this.bot.log(this.bot.isMobile, 'LOGIN', '检测到登录被阻止 — 停止。', 'warn')
      return
    }
    await this.checkAccountLocked(page)
    await this.awaitRewardsPortal(page)
  }

  // --------------- Input Steps ---------------
  private async inputEmail(page: Page, email: string) {
    const field = await page.waitForSelector(SELECTORS.emailInput, { timeout: 5000 }).catch(()=>null)
    if (!field) { this.bot.log(this.bot.isMobile, 'LOGIN', '邮箱字段不存在', 'warn'); return }
    const prefilled = await page.waitForSelector('#userDisplayName', { timeout: 1500 }).catch(()=>null)
    if (!prefilled) {
      await page.fill(SELECTORS.emailInput, '')
      await page.fill(SELECTORS.emailInput, email)
    } else {
      this.bot.log(this.bot.isMobile, 'LOGIN', '邮箱已预填')
    }
    const next = await page.waitForSelector(SELECTORS.submitBtn, { timeout: 2000 }).catch(()=>null)
    if (next) { await next.click().catch(()=>{}); this.bot.log(this.bot.isMobile, 'LOGIN', '已提交邮箱') }
  }

  private async inputPasswordOr2FA(page: Page, password: string) {
    // 某些流程需要先切换到密码
    const switchBtn = await page.waitForSelector('#idA_PWD_SwitchToPassword', { timeout: 1500 }).catch(()=>null)
    if (switchBtn) { await switchBtn.click().catch(()=>{}); await this.bot.utils.wait(1000) }

    // 罕见流程：方法列表 -> 选择密码
    const passwordField = await page.waitForSelector(SELECTORS.passwordInput, { timeout: 4000 }).catch(()=>null)
    if (!passwordField) {
      const blocked = await this.detectSignInBlocked(page)
      if (blocked) return

      // 记录我们正在处理"获取代码登录"流程
      this.bot.log(this.bot.isMobile, 'LOGIN', '尝试处理"获取代码登录"流程')

      // 首先尝试处理"其他登录方式"流程
      const otherWaysHandled = await this.handleOtherWaysToSignIn(page)
      if (otherWaysHandled) {
        // 点击"其他方式"后再次尝试查找密码字段
        const passwordFieldAfter = await page.waitForSelector(SELECTORS.passwordInput, { timeout: 3000 }).catch(()=>null)
        if (passwordFieldAfter) {
          this.bot.log(this.bot.isMobile, 'LOGIN', '在"其他方式"流程后找到密码字段')
          await page.fill(SELECTORS.passwordInput, '')
          await page.fill(SELECTORS.passwordInput, password)
          const submit = await page.waitForSelector(SELECTORS.submitBtn, { timeout: 2000 }).catch(()=>null)
          if (submit) { await submit.click().catch(()=>{}); this.bot.log(this.bot.isMobile, 'LOGIN', '密码已提交') }
          return
        }
      }

      // 如果仍然没有密码字段 -> 可能是首先使用2FA（审批）
      this.bot.log(this.bot.isMobile, 'LOGIN', '密码字段不存在 — 调用2FA处理程序', 'warn')
      await this.handle2FA(page)
      return
    }

    const blocked = await this.detectSignInBlocked(page)
    if (blocked) return

    await page.fill(SELECTORS.passwordInput, '')
    await page.fill(SELECTORS.passwordInput, password)
    const submit = await page.waitForSelector(SELECTORS.submitBtn, { timeout: 2000 }).catch(()=>null)
    if (submit) { await submit.click().catch(()=>{}); this.bot.log(this.bot.isMobile, 'LOGIN', '密码已提交') }
  }


  // --------------- Other Ways to Sign In Handling ---------------
  private async handleOtherWaysToSignIn(page: Page): Promise<boolean> {
    try {
      // 查找"其他登录方式" - 通常是一个role="button"的span
      const otherWaysSelectors = [
        'span[role="button"]:has-text("Other ways to sign in")',
        'span:has-text("Other ways to sign in")',
        'button:has-text("Other ways to sign in")',
        'a:has-text("Other ways to sign in")',
        'div[role="button"]:has-text("Other ways to sign in")'
      ]

      let clicked = false
      for (const selector of otherWaysSelectors) {
        const element = await page.waitForSelector(selector, { timeout: 1000 }).catch(() => null)
        if (element && await element.isVisible().catch(() => false)) {
          await element.click().catch(() => {})
          this.bot.log(this.bot.isMobile, 'LOGIN', '点击了"其他登录方式"')
          await this.bot.utils.wait(2000) // 等待选项出现
          clicked = true
          break
        }
      }

      if (!clicked) {
        return false
      }

      // 现在查找"使用您的密码"选项
      const usePasswordSelectors = [
        'span[role="button"]:has-text("Use your password")',
        'span:has-text("Use your password")',
        'button:has-text("Use your password")',
        'button:has-text("Password")',
        'a:has-text("Use your password")',
        'div[role="button"]:has-text("Use your password")',
        'div[role="button"]:has-text("Password")'
      ]

      for (const selector of usePasswordSelectors) {
        const element = await page.waitForSelector(selector, { timeout: 1500 }).catch(() => null)
        if (element && await element.isVisible().catch(() => false)) {
          await element.click().catch(() => {})
          this.bot.log(this.bot.isMobile, 'LOGIN', '点击了"使用您的密码"')
          await this.bot.utils.wait(2000) // 等待密码字段出现
          return true
        }
      }

      return false

    } catch (error) {
      this.bot.log(this.bot.isMobile, 'LOGIN', 'handleOtherWaysToSignIn中的错误: ' + error, 'warn')
      return false
    }
  }

  // --------------- 2FA Handling ---------------
  private async handle2FA(page: Page) {
    try {
      // 检查2FA之前关闭任何弹窗/对话框（条款更新等）
      await this.bot.browser.utils.tryDismissAllMessages(page)
      await this.bot.utils.wait(500)

      if (this.currentTotpSecret) {
        const totpSelector = await this.ensureTotpInput(page)
        if (totpSelector) {
          await this.submitTotpCode(page, totpSelector)
          return
        }
      }

      const number = await this.fetchAuthenticatorNumber(page)
      if (number) { await this.approveAuthenticator(page, number); return }
      await this.handleSMSOrTotp(page)
    } catch (e) {
      this.bot.log(this.bot.isMobile, 'LOGIN', '2FA 错误: ' + e, 'warn')
    }
  }

  private async fetchAuthenticatorNumber(page: Page): Promise<string | null> {
    try {
      const el = await page.waitForSelector('#displaySign, div[data-testid="displaySign"]>span', { timeout: 2500 })
      return (await el.textContent())?.trim() || null
    } catch {
      // 并行模式下尝试重新发送循环
      if (this.bot.config.parallel) {
        this.bot.log(this.bot.isMobile, 'LOGIN', '并行模式: 限制验证器推送请求', 'log', 'yellow')
        for (let attempts = 0; attempts < 6; attempts++) { // 最多6分钟重试窗口
          const resend = await page.waitForSelector('button[aria-describedby="pushNotificationsTitle errorDescription"]', { timeout: 1500 }).catch(()=>null)
          if (!resend) break
          await this.bot.utils.wait(60000)
          await resend.click().catch(()=>{})
        }
      }
      await page.click('button[aria-describedby="confirmSendTitle"]').catch(()=>{})
      await this.bot.utils.wait(1500)
      try {
        const el = await page.waitForSelector('#displaySign, div[data-testid="displaySign"]>span', { timeout: 2000 })
        return (await el.textContent())?.trim() || null
      } catch { return null }
    }
  }

  private async approveAuthenticator(page: Page, numberToPress: string) {
    for (let cycle = 0; cycle < 6; cycle++) { // 最多~6次刷新周期
      try {
        this.bot.log(this.bot.isMobile, 'LOGIN', `在验证器中批准登录 (按 ${numberToPress})`)
        await page.waitForSelector('form[name="f1"]', { state: 'detached', timeout: 60000 })
        this.bot.log(this.bot.isMobile, 'LOGIN', '验证器批准成功')
        return
      } catch {
        this.bot.log(this.bot.isMobile, 'LOGIN', '验证器代码已过期 – 正在刷新')
        const retryBtn = await page.waitForSelector(SELECTORS.passkeyPrimary, { timeout: 3000 }).catch(()=>null)
        if (retryBtn) await retryBtn.click().catch(()=>{})
        const refreshed = await this.fetchAuthenticatorNumber(page)
        if (!refreshed) { this.bot.log(this.bot.isMobile, 'LOGIN', '无法刷新验证器代码', 'warn'); return }
        numberToPress = refreshed
      }
    }
    this.bot.log(this.bot.isMobile,'LOGIN','验证器批准循环已退出（达到最大周期）','warn')
  }

  private async handleSMSOrTotp(page: Page) {
    // TOTP自动输入（如果ensureTotpInput需要更长时间则为第二次机会）
    if (this.currentTotpSecret) {
      try {
        const totpSelector = await this.ensureTotpInput(page)
        if (totpSelector) {
          await this.submitTotpCode(page, totpSelector)
          return
        }
      } catch {/* ignore */}
    }

    // 手动提示，定期页面检查
    this.bot.log(this.bot.isMobile, 'LOGIN', '等待用户2FA代码（短信/邮箱/应用回退）')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    
    // 等待用户输入时监控页面变化
    let userInput: string | null = null
    let checkInterval: NodeJS.Timeout | null = null
    
    try {
      const inputPromise = new Promise<string>(res => {
        rl.question('输入2FA代码:\n', ans => {
          if (checkInterval) clearInterval(checkInterval)
          rl.close()
          res(ans.trim())
        })
      })

      // 每2秒钟检查一次用户是否手动跳过对话框
      checkInterval = setInterval(async () => {
        try {
          await this.bot.browser.utils.tryDismissAllMessages(page)
          // 检查是否不再在2FA页面上
          const still2FA = await page.locator('input[name="otc"]').first().isVisible({ timeout: 500 }).catch(() => false)
          if (!still2FA) {
            this.bot.log(this.bot.isMobile, 'LOGIN', '2FA等待期间页面已更改（用户可能已点击"下一步"）', 'warn')
            if (checkInterval) clearInterval(checkInterval)
            rl.close()
            userInput = 'skip' // 跳过提交的信号
          }
        } catch {/* ignore */}
      }, 2000)

      const code = await inputPromise
      
      if (code === 'skip' || userInput === 'skip') {
        this.bot.log(this.bot.isMobile, 'LOGIN', '跳过2FA代码提交（页面已前进）')
        return
      }

      await page.fill('input[name="otc"]', code)
      await page.keyboard.press('Enter')
      this.bot.log(this.bot.isMobile, 'LOGIN', '2FA代码已提交')
    } finally {
      // 确保即使发生错误也执行清理
      if (checkInterval) clearInterval(checkInterval)
      try { rl.close() } catch {/* ignore */}
    }
  }

  private async ensureTotpInput(page: Page): Promise<string | null> {
    const selector = await this.findFirstVisibleSelector(page, this.totpInputSelectors())
    if (selector) return selector

    const attempts = 4
    for (let i = 0; i < attempts; i++) {
      let acted = false

      // 步骤1：如果隐藏则显示替代验证选项
      if (!acted) {
        acted = await this.clickFirstVisibleSelector(page, this.totpAltOptionSelectors())
        if (acted) await this.bot.utils.wait(900)
      }

      // 步骤2：如果可用则选择验证器代码选项
      if (!acted) {
        acted = await this.clickFirstVisibleSelector(page, this.totpChallengeSelectors())
        if (acted) await this.bot.utils.wait(900)
      }

      const ready = await this.findFirstVisibleSelector(page, this.totpInputSelectors())
      if (ready) return ready

      if (!acted) break
    }

    return null
  }

  private async submitTotpCode(page: Page, selector: string) {
    try {
      const code = generateTOTP(this.currentTotpSecret!.trim())
      const input = page.locator(selector).first()
      if (!await input.isVisible().catch(()=>false)) {
        this.bot.log(this.bot.isMobile, 'LOGIN', 'TOTP输入意外隐藏', 'warn')
        return
      }
      await input.fill('')
      await input.fill(code)
      // 使用统一选择器系统
      const submit = await this.findFirstVisibleLocator(page, Login.TOTP_SELECTORS.submit)
      if (submit) {
        await submit.click().catch(()=>{})
      } else {
        await page.keyboard.press('Enter').catch(()=>{})
      }
      this.bot.log(this.bot.isMobile, 'LOGIN', '自动提交TOTP')
    } catch (error) {
      this.bot.log(this.bot.isMobile, 'LOGIN', '自动提交TOTP失败: ' + error, 'warn')
    }
  }

  // 统一选择器系统 - DRY原则
  private static readonly TOTP_SELECTORS = {
    input: [
      'input[name="otc"]',
      '#idTxtBx_SAOTCC_OTC',
      '#idTxtBx_SAOTCS_OTC',
      'input[data-testid="otcInput"]',
      'input[autocomplete="one-time-code"]',
      'input[type="tel"][name="otc"]'
    ],
    altOptions: [
      '#idA_SAOTCS_ProofPickerChange',
      '#idA_SAOTCC_AlternateLogin',
      'a:has-text("Use a different verification option")',
      'a:has-text("Sign in another way")',
      'a:has-text("I can\'t use my Microsoft Authenticator app right now")',
      'button:has-text("Use a different verification option")',
      'button:has-text("Sign in another way")'
    ],
    challenge: [
      '[data-value="PhoneAppOTP"]',
      '[data-value="OneTimeCode"]',
      'button:has-text("Use a verification code")',
      'button:has-text("Enter code manually")',
      'button:has-text("Enter a code from your authenticator app")',
      'button:has-text("Use code from your authentication app")',
      'button:has-text("Utiliser un code de vérification")',
      'button:has-text("Utiliser un code de verification")',
      'button:has-text("Entrer un code depuis votre application")',
      'button:has-text("Entrez un code depuis votre application")',
      'button:has-text("Entrez un code")',
      'div[role="button"]:has-text("Use a verification code")',
      'div[role="button"]:has-text("Enter a code")'
    ],
    submit: [
      '#idSubmit_SAOTCC_Continue',
      '#idSubmit_SAOTCC_OTC',
      'button[type="submit"]:has-text("Verify")',
      'button[type="submit"]:has-text("Continuer")',
      'button:has-text("Verify")',
      'button:has-text("Continuer")',
      'button:has-text("Submit")'
    ]
  } as const

  private totpInputSelectors(): readonly string[] { return Login.TOTP_SELECTORS.input }
  private totpAltOptionSelectors(): readonly string[] { return Login.TOTP_SELECTORS.altOptions }
  private totpChallengeSelectors(): readonly string[] { return Login.TOTP_SELECTORS.challenge }

  // 通用选择器查找器 - 将3个函数的重复减少到1个
  private async findFirstVisibleSelector(page: Page, selectors: readonly string[]): Promise<string | null> {
    for (const sel of selectors) {
      const loc = page.locator(sel).first()
      if (await loc.isVisible().catch(() => false)) return sel
    }
    return null
  }

  private async clickFirstVisibleSelector(page: Page, selectors: readonly string[]): Promise<boolean> {
    for (const sel of selectors) {
      const loc = page.locator(sel).first()
      if (await loc.isVisible().catch(() => false)) {
        await loc.click().catch(()=>{})
        return true
      }
    }
    return false
  }

  private async findFirstVisibleLocator(page: Page, selectors: readonly string[]): Promise<Locator | null> {
    for (const sel of selectors) {
      const loc = page.locator(sel).first()
      if (await loc.isVisible().catch(() => false)) return loc
    }
    return null
  }

  private async waitForRewardsRoot(page: Page, timeoutMs: number): Promise<string | null> {
    const selectors = [
      'html[data-role-name="RewardsPortal"]',
      'html[data-role-name*="RewardsPortal"]',
      'body[data-role-name*="RewardsPortal"]',
      '[data-role-name*="RewardsPortal"]',
      '[data-bi-name="rewards-dashboard"]',
      'main[data-bi-name="dashboard"]',
      '#more-activities',
      '#dashboard'
    ]

    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      for (const sel of selectors) {
        const loc = page.locator(sel).first()
        if (await loc.isVisible().catch(()=>false)) {
          return sel
        }
      }
      await this.bot.utils.wait(350)
    }
    return null
  }

  // --------------- Verification / State ---------------
  private async awaitRewardsPortal(page: Page) {
    const start = Date.now()
    while (Date.now() - start < DEFAULT_TIMEOUTS.loginMaxMs) {
      await this.handlePasskeyPrompts(page, 'main')
      const u = new URL(page.url())
      const isRewardsHost = u.hostname === LOGIN_TARGET.host
      const isKnownPath = u.pathname === LOGIN_TARGET.path
        || u.pathname === '/dashboard'
        || u.pathname === '/rewardsapp/dashboard'
        || u.pathname.startsWith('/?')
      if (isRewardsHost && isKnownPath) break
      await this.bot.utils.wait(1000)
    }

    const portalSelector = await this.waitForRewardsRoot(page, 8000)
    if (!portalSelector) {
      try {
        await this.bot.browser.func.goHome(page)
      } catch {/* ignore fallback errors */}

      const fallbackSelector = await this.waitForRewardsRoot(page, 6000)
      if (!fallbackSelector) {
        throw this.bot.log(this.bot.isMobile, 'LOGIN', '导航后缺少门户根元素', 'error')
      }
      this.bot.log(this.bot.isMobile, 'LOGIN', `通过回退到达奖励门户 (${fallbackSelector})`)
      return
    }

    this.bot.log(this.bot.isMobile, 'LOGIN', `到达奖励门户 (${portalSelector})`)
  }

  private async verifyBingContext(page: Page) {
    try {
      this.bot.log(this.bot.isMobile, 'LOGIN-BING', '验证Bing认证上下文')
      await page.goto('https://www.bing.com/fd/auth/signin?action=interactive&provider=windows_live_id&return_url=https%3A%2F%2Fwww.bing.com%2F')
      for (let i=0;i<5;i++) {
        const u = new URL(page.url())
        if (u.hostname === 'www.bing.com' && u.pathname === '/') {
          await this.bot.browser.utils.tryDismissAllMessages(page)
          const ok = await page.waitForSelector('#id_n', { timeout: 3000 }).then(()=>true).catch(()=>false)
          if (ok || this.bot.isMobile) { this.bot.log(this.bot.isMobile,'LOGIN-BING','Bing验证通过'); break }
        }
        await this.bot.utils.wait(1000)
      }
    } catch (e) {
      this.bot.log(this.bot.isMobile, 'LOGIN-BING', 'Bing验证错误: '+e, 'warn')
    }
  }

  private async checkAccountLocked(page: Page) {
    const locked = await page.waitForSelector('#serviceAbuseLandingTitle', { timeout: 1200 }).then(()=>true).catch(()=>false)
    if (locked) throw this.bot.log(this.bot.isMobile,'CHECK-LOCKED','账户被Microsoft锁定（serviceAbuseLandingTitle）','error')
  }

  // --------------- Passkey / Dialog Handling ---------------
  private async handlePasskeyPrompts(page: Page, context: 'main' | 'oauth') {
    let did = false
    // 视频启发式
    const biometric = await page.waitForSelector(SELECTORS.biometricVideo, { timeout: 500 }).catch(()=>null)
    if (biometric) {
      const btn = await page.$(SELECTORS.passkeySecondary)
      if (btn) { await btn.click().catch(()=>{}); did = true; this.logPasskeyOnce('video heuristic') }
    }
    if (!did) {
      const titleEl = await page.waitForSelector(SELECTORS.passkeyTitle, { timeout: 500 }).catch(()=>null)
      const secBtn = await page.waitForSelector(SELECTORS.passkeySecondary, { timeout: 500 }).catch(()=>null)
      const primBtn = await page.waitForSelector(SELECTORS.passkeyPrimary, { timeout: 500 }).catch(()=>null)
      const title = (titleEl ? (await titleEl.textContent()) : '')?.trim() || ''
      const looksLike = /sign in faster|passkey|fingerprint|face|pin/i.test(title)
      if (looksLike && secBtn) { await secBtn.click().catch(()=>{}); did = true; this.logPasskeyOnce('title heuristic '+title) }
      else if (!did && secBtn && primBtn) {
        const text = (await secBtn.textContent()||'').trim()
        if (/skip for now/i.test(text)) { await secBtn.click().catch(()=>{}); did = true; this.logPasskeyOnce('secondary button text') }
      }
      if (!did) {
        const textBtn = await page.locator('xpath=//button[contains(normalize-space(.),"Skip for now")]').first()
        if (await textBtn.isVisible().catch(()=>false)) { await textBtn.click().catch(()=>{}); did = true; this.logPasskeyOnce('text fallback') }
      }
      if (!did) {
        const close = await page.$('#close-button')
        if (close) { await close.click().catch(()=>{}); did = true; this.logPasskeyOnce('close button') }
      }
    }

    // KMSI提示
    const kmsi = await page.waitForSelector(SELECTORS.kmsiVideo, { timeout: 400 }).catch(()=>null)
    if (kmsi) {
      const yes = await page.$(SELECTORS.passkeyPrimary)
      if (yes) { await yes.click().catch(()=>{}); did = true; this.bot.log(this.bot.isMobile,'LOGIN-KMSI','Accepted KMSI prompt') }
    }

    if (!did && context === 'main') {
      this.noPromptIterations++
      const now = Date.now()
      if (this.noPromptIterations === 1 || now - this.lastNoPromptLog > 10000) {
        this.lastNoPromptLog = now
        this.bot.log(this.bot.isMobile,'LOGIN-NO-PROMPT',`No dialogs (x${this.noPromptIterations})`)
        if (this.noPromptIterations > 50) this.noPromptIterations = 0
      }
    } else if (did) {
      this.noPromptIterations = 0
    }
  }

  private logPasskeyOnce(reason: string) {
    if (this.passkeyHandled) return
    this.passkeyHandled = true
    this.bot.log(this.bot.isMobile,'LOGIN-PASSKEY',`Dismissed passkey prompt (${reason})`)
  }

  // --------------- Security Detection ---------------
  private async detectSignInBlocked(page: Page): Promise<boolean> {
    if (this.bot.compromisedModeActive && this.bot.compromisedReason === 'sign-in-blocked') return true
    try {
      let text = ''
      for (const sel of ['[data-testid="title"]','h1','div[role="heading"]','div.text-title']) {
        const el = await page.waitForSelector(sel, { timeout: 600 }).catch(()=>null)
        if (el) {
          const t = (await el.textContent()||'').trim()
          if (t && t.length < 300) text += ' '+t
        }
      }
      const lower = text.toLowerCase()
      let matched: string | null = null
      for (const p of SIGN_IN_BLOCK_PATTERNS) { if (p.re.test(lower)) { matched = p.label; break } }
      if (!matched) return false
      const email = this.bot.currentAccountEmail || 'unknown'
      const docsUrl = this.getDocsUrl('we-cant-sign-you-in')
      const incident: SecurityIncident = {
        kind: '我们无法登录（被阻止）',
        account: email,
        details: [matched ? `模式: ${matched}` : '模式: 未知'],
        next: ['继续前需要手动恢复'],
        docsUrl
      }
      await this.sendIncidentAlert(incident,'warn')
      this.bot.compromisedModeActive = true
      this.bot.compromisedReason = 'sign-in-blocked'
      this.startCompromisedInterval()
      await this.bot.engageGlobalStandby('sign-in-blocked', email).catch(()=>{})
      // 打开安全文档以获取即时指导（尽力而为）
      await this.openDocsTab(page, docsUrl).catch(()=>{})
      return true
    } catch { return false }
  }

  private async tryRecoveryMismatchCheck(page: Page, email: string) { try { await this.detectAndHandleRecoveryMismatch(page, email) } catch {/* ignore */} }
  private async detectAndHandleRecoveryMismatch(page: Page, email: string) {
    try {
      const recoveryEmail: string | undefined = this.bot.currentAccountRecoveryEmail
      if (!recoveryEmail || !/@/.test(recoveryEmail)) return
      const accountEmail = email
      const parseRef = (val: string) => { const [l,d] = val.split('@'); return { local: l||'', domain:(d||'').toLowerCase(), prefix2:(l||'').slice(0,2).toLowerCase() } }
      const refs = [parseRef(recoveryEmail), parseRef(accountEmail)].filter(r=>r.domain && r.prefix2)
      if (refs.length === 0) return

      const candidates: string[] = []
      // 直接选择器（Microsoft变体+法语span）
      const sel = '[data-testid="recoveryEmailHint"], #recoveryEmail, [id*="ProofEmail"], [id*="EmailProof"], [data-testid*="Email"], span:has(span.fui-Text)'
      const el = await page.waitForSelector(sel, { timeout: 1500 }).catch(()=>null)
      if (el) { const t = (await el.textContent()||'').trim(); if (t) candidates.push(t) }

      // 列表项
      const li = page.locator('[role="listitem"], li')
      const liCount = await li.count().catch(()=>0)
      for (let i=0;i<liCount && i<12;i++) { const t = (await li.nth(i).textContent().catch(()=>''))?.trim()||''; if (t && /@/.test(t)) candidates.push(t) }

      // XPath通用掩码模式
      const xp = page.locator('xpath=//*[contains(normalize-space(.), "@") and (contains(normalize-space(.), "*") or contains(normalize-space(.), "•"))]')
      const xpCount = await xp.count().catch(()=>0)
      for (let i=0;i<xpCount && i<12;i++) { const t = (await xp.nth(i).textContent().catch(()=>''))?.trim()||''; if (t && t.length<300) candidates.push(t) }

      // 标准化
      const seen = new Set<string>()
      const norm = (s:string)=>s.replace(/\s+/g,' ').trim()
  const uniq = candidates.map(norm).filter(t=>t && !seen.has(t) && seen.add(t))
      // 掩码过滤器
      let masked = uniq.filter(t=>/@/.test(t) && /[*•]/.test(t))

      if (masked.length === 0) {
        // 回退完整HTML扫描
        try {
          const html = await page.content()
          const generic = /[A-Za-z0-9]{1,4}[*•]{2,}[A-Za-z0-9*•._-]*@[A-Za-z0-9.-]+/g
          const frPhrase = /Nous\s+enverrons\s+un\s+code\s+à\s+([^<@]*[A-Za-z0-9]{1,4}[*•]{2,}[A-Za-z0-9*•._-]*@[A-Za-z0-9.-]+)[^.]{0,120}?Pour\s+vérifier/gi
          const found = new Set<string>()
          let m: RegExpExecArray | null
          while ((m = generic.exec(html)) !== null) found.add(m[0])
          while ((m = frPhrase.exec(html)) !== null) { const raw = m[1]?.replace(/<[^>]+>/g,'').trim(); if (raw) found.add(raw) }
          if (found.size > 0) masked = Array.from(found)
        } catch {/* ignore */}
      }
      if (masked.length === 0) return

      // 优先选择提及邮箱/地址的
      const preferred = masked.find(t=>/email|courriel|adresse|mail/i.test(t)) || masked[0]!
      // 提取掩码邮箱：Microsoft有时只显示第一个字符（k*****@domain）或两个字符（ko*****@domain）。
      // 我们只比较（1或2个）前导可见字母数字字符+完整域名（不区分大小写）。
      // 这避免了显示掩码隐藏第2个字符时的误报。
      const maskRegex = /([a-zA-Z0-9]{1,2})[a-zA-Z0-9*•._-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
      const m = maskRegex.exec(preferred)
      // 回退：如果第一个正则表达式失败，尝试使用更宽松的模式
      const loose = !m ? /([a-zA-Z0-9])[*•][a-zA-Z0-9*•._-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(preferred) : null
      const use = m || loose
      const extracted = use ? use[0] : preferred
      const extractedLower = extracted.toLowerCase()
  let observedPrefix = ((use && use[1]) ? use[1] : '').toLowerCase()
  let observedDomain = ((use && use[2]) ? use[2] : '').toLowerCase()
      if (!observedDomain && extractedLower.includes('@')) {
        const parts = extractedLower.split('@')
        observedDomain = parts[1] || ''
      }
      if (!observedPrefix && extractedLower.includes('@')) {
        const parts = extractedLower.split('@')
        observedPrefix = (parts[0] || '').replace(/[^a-z0-9]/gi,'').slice(0,2)
      }

      // 确定任何引用（recoveryEmail或accountEmail）是否匹配观察到的掩码逻辑
      const matchRef = refs.find(r => {
        if (r.domain !== observedDomain) return false
        // 如果只显示一个字符，只强制执行第一个字符；如果显示两个，则强制执行两个。
        if (observedPrefix.length === 1) {
          return r.prefix2.startsWith(observedPrefix)
        }
        return r.prefix2 === observedPrefix
      })

      if (!matchRef) {
        const docsUrl = this.getDocsUrl('recovery-email-mismatch')
        const incident: SecurityIncident = {
          kind:'Recovery email mismatch',
          account: email,
          details:[
            `掩码显示: ${preferred}`,
            `已提取: ${extracted}`,
            `观察到 => ${observedPrefix || '??'}**@${observedDomain || '??'}`,
            `期望 => ${refs.map(r=>`${r.prefix2}**@${r.domain}`).join(' OR ')}`
          ],
          next:[
            '自动化全局暂停（备用启用）。',
            '验证Microsoft设置中的账户安全和恢复电子邮件。',
            '如果更改是合法的，请在重启前更新accounts.json。'
          ],
          docsUrl
        }
        await this.sendIncidentAlert(incident,'critical')
        this.bot.compromisedModeActive = true
        this.bot.compromisedReason = 'recovery-mismatch'
        this.startCompromisedInterval()
        await this.bot.engageGlobalStandby('recovery-mismatch', email).catch(()=>{})
        await this.openDocsTab(page, docsUrl).catch(()=>{})
      } else {
        const mode = observedPrefix.length === 1 ? 'lenient' : 'strict'
        this.bot.log(this.bot.isMobile,'LOGIN-RECOVERY',`Recovery OK (${mode}): ${extracted} matches ${matchRef.prefix2}**@${matchRef.domain}`)
      }
    } catch {/* non-fatal */}
  }

  private async switchToPasswordLink(page: Page) {
    try {
      const link = await page.locator('xpath=//span[@role="button" and (contains(translate(normalize-space(.),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"use your password") or contains(translate(normalize-space(.),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"utilisez votre mot de passe"))]').first()
      if (await link.isVisible().catch(()=>false)) {
        await link.click().catch(()=>{})
        await this.bot.utils.wait(800)
        this.bot.log(this.bot.isMobile,'LOGIN','点击了"使用密码"链接')
      }
    } catch {/* ignore */}
  }

  // --------------- Incident Helpers ---------------
  private async sendIncidentAlert(incident: SecurityIncident, severity: 'warn'|'critical'='warn') {
    const lines = [ `[Incident] ${incident.kind}`, `Account: ${incident.account}` ]
    if (incident.details?.length) lines.push(`Details: ${incident.details.join(' | ')}`)
    if (incident.next?.length) lines.push(`Next: ${incident.next.join(' -> ')}`)
    if (incident.docsUrl) lines.push(`文档: ${incident.docsUrl}`)
    const level: 'warn'|'error' = severity === 'critical' ? 'error' : 'warn'
    this.bot.log(this.bot.isMobile,'SECURITY',lines.join(' | '), level)
    try {
      const { ConclusionWebhook } = await import('../util/ConclusionWebhook')
      const fields = [
        { name: 'Account', value: incident.account },
        ...(incident.details?.length ? [{ name: '详情', value: incident.details.join('\n') }] : []),
        ...(incident.next?.length ? [{ name: '下一步', value: incident.next.join('\n') }] : []),
        ...(incident.docsUrl ? [{ name: '文档', value: incident.docsUrl }] : [])
      ]
      await ConclusionWebhook(
        this.bot.config,
        `🔐 ${incident.kind}`,
        '_Security check by @Light_',
        fields,
        severity === 'critical' ? 0xFF0000 : 0xFFAA00
      )
    } catch {/* ignore */}
  }

  private getDocsUrl(anchor?: string) {
    const base = process.env.DOCS_BASE?.trim() || 'https://github.com/LightZirconite/Microsoft-Rewards-Script-Private/blob/v2/docs/security.md'
    const map: Record<string,string> = {
      'recovery-email-mismatch':'#recovery-email-mismatch',
      'we-cant-sign-you-in':'#we-cant-sign-you-in-blocked'
    }
    return anchor && map[anchor] ? `${base}${map[anchor]}` : base
  }

  private startCompromisedInterval() {
    if (this.compromisedInterval) clearInterval(this.compromisedInterval)
    this.compromisedInterval = setInterval(()=>{
      try { this.bot.log(this.bot.isMobile,'SECURITY','账户处于安全待机状态。在继续之前进行审查。安全检查由 @Light 提供','warn') } catch {/* ignore */}
    }, 5*60*1000)
  }


  private async openDocsTab(page: Page, url: string) {
    try {
      const ctx = page.context()
      const tab = await ctx.newPage()
      await tab.goto(url, { waitUntil: 'domcontentloaded' })
    } catch {/* ignore */}
  }

  // --------------- Infrastructure ---------------
  private async disableFido(page: Page) {
    await page.route('**/GetCredentialType.srf*', route => {
      try {
        const body = JSON.parse(route.request().postData() || '{}')
        body.isFidoSupported = false
        route.continue({ postData: JSON.stringify(body) })
      } catch { route.continue() }
    }).catch(()=>{})
  }
}
