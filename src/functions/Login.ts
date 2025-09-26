import { Page } from 'rebrowser-playwright'
// import type { Page } from 'playwright'
import readline from 'readline'
import * as crypto from 'crypto'
import { AxiosRequestConfig } from 'axios'

import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'

import { OAuth } from '../interface/OAuth'


const rl = readline.createInterface({
    // Use as any to avoid strict typing issues with our minimal process shim
    input: (process as any).stdin,
    output: (process as any).stdout
})

export class Login {
    private bot: MicrosoftRewardsBot
    private clientId: string = '0000000040170455'
    private authBaseUrl: string = 'https://login.live.com/oauth20_authorize.srf'
    private redirectUrl: string = 'https://login.live.com/oauth20_desktop.srf'
    private tokenUrl: string = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
    private scope: string = 'service::prod.rewardsplatform.microsoft.com::MBI_SSL'
    // Flag to prevent spamming passkey logs after first handling
    private passkeyHandled: boolean = false
    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async login(page: Page, email: string, password: string) {

        try {
            this.bot.log(this.bot.isMobile, '登录', '开始登录流程!')
            
            // Navigate to the Bing login page
            await page.goto('https://rewards.bing.com/signin')

            // Disable FIDO support in login request
            await page.route('**/GetCredentialType.srf*', (route: any) => {
                const body = JSON.parse(route.request().postData() || '{}')
                body.isFidoSupported = false
                route.continue({ postData: JSON.stringify(body) })
            })

            await page.waitForLoadState('domcontentloaded').catch(() => { })

            await this.bot.browser.utils.reloadBadPage(page)

            // Check if account is locked
            await this.checkAccountLocked(page)

            const isLoggedIn = await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 20000 }).then(() => true).catch(() => false)

            if (!isLoggedIn) {
                await this.execLogin(page, email, password)
                this.bot.log(this.bot.isMobile, '登录', '成功登录微软')
            } else {
                this.bot.log(this.bot.isMobile, '登录', '已登录')

                // Check if account is locked
                await this.checkAccountLocked(page)
            }

            // Check if logged in to bing
            await this.checkBingLogin(page)

            // Save session
            await saveSessionData(this.bot.config.sessionPath, page.context(), email, this.bot.isMobile)

