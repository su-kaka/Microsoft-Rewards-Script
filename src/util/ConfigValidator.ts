import fs from 'fs'
import { Config } from '../interface/Config'
import { Account } from '../interface/Account'

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  field: string
  message: string
  suggestion?: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

/**
 * ConfigValidator performs intelligent validation of config.json and accounts.json
 * before execution to catch common mistakes, conflicts, and security issues.
 */
export class ConfigValidator {
  /**
   * Validate the main config file
   */
  static validateConfig(config: Config): ValidationResult {
    const issues: ValidationIssue[] = []

    // 检查baseURL
    if (!config.baseURL || !config.baseURL.startsWith('https://')) {
      issues.push({
        severity: 'error',
        field: 'baseURL',
        message: 'baseURL 必须是有效的HTTPS URL',
        suggestion: '使用 https://rewards.bing.com'
      })
    }

    // 检查sessionPath
    if (!config.sessionPath || config.sessionPath.trim() === '') {
      issues.push({
        severity: 'error',
        field: 'sessionPath',
        message: 'sessionPath 不能为空'
      })
    }

    // Check clusters
    if (config.clusters < 1) {
      issues.push({
        severity: 'error',
        field: 'clusters',
        message: 'clusters 必须至少为 1'
      })
    }
    if (config.clusters > 10) {
      issues.push({
        severity: 'warning',
        field: 'clusters',
        message: '高集群数量可能会消耗过多资源',
        suggestion: '考虑使用 2-4 个集群以获得最佳性能'
      })
    }

    // Check globalTimeout
    const timeout = this.parseTimeout(config.globalTimeout)
    if (timeout < 10000) {
      issues.push({
        severity: 'warning',
        field: 'globalTimeout',
        message: '全局超时时间过短可能导致频繁失败',
        suggestion: '建议使用至少 15s 以确保稳定性'
      })
    }
    if (timeout > 120000) {
      issues.push({
        severity: 'warning',
        field: 'globalTimeout',
        message: '全局超时时间过长可能会影响执行速度',
        suggestion: '建议使用 30-60s 以获得最佳平衡'
      })
    }

    // Check search settings
    if (config.searchSettings) {
      const searchDelay = config.searchSettings.searchDelay
      const minDelay = this.parseTimeout(searchDelay.min)
      const maxDelay = this.parseTimeout(searchDelay.max)

      if (minDelay >= maxDelay) {
        issues.push({
          severity: 'error',
          field: 'searchSettings.searchDelay',
          message: 'min delay 必须小于 max delay'
        })
      }

      if (minDelay < 10000) {
        issues.push({
          severity: 'warning',
          field: 'searchSettings.searchDelay.min',
          message: '搜索延迟过短可能会增加被封禁风险',
          suggestion: '建议使用至少 30s 之间的搜索延迟'
        })
      }

      if (config.searchSettings.retryMobileSearchAmount > 5) {
        issues.push({
          severity: 'warning',
          field: 'searchSettings.retryMobileSearchAmount',
          message: '重试次数过多可能会浪费时间',
          suggestion: '建议最多使用 2-3 次重试'
        })
      }
    }

    // Check humanization
    if (config.humanization) {
      if (config.humanization.enabled === false && config.humanization.stopOnBan === true) {
        issues.push({
          severity: 'warning',
          field: 'humanization',
          message: 'stopOnBan 已启用但 humanization 已禁用',
          suggestion: '建议启用 humanization 以提高封禁保护'
        })
      }

      const actionDelay = config.humanization.actionDelay
      if (actionDelay) {
        const minAction = this.parseTimeout(actionDelay.min)
        const maxAction = this.parseTimeout(actionDelay.max)
        if (minAction >= maxAction) {
          issues.push({
            severity: 'error',
            field: 'humanization.actionDelay',
            message: 'min action delay 必须小于 max action delay'
          })
        }
      }

      if (config.humanization.allowedWindows && config.humanization.allowedWindows.length > 0) {
        for (const window of config.humanization.allowedWindows) {
          if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(window)) {
            issues.push({
              severity: 'error',
              field: 'humanization.allowedWindows',
              message: `无效的时间窗口格式: ${window}`,
              suggestion: '使用格式 HH:mm-HH:mm (例如: 09:00-17:00)'
            })
          }
        }
      }
    }

    // Check proxy config
    if (config.proxy) {
      if (config.proxy.proxyGoogleTrends === false && config.proxy.proxyBingTerms === false) {
        issues.push({
          severity: 'info',
          field: 'proxy',
          message: '所有代理选项均已禁用 - 出站请求将使用直接连接'
        })
      }
    }

