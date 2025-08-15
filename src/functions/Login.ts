import { Page } from 'rebrowser-playwright'
import readline from 'readline'
import * as crypto from 'crypto'
import { AxiosRequestConfig } from 'axios'

import { MicrosoftRewardsBot } from '../index'
import { saveSessionData } from '../util/Load'

import { OAuth } from '../interface/OAuth'


const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

export class Login {
    private bot: MicrosoftRewardsBot
    private clientId: string = '0000000040170455'
    private authBaseUrl: string = 'https://login.live.com/oauth20_authorize.srf'
    private redirectUrl: string = 'https://login.live.com/oauth20_desktop.srf'
    private tokenUrl: string = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
    private scope: string = 'service::prod.rewardsplatform.microsoft.com::MBI_SSL'

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async login(page: Page, email: string, password: string) {

        try {
            this.bot.log(this.bot.isMobile, '登录', '开始登录流程!')

            // Navigate to the Bing login page
            await page.goto('https://rewards.bing.com/signin')

            await page.waitForLoadState('domcontentloaded').catch(() => { })

            await this.bot.browser.utils.reloadBadPage(page)

            // Check if account is locked
            await this.checkAccountLocked(page)

            const isLoggedIn = await page.waitForSelector('html[data-role-name="RewardsPortal"]', { timeout: 10000 }).then(() => true).catch(() => false)

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
                await page.click('button[aria-describedby="pushNotificationsTitle errorDescription"]')
                numberToPress = await this.get2FACode(page)
            }
        }
    }

    private async authSMSVerification(page: Page) {
        this.bot.log(this.bot.isMobile, '登录', '需要 SMS 2FA 代码。等待用户输入...')

        const code = await new Promise<string>((resolve) => {
            rl.question('请输入 2FA 代码:', (input) => {
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

        await page.goto(authorizeUrl.href)

        let currentUrl = new URL(page.url())
        let code: string

        this.bot.log(this.bot.isMobile, 'APP 登录', '等待授权...')
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (currentUrl.hostname === 'login.live.com' && currentUrl.pathname === '/oauth20_desktop.srf') {
                code = currentUrl.searchParams.get('code')!
                break
            }

            currentUrl = new URL(page.url())
            await this.bot.utils.waitRandom(5000,9000)
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

        this.bot.log(this.bot.isMobile, 'APP 登录', '授权成功')
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

    private async dismissLoginMessages(page: Page) {
        // Use Passekey
        if (await page.waitForSelector('[data-testid="biometricVideo"]', { timeout: 2000 }).catch(() => null)) {
            const skipButton = await page.$('[data-testid="secondaryButton"]')
            if (skipButton) {
                await skipButton.click()
                this.bot.log(this.bot.isMobile, '关闭所有登录消息', '已关闭 "使用 Passekey" 弹窗')
                await page.waitForTimeout(500)
            }
        }

        // Use Keep me signed in
        if (await page.waitForSelector('[data-testid="kmsiVideo"]', { timeout: 2000 }).catch(() => null)) {
            const yesButton = await page.$('[data-testid="primaryButton"]')
            if (yesButton) {
                await yesButton.click()
                this.bot.log(this.bot.isMobile, '关闭所有登录消息', '已关闭 "保持登录状态" 弹窗')
                await page.waitForTimeout(500)
            }
        }

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