            // We're done logging in
            this.bot.log(this.bot.isMobile, '登录', '成功登录，已保存登录会话!')

        } catch (error) {
            // Throw and don't continue
            throw this.bot.log(this.bot.isMobile, '登录', '发生错误: ' + error, 'error')
        }
    }

    private async execLogin(page: Page, email: string, password: string) {
        try {
            await this.enterEmail(page, email)
            await this.bot.utils.waitRandom(2000,5000, 'normal')
            await this.bot.browser.utils.reloadBadPage(page)
            await this.bot.utils.waitRandom(2000,5000, 'normal')
            await this.enterPassword(page, password)
            await this.bot.utils.waitRandom(2000,5000, 'normal')

            // Check if account is locked
            await this.checkAccountLocked(page)

            await this.bot.browser.utils.reloadBadPage(page)
            await this.checkLoggedIn(page)
        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', '发生错误: ' + error, 'error')
        }
    }

    private async enterEmail(page: Page, email: string) {
        const emailInputSelector = 'input[type="email"]'

        try {
            // Wait for email field
            const emailField = await page.waitForSelector(emailInputSelector, { state: 'visible', timeout: 2000 }).catch(() => null)
            if (!emailField) {
                this.bot.log(this.bot.isMobile, '登录', '未找到邮箱字段', 'warn')
                return
            }

            await this.bot.utils.waitRandom(1000,4000, 'normal')

            // Check if email is prefilled
            const emailPrefilled = await page.waitForSelector('#userDisplayName', { timeout: 5000 }).catch(() => null)
            if (emailPrefilled) {
                this.bot.log(this.bot.isMobile, '登录', '微软已预填邮箱')
            } else {
                // 模拟人类逐字符输入邮箱
            await page.fill(emailInputSelector, '')
            await this.bot.utils.waitRandom(500,2000)
            await page.focus(emailInputSelector);
            for (const char of email) {
                await page.keyboard.type(char);
                await this.bot.utils.waitRandom(50, 200); // 字符间随机延迟
            }
            await this.bot.utils.waitRandom(1000,4000, 'normal')
            }

            const nextButton = await page.waitForSelector('button[type="submit"]', { timeout: 2000 }).catch(() => null)
            if (nextButton) {
                await nextButton.click()
                await this.bot.utils.waitRandom(2000,5000)
                this.bot.log(this.bot.isMobile, '登录', '邮箱输入成功')
            } else {
                this.bot.log(this.bot.isMobile, '登录', '输入邮箱后未找到下一步按钮', 'warn')
            }

        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `邮箱输入失败: ${error}`, 'error')
        }
    }

    private async enterPassword(page: Page, password: string) {
        const passwordInputSelector = 'input[type="password"]'
        const skip2FASelector = '#idA_PWD_SwitchToPassword';
        try {
            const skip2FAButton = await page.waitForSelector(skip2FASelector, { timeout: 2000 }).catch(() => null)
            if (skip2FAButton) {
                await skip2FAButton.click()
                await this.bot.utils.wait(2000)
                this.bot.log(this.bot.isMobile, 'LOGIN', 'Skipped 2FA')
            } else {
                this.bot.log(this.bot.isMobile, 'LOGIN', 'No 2FA skip button found, proceeding with password entry')
            }
            const viewFooter = await page.waitForSelector('#view > div > span:nth-child(6)', { timeout: 2000 }).catch(() => null)
            const passwordField1 = await page.waitForSelector(passwordInputSelector, { timeout: 5000 }).catch(() => null)
            if (viewFooter && !passwordField1) {
                this.bot.log(this.bot.isMobile, '登录', '通过 "viewFooter" 找到页面 "获取登录代码"')

                const otherWaysButton = await viewFooter.$('span[role="button"]')
                if (otherWaysButton) {
                    await otherWaysButton.click()
                    await this.bot.utils.waitRandom(5000,9000)

                    const secondListItem = page.locator('[role="listitem"]').nth(1)
                    if (await secondListItem.isVisible()) {
                        await secondListItem.click()
                    }

                }
            }

            // Wait for password field
            const passwordField = await page.waitForSelector(passwordInputSelector, { state: 'visible', timeout: 5000 }).catch(() => null)
            if (!passwordField) {
                this.bot.log(this.bot.isMobile, '登录', '未找到密码字段，可能需要双重身份验证（2FA）', 'warn')
                await this.handle2FA(page)
                return
            }

            await this.bot.utils.waitRandom(1000,4000)

            // 模拟人类逐字符输入密码
            await page.fill(passwordInputSelector, '')
            await this.bot.utils.waitRandom(500,2000)
            await page.focus(passwordInputSelector);
            for (const char of password) {
                await page.keyboard.type(char);
                await this.bot.utils.waitRandom(50, 250); // 字符间随机延迟
                // 偶尔模拟输入错误后修正
                if (Math.random() < 0.05) {
                    await page.keyboard.press('Backspace');
                    await this.bot.utils.waitRandom(300, 600);
                    await page.keyboard.type(char);
                    await this.bot.utils.waitRandom(50, 200);
                }
            }
            await this.bot.utils.waitRandom(1000,4000)

            const nextButton = await page.waitForSelector('button[type="submit"]', { timeout: 2000 }).catch(() => null)
            if (nextButton) {
                await nextButton.click()
                await this.bot.utils.waitRandom(2000,5000)
                this.bot.log(this.bot.isMobile, '登录', '密码输入成功')
            } else {
                this.bot.log(this.bot.isMobile, '登录', '输入密码后未找到下一步按钮', 'warn')
            }

        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `密码输入失败: ${error}`, 'error')
            await this.handle2FA(page)
        }
    }

    private async handle2FA(page: Page) {
        try {
            const numberToPress = await this.get2FACode(page)
            if (numberToPress) {
                // Authentictor App verification
                await this.authAppVerification(page, numberToPress)
            } else {
                // SMS verification
                await this.authSMSVerification(page)
            }
        } catch (error) {
            this.bot.log(this.bot.isMobile, '登录', `2FA 处理失败: ${error}`)
        }
    }

    private async get2FACode(page: Page): Promise<string | null> {
        try {
            const element = await page.waitForSelector('#displaySign, div[data-testid="displaySign"]>span', { state: 'visible', timeout: 2000 })
            return await element.textContent()
        } catch {
            if (this.bot.config.parallel) {
                this.bot.log(this.bot.isMobile, '登录', '脚本并行运行，每个账户一次只能发送 1 个 2FA 请求!', 'log', 'yellow')
                this.bot.log(this.bot.isMobile, '登录', '60 秒后重试! 请等待...', 'log', 'yellow')

                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const button = await page.waitForSelector('button[aria-describedby="pushNotificationsTitle errorDescription"]', { state: 'visible', timeout: 2000 }).catch(() => null)
                    if (button) {
                        await this.bot.utils.waitRandom(60000,80000)
                        await button.click()

                        continue
                    } else {
                        break
                    }
                }
            }

            await page.click('button[aria-describedby="confirmSendTitle"]').catch(() => { })
            await this.bot.utils.waitRandom(2000,5000)
            const element = await page.waitForSelector('#displaySign, div[data-testid="displaySign"]>span', { state: 'visible', timeout: 2000 })
            return await element.textContent()
        }
    }

    private async authAppVerification(page: Page, numberToPress: string | null) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                this.bot.log(this.bot.isMobile, '登录', `请在身份验证器应用上按下 ${numberToPress} 批准登录`)
                this.bot.log(this.bot.isMobile, '登录', '如果按错数字或点击 "拒绝" 按钮，请在 60 秒后重试')

                await page.waitForSelector('form[name="f1"]', { state: 'detached', timeout: 60000 })

                this.bot.log(this.bot.isMobile, '登录', '登录已成功批准!')
                break
            } catch {
                this.bot.log(this.bot.isMobile, '登录', '代码已过期。尝试获取新代码...')
                // await page.click('button[aria-describedby="pushNotificationsTitle errorDescription"]')
                const primaryButton = await page.waitForSelector('button[data-testid="primaryButton"]', { state: 'visible', timeout: 5000 }).catch(() => null)
                if (primaryButton) {
                    await primaryButton.click()
                }
                numberToPress = await this.get2FACode(page)
            }
        }
    }

    private async authSMSVerification(page: Page) {
        this.bot.log(this.bot.isMobile, '登录', '需要 SMS 2FA 代码。等待用户输入...')

        const code = await new Promise<string>((resolve) => {
            rl.question('请输入 2FA 代码:\n', (input: string) => {
                rl.close()
                resolve(input)
            })
        })

        await page.fill('input[name="otc"]', code)
        await page.keyboard.press('Enter')
        this.bot.log(this.bot.isMobile, '登录', '2FA 代码输入成功')
    }

    async getMobileAccessToken(page: Page, email: string) {
        const authorizeUrl = new URL(this.authBaseUrl)

        authorizeUrl.searchParams.append('response_type', 'code')
        authorizeUrl.searchParams.append('client_id', this.clientId)
        authorizeUrl.searchParams.append('redirect_uri', this.redirectUrl)
        authorizeUrl.searchParams.append('scope', this.scope)
        authorizeUrl.searchParams.append('state', crypto.randomBytes(16).toString('hex'))
        authorizeUrl.searchParams.append('access_type', 'offline_access')
        authorizeUrl.searchParams.append('login_hint', email)
        // 在 OAuth 流程中也禁用 FIDO（可减少通行密钥提示反复弹出）
        await page.route('**/GetCredentialType.srf*', (route: any) => {
            const body = JSON.parse(route.request().postData() || '{}')
            body.isFidoSupported = false
            route.continue({ postData: JSON.stringify(body) })
        }).catch(()=>{})
        await page.goto(authorizeUrl.href)

        let currentUrl = new URL(page.url())
        let code: string

        const authStart = Date.now()
        this.bot.log(this.bot.isMobile, 'APP 登录', '等待授权...')
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // Attempt to dismiss passkey/passkey-like screens quickly (non-blocking)
            await this.tryDismissPasskeyPrompt(page)
            if (currentUrl.hostname === 'login.live.com' && currentUrl.pathname === '/oauth20_desktop.srf') {
                code = currentUrl.searchParams.get('code')!
                break
            }

            currentUrl = new URL(page.url())
            // 缩短等待时间，以更快响应通行密钥提示
            await this.bot.utils.waitRandom(1000,3000)
        }

        const body = new URLSearchParams()
        body.append('grant_type', 'authorization_code')
        body.append('client_id', this.clientId)
        body.append('code', code)
        body.append('redirect_uri', this.redirectUrl)

        const tokenRequest: AxiosRequestConfig = {
            url: this.tokenUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: body.toString()
        }

        const tokenResponse = await this.bot.axios.request(tokenRequest)
        const tokenData: OAuth = await tokenResponse.data
        const authDuration = Date.now() - authStart
        this.bot.log(this.bot.isMobile, 'APP 登录', `授权成功 in ${Math.round(authDuration/1000)}s`)
        return tokenData.access_token
    }

    // Utils

    private async checkLoggedIn(page: Page) {
        const targetHostname = 'rewards.bing.com'
        const targetPathname = '/'

        // eslint-disable-next-line no-constant-condition
        while (true) {
            await this.dismissLoginMessages(page)
            const currentURL = new URL(page.url())
            if (currentURL.hostname === targetHostname && currentURL.pathname === targetPathname) {
                break
            }
        }

        // Wait for login to complete
        await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 10000 })
        this.bot.log(this.bot.isMobile, '登录', '成功登录奖励门户')
    }

    private lastNoPromptLog: number = 0
    private noPromptIterations: number = 0
    private async dismissLoginMessages(page: Page) {
        let didSomething = false

        // PASSKEY / Windows Hello / Sign in faster
        const passkeyVideo = await page.waitForSelector('[data-testid="biometricVideo"]', { timeout: 1000 }).catch(() => null)
        if (passkeyVideo) {
            const skipButton = await page.$('button[data-testid="secondaryButton"]')
            if (skipButton) {
                await skipButton.click().catch(()=>{})
                if (!this.passkeyHandled) {
                    this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', '检测到通行密钥对话框（通过视频启发式判断）→ 已点击“暂时跳过”')
                }
                this.passkeyHandled = true
                await page.waitForTimeout(300)
                didSomething = true
            }
        }
        if (!didSomething) {
            const titleEl = await page.waitForSelector('[data-testid="title"]', { timeout: 800 }).catch(() => null)
            const titleText = (titleEl ? (await titleEl.textContent()) : '')?.trim() || ''
            const looksLikePasskey = /sign in faster|passkey|fingerprint|face|pin/i.test(titleText)
            const secondaryBtn = await page.waitForSelector('button[data-testid="secondaryButton"]', { timeout: 500 }).catch(() => null)
            const primaryBtn = await page.waitForSelector('button[data-testid="primaryButton"]', { timeout: 500 }).catch(() => null)
            if (looksLikePasskey && secondaryBtn) {
                await secondaryBtn.click().catch(()=>{})
                if (!this.passkeyHandled) {
                    this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', `Passkey dialog detected (title: "${titleText}") -> clicked secondary`)
                }
                this.passkeyHandled = true
                await page.waitForTimeout(300)
                didSomething = true
            } else if (!didSomething && secondaryBtn && primaryBtn) {
                const secText = (await secondaryBtn.textContent() || '').trim()
                if (/skip for now/i.test(secText)) {
                    await secondaryBtn.click().catch(()=>{})
                    if (!this.passkeyHandled) {
                        this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', 'Passkey dialog (pair heuristic) -> clicked secondary (Skip for now)')
                    }
                    this.passkeyHandled = true
                    await page.waitForTimeout(300)
                    didSomething = true
                }
            }
            if (!didSomething) {
                const skipByText = await page.locator('xpath=//button[contains(normalize-space(.), "Skip for now")]').first()
                if (await skipByText.isVisible().catch(()=>false)) {
                    await skipByText.click().catch(()=>{})
                    if (!this.passkeyHandled) {
                        this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', 'Passkey dialog (text fallback) -> clicked "Skip for now"')
                    }
                    this.passkeyHandled = true
                    await page.waitForTimeout(300)
                    didSomething = true
                }
            }
            if (!didSomething) {
                const closeBtn = await page.$('#close-button')
                if (closeBtn) {
                    await closeBtn.click().catch(()=>{})
                    if (!this.passkeyHandled) {
                        this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', 'Attempted close button on potential passkey modal')
                    }
                    this.passkeyHandled = true
                    await page.waitForTimeout(300)
                }
            }
        }

        // KMSI (Keep me signed in) prompt
        const kmsi = await page.waitForSelector('[data-testid="kmsiVideo"]', { timeout: 800 }).catch(()=>null)
        if (kmsi) {
            const yesButton = await page.$('button[data-testid="primaryButton"]')
            if (yesButton) {
                await yesButton.click().catch(()=>{})
                this.bot.log(this.bot.isMobile, 'LOGIN-KMSI', 'KMSI dialog detected -> accepted (Yes)')
                await page.waitForTimeout(300)
                didSomething = true
            }
        }

        if (!didSomething) {
            this.noPromptIterations++
            const now = Date.now()
            if (this.noPromptIterations === 1 || (now - this.lastNoPromptLog) > 10000) {
                this.lastNoPromptLog = now
                this.bot.log(this.bot.isMobile, 'LOGIN-NO-PROMPT', `No dialogs (x${this.noPromptIterations})`)
                // Reset counter if it grows large to keep number meaningful
                if (this.noPromptIterations > 50) this.noPromptIterations = 0
            }
        } else {
            // Reset counters after an interaction
            this.noPromptIterations = 0
        }
    }

    /** Lightweight passkey prompt dismissal used in mobile OAuth loop */
    private async tryDismissPasskeyPrompt(page: Page) {
        try {
            // Fast existence checks with very small timeouts to avoid slowing the loop
            const titleEl = await page.waitForSelector('[data-testid="title"]', { timeout: 500 }).catch(() => null)
            const secondaryBtn = await page.waitForSelector('button[data-testid="secondaryButton"]', { timeout: 500 }).catch(() => null)
            // Direct text locator fallback (sometimes data-testid changes)
            const textSkip = secondaryBtn ? null : await page.locator('xpath=//button[contains(normalize-space(.), "Skip for now")]').first().isVisible().catch(()=>false)
            if (secondaryBtn) {
                // Heuristic: if title indicates passkey or both primary/secondary exist with typical text
                let shouldClick = false
                let titleText = ''
                if (titleEl) {
                    titleText = (await titleEl.textContent() || '').trim()
                    if (/sign in faster|passkey|fingerprint|face|pin/i.test(titleText)) {
                        shouldClick = true
                    }
                }
                if (!shouldClick && textSkip) {
                    shouldClick = true
                }
                if (!shouldClick) {
                    // Fallback text probe on the secondary button itself
                    const btnText = (await secondaryBtn.textContent() || '').trim()
                    if (/skip for now/i.test(btnText)) {
                        shouldClick = true
                    }
                }
                if (shouldClick) {
                    await secondaryBtn.click().catch(() => { })
                    if (!this.passkeyHandled) {
                        this.bot.log(this.bot.isMobile, 'LOGIN-PASSKEY', `Passkey prompt (loop) -> clicked skip${titleText ? ` (title: ${titleText})` : ''}`)
                    }
                    this.passkeyHandled = true
                    await this.bot.utils.wait(500)
                }
            }
        } catch { /* ignore minor errors */ }
    }

    private async checkBingLogin(page: Page): Promise<void> {
        try {
            this.bot.log(this.bot.isMobile, '必应登录', '验证必应登录状态')
            await page.goto('https://www.bing.com/fd/auth/signin?action=interactive&provider=windows_live_id&return_url=https%3A%2F%2Fwww.bing.com%2F')
            const maxIterations = 5
            for (let iteration = 1; iteration <= maxIterations; iteration++) {
                const currentUrl = new URL(page.url())

                if (currentUrl.hostname === 'www.bing.com' && currentUrl.pathname === '/') {
                    await this.bot.browser.utils.tryDismissAllMessages(page)

                    const loggedIn = await this.checkBingLoginStatus(page)
                    // If mobile browser, skip this step
                    if (loggedIn || this.bot.isMobile) {
                        this.bot.log(this.bot.isMobile, '必应登录', '必应登录验证通过!')
                        break
                    }
                }
                await this.bot.utils.waitRandom(1000,4000)
            }
        } catch (error) {
            this.bot.log(this.bot.isMobile, '必应登录', '发生错误: ' + error, 'error')
        }
    }

    private async checkBingLoginStatus(page: Page): Promise<boolean> {
        try {
            await page.waitForSelector('#id_n', { timeout: 5000 })
            return true
        } catch (error) {
            return false
        }
    }

    private async checkAccountLocked(page: Page) {
        await this.bot.utils.waitRandom(2000,5000)
        const isLocked = await page.waitForSelector('#serviceAbuseLandingTitle', { state: 'visible', timeout: 1000 }).then(() => true).catch(() => false)
        if (isLocked) {

            throw this.bot.log(this.bot.isMobile, '检查锁定状态', '此账户已被锁定! 从 "accounts.json" 中移除该账户并重启!', 'error')
        }
    }
}