    // Check webhooks
    if (config.webhook?.enabled && (!config.webhook.url || config.webhook.url.trim() === '')) {
      issues.push({
        severity: 'error',
        field: 'webhook.url',
        message: '已启用 Webhook 但 URL 为空'
      })
    }

    if (config.conclusionWebhook?.enabled && (!config.conclusionWebhook.url || config.conclusionWebhook.url.trim() === '')) {
      issues.push({
        severity: 'error',
        field: 'conclusionWebhook.url',
        message: '已启用结论 Webhook 但 URL 为空'
      })
    }

    // Check ntfy
    if (config.ntfy?.enabled) {
      if (!config.ntfy.url || config.ntfy.url.trim() === '') {
        issues.push({
          severity: 'error',
          field: 'ntfy.url',
          message: '已启用 NTFY 但 URL 为空'
        })
      }
      if (!config.ntfy.topic || config.ntfy.topic.trim() === '') {
        issues.push({
          severity: 'error',
          field: 'ntfy.topic',
          message: '已启用 NTFY 但主题为空'
        })
      }
    }


    // Check workers
    if (config.workers) {
      const allDisabled = !config.workers.doDailySet && 
                          !config.workers.doMorePromotions &&
                          !config.workers.doPunchCards &&
                          !config.workers.doDesktopSearch &&
                          !config.workers.doMobileSearch &&
                          !config.workers.doDailyCheckIn &&
                          !config.workers.doReadToEarn

      if (allDisabled) {
        issues.push({
          severity: 'warning',
          field: 'workers',
          message: '所有工作器均已禁用 - 机器人将不会执行任何任务',
          suggestion: '启用至少一个工作器类型'
        })
      }
    }


    const valid = !issues.some(i => i.severity === 'error')
    return { valid, issues }
  }

  /**
   * Validate accounts.json
   */
  static validateAccounts(accounts: Account[]): ValidationResult {
    const issues: ValidationIssue[] = []

    if (accounts.length === 0) {
      issues.push({
        severity: 'error',
        field: 'accounts',
        message: 'accounts.json 中未找到任何账户'
      })
      return { valid: false, issues } 
    }

    const seenEmails = new Set<string>()
    const seenProxies = new Map<string, string[]>() // proxy -> [emails]

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i]
      const prefix = `accounts[${i}]`

      if (!acc) continue

      // Check email
      if (!acc.email || acc.email.trim() === '') {
        issues.push({
          severity: 'error',
          field: `${prefix}.email`,
          message: '账户邮箱为空'
        })
      } else {
        if (seenEmails.has(acc.email)) {
          issues.push({
            severity: 'error',
            field: `${prefix}.email`,
            message: `重复邮箱: ${acc.email}`
          })
        }
        seenEmails.add(acc.email)

        if (!/@/.test(acc.email)) {
          issues.push({
            severity: 'error',
            field: `${prefix}.email`,
            message: '无效的邮箱格式'
          })
        }
      }

      // Check password
      if (!acc.password || acc.password.trim() === '') {
        issues.push({
          severity: 'error',
          field: `${prefix}.password`,
          message: '账户密码为空'
        })
      } else if (acc.password.length < 8) {
        issues.push({
          severity: 'warning',
          field: `${prefix}.password`,
          message: '密码过短 - 请验证是否正确'
        })
      }

      // Check proxy
      if (acc.proxy) {
        const proxyUrl = acc.proxy.url
        if (proxyUrl && proxyUrl.trim() !== '') {
          if (!acc.proxy.port) {
            issues.push({
              severity: 'error',
              field: `${prefix}.proxy.port`,
              message: '已指定代理 URL 但端口为空'
            })
          }

          // Track proxy reuse
          const proxyKey = `${proxyUrl}:${acc.proxy.port}`
          if (!seenProxies.has(proxyKey)) {
            seenProxies.set(proxyKey, [])
          }
          seenProxies.get(proxyKey)?.push(acc.email)
        }
      }

      // Check TOTP
      if (acc.totp && acc.totp.trim() !== '') {
        if (acc.totp.length < 16) {
          issues.push({
            severity: 'warning',
            field: `${prefix}.totp`,
            message: 'TOTP 密钥似乎过短 - 请验证是否正确'
          })
        }
      }
    }

    // Warn about excessive proxy reuse
    for (const [proxyKey, emails] of seenProxies) {
      if (emails.length > 3) {
        issues.push({
          severity: 'warning',
          field: 'accounts.proxy',
          message: `代理 ${proxyKey} 被 ${emails.length} 个账户使用 - 可能触发速率限制`,
          suggestion: '为每个账户使用不同的代理以提高安全性'
        })
      }
    }

    const valid = !issues.some(i => i.severity === 'error')
    return { valid, issues }
  }

  /**
   * Validate both config and accounts together (cross-checks)
   */
  static validateAll(config: Config, accounts: Account[]): ValidationResult {
    const configResult = this.validateConfig(config)
    const accountsResult = this.validateAccounts(accounts)

    const issues = [...configResult.issues, ...accountsResult.issues]

    // Cross-validation: clusters vs accounts
    if (accounts.length > 0 && config.clusters > accounts.length) {
      issues.push({
        severity: 'info',
        field: 'clusters',
        message: `${config.clusters} 个集群配置，但只有 ${accounts.length} 个账户`,
        suggestion: '将集群数量减少到与账户数量匹配以提高效率'
      })
    }

    // Cross-validation: parallel mode with single account
    if (config.parallel && accounts.length === 1) {
      issues.push({
        severity: 'info',
        field: 'parallel',
        message: '已启用并行模式，但只有一个账户，没有效果',
        suggestion: '禁用并行模式或添加更多账户'
      })
    }

    const valid = !issues.some(i => i.severity === 'error')
    return { valid, issues }
  }

  /**
   * Load and validate from file paths
   */
  static validateFromFiles(configPath: string, accountsPath: string): ValidationResult {
    try {
      if (!fs.existsSync(configPath)) {
        return {
          valid: false,
          issues: [{
            severity: 'error',
            field: 'config',
            message: `配置文件未找到: ${configPath}`
          }]
        }
      }

      if (!fs.existsSync(accountsPath)) {
        return {
          valid: false,
          issues: [{
            severity: 'error',
            field: 'accounts',
            message: `账户文件未找到: ${accountsPath}`
          }]
        }
      }

      const configRaw = fs.readFileSync(configPath, 'utf-8')
      const accountsRaw = fs.readFileSync(accountsPath, 'utf-8')

      const configJson = configRaw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      const config: Config = JSON.parse(configJson)
      const accounts: Account[] = JSON.parse(accountsRaw)

      return this.validateAll(config, accounts)
    } catch (error) {
      return {
        valid: false,
        issues: [{
          severity: 'error',
          field: 'parse',
          message: `解析文件失败: ${error instanceof Error ? error.message : String(error)}`
        }]
      }
    }
  }

  /**
   * Print validation results to console with color
   * Note: This method intentionally uses console.log for CLI output formatting
   */
  static printResults(result: ValidationResult): void {
    if (result.valid) {
      console.log('✅ 配置文件验证通过\n')
    } else {
      console.log('❌ 配置文件验证失败\n')
    }

    if (result.issues.length === 0) {
      console.log('未发现问题。')
      return
    }

    const errors = result.issues.filter(i => i.severity === 'error')
    const warnings = result.issues.filter(i => i.severity === 'warning')
    const infos = result.issues.filter(i => i.severity === 'info')

    if (errors.length > 0) {
      console.log(`\n🚫 ERRORS (${errors.length}):`)
      for (const issue of errors) {
        console.log(`  ${issue.field}: ${issue.message}`)
        if (issue.suggestion) {
          console.log(`    → ${issue.suggestion}`)
        }
      }
    }

    if (warnings.length > 0) {
      console.log(`\n⚠️  WARNINGS (${warnings.length}):`)
      for (const issue of warnings) {
        console.log(`  ${issue.field}: ${issue.message}`)
        if (issue.suggestion) {
          console.log(`    → ${issue.suggestion}`)
        }
      }
    }

    if (infos.length > 0) {
      console.log(`\nℹ️  INFO (${infos.length}):`)
      for (const issue of infos) {
        console.log(`  ${issue.field}: ${issue.message}`)
        if (issue.suggestion) {
          console.log(`    → ${issue.suggestion}`)
        }
      }
    }

    console.log()
  }

  private static parseTimeout(value: number | string): number {
    if (typeof value === 'number') return value
    const str = String(value).toLowerCase()
    if (str.endsWith('ms')) return parseInt(str, 10)
    if (str.endsWith('s')) return parseInt(str, 10) * 1000
    if (str.endsWith('min')) return parseInt(str, 10) * 60000
    return parseInt(str, 10) || 30000
  }
}
