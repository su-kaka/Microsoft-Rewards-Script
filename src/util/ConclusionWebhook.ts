import axios from 'axios'
import { Config } from '../interface/Config'
import { Ntfy } from './Ntfy'
import { DISCORD } from '../constants'
import { log } from './Logger'

interface DiscordField {
    name: string
    value: string
    inline?: boolean
}

interface DiscordEmbed {
    title?: string
    description?: string
    color?: number
    fields?: DiscordField[]
    timestamp?: string
    footer?: {
        text: string
        icon_url?: string
    }
    thumbnail?: {
        url: string
    }
    author?: {
        name: string
        icon_url?: string
    }
}

interface AccountSummary {
    email: string
    totalCollected: number
    desktopCollected: number
    mobileCollected: number
    initialTotal: number
    endTotal: number
    durationMs: number
    errors: string[]
    banned?: { status: boolean; reason?: string }
}

interface ConclusionData {
    version: string
    runId: string
    totalAccounts: number
    successes: number
    accountsWithErrors: number
    accountsBanned: number
    totalCollected: number
    totalInitial: number
    totalEnd: number
    avgPointsPerAccount: number
    totalDuration: number
    avgDuration: number
    summaries: AccountSummary[]
}

/**
 * Send a clean, structured Discord webhook notification
 */
export async function ConclusionWebhook(
    config: Config,
    title: string,
    description: string,
    fields?: DiscordField[],
    color?: number
) {
    const hasConclusion = config.conclusionWebhook?.enabled && config.conclusionWebhook.url
    const hasWebhook = config.webhook?.enabled && config.webhook.url

    if (!hasConclusion && !hasWebhook) return

    const embed: DiscordEmbed = {
        title,
        description,
        color: color || 0x0078D4,
        timestamp: new Date().toISOString()
    }

    if (fields && fields.length > 0) {
        embed.fields = fields
    }

    const postWebhook = async (url: string, label: string) => {
        const maxAttempts = 3
        let lastError: unknown = null

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await axios.post(url,
                    {
                        embeds: [embed]
                    },
                    {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 15000
                    })
                log('main', 'WEBHOOK', `${label} 通知发送成功（第 ${attempt} 次尝试）`)
                return
            } catch (error) {
                lastError = error
                if (attempt < maxAttempts) {
                    // 指数退避：1s，2s，4s
                    const delayMs = 1000 * Math.pow(2, attempt - 1)
                    await new Promise(resolve => setTimeout(resolve, delayMs))
                }
            }
        }
        log('main', 'WEBHOOK', `${label} 发送失败，${maxAttempts} 次尝试后：${lastError instanceof Error ? lastError.message : String(lastError)}`, 'error')
    }

    const urls = new Set<string>()
    if (hasConclusion) urls.add(config.conclusionWebhook!.url)
    if (hasWebhook) urls.add(config.webhook!.url)

    await Promise.all(
        Array.from(urls).map((url, index) => postWebhook(url, `webhook-${index + 1}`))
    )

    // 可选NTFY通知
    if (config.ntfy?.enabled && config.ntfy.url && config.ntfy.topic) {
        const message = `${title}\n${description}${fields ? '\n\n' + fields.map(f => `${f.name}: ${f.value}`).join('\n') : ''}`
        const ntfyType = color === 0xFF0000 ? 'error' : color === 0xFFAA00 ? 'warn' : 'log'

        try {
            await Ntfy(message, ntfyType)
            log('main', 'NTFY', '通知发送成功')
        } catch (error) {
            log('main', 'NTFY', `发送通知失败：${error instanceof Error ? error.message : String(error)}`, 'error')
        }
    }
}

/**
 * Enhanced conclusion webhook with beautiful formatting and clear statistics
 */
export async function ConclusionWebhookEnhanced(config: Config, data: ConclusionData) {
    const hasConclusion = config.conclusionWebhook?.enabled && config.conclusionWebhook.url
    const hasWebhook = config.webhook?.enabled && config.webhook.url

    if (!hasConclusion && !hasWebhook) return

    // 格式化持续时间的辅助函数
    const formatDuration = (ms: number): string => {
        const totalSeconds = Math.floor(ms / 1000)
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60

        if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
        if (minutes > 0) return `${minutes}m ${seconds}s`
        return `${seconds}s`
    }

    // 创建进度条的辅助函数（未来使用）
    // const createProgressBar = (current: number, max: number, length: number = 10): string => {
    //     const percentage = Math.min(100, Math.max(0, (current / max) * 100))
    //     const filled = Math.round((percentage / 100) * length)
    //     const empty = length - filled
    //     return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${percentage.toFixed(0)}%`
    // }

    // 确定总体状态和颜色
    let statusEmoji = '✅'
    let statusText = '成功'
    let embedColor: number = DISCORD.COLOR_GREEN

    if (data.accountsBanned > 0) {
        statusEmoji = '🚫'
        statusText = '检测到封禁账户'
        embedColor = DISCORD.COLOR_RED
    } else if (data.accountsWithErrors > 0) {
        statusEmoji = '⚠️'
        statusText = '完成但有警告'
        embedColor = DISCORD.COLOR_ORANGE
    }

    // 构建主摘要描述
    const mainDescription = [
        `**状态:** ${statusEmoji} ${statusText}`,
        `**版本:** v${data.version} • **运行ID:** \`${data.runId}\``,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    ].join('\n')

    // 构建全局统计字段
    const globalStats = [
        '**💎 总积分赚取**',
        `\`${data.totalInitial.toLocaleString()}\` → \`${data.totalEnd.toLocaleString()}\` **(+${data.totalCollected.toLocaleString()})**`,
        '',
        '**📊 处理账户**',
        `✅ Success: **${data.successes}** | ⚠️ Errors: **${data.accountsWithErrors}** | 🚫 Banned: **${data.accountsBanned}**`,
        `Total: **${data.totalAccounts}** ${data.totalAccounts === 1 ? 'account' : 'accounts'}`,
        '',
        '**⚡ Performance**',
        `Average: **${data.avgPointsPerAccount}pts/account** in **${formatDuration(data.avgDuration)}**`,
        `Total Runtime: **${formatDuration(data.totalDuration)}**`
    ].join('\n')

    // 构建每个账户的详细信息（如果账户太多则拆分）
    const accountFields: DiscordField[] = []
    const maxAccountsPerField = 5
    const accountChunks: AccountSummary[][] = []

    for (let i = 0; i < data.summaries.length; i += maxAccountsPerField) {
        accountChunks.push(data.summaries.slice(i, i + maxAccountsPerField))
    }

    accountChunks.forEach((chunk, chunkIndex) => {
        const accountLines: string[] = []

        chunk.forEach((acc) => {
            const statusIcon = acc.banned?.status ? '🚫' : (acc.errors.length > 0 ? '⚠️' : '✅')
            const emailShort = acc.email.length > 25 ? acc.email.substring(0, 22) + '...' : acc.email

            accountLines.push(`${statusIcon} **${emailShort}**`)
            accountLines.push(`└ 积分: **+${acc.totalCollected}** (🖥️ ${acc.desktopCollected} • 📱 ${acc.mobileCollected})`)
            accountLines.push(`└ 持续时间: ${formatDuration(acc.durationMs)}`)
            
            if (acc.banned?.status) {
                accountLines.push(`└ 🚫 **封禁:** ${acc.banned.reason || '账户暂停'}`)
            } else if (acc.errors.length > 0) {
                const errorPreview = acc.errors.slice(0, 1).join(', ')
                accountLines.push(`└ ⚠️ **错误:** ${errorPreview.length > 50 ? errorPreview.substring(0, 47) + '...' : errorPreview}`)
            }
            
            accountLines.push('') // 账户之间空行
        })

        const fieldName = accountChunks.length > 1 
            ? `📈 账户详情 (${chunkIndex + 1}/${accountChunks.length})`
            : '📈 账户详情'

        accountFields.push({
            name: fieldName,
            value: accountLines.join('\n').trim(),
            inline: false
        })
    })

    // 创建嵌入
    const embeds: DiscordEmbed[] = []

    // 带有摘要的主嵌入
    embeds.push({
        title: '🎯 Microsoft Rewards — 每日摘要',
        description: mainDescription,
        color: embedColor,
        fields: [
            {
                name: '📊 全局统计',
                value: globalStats,
                inline: false
            }
        ],
        thumbnail: {
            url: 'https://media.discordapp.net/attachments/1421163952972369931/1421929950377939125/Gc.png'
        },
        footer: {
            text: `Microsoft Rewards Bot v${data.version} • Completed at`,
            icon_url: 'https://media.discordapp.net/attachments/1421163952972369931/1421929950377939125/Gc.png'
        },
        timestamp: new Date().toISOString()
    })

    // 如需要，在单独的嵌入中添加账户详情
    if (accountFields.length > 0) {
        // 如果我们有多个字段，拆分为多个嵌入
        accountFields.forEach((field, index) => {
            if (index === 0 && embeds[0] && embeds[0].fields) {
                // 将第一个字段添加到主嵌入
                embeds[0].fields.push(field)
            } else {
                // 为剩余字段创建额外嵌入
                embeds.push({
                    color: embedColor,
                    fields: [field],
                    timestamp: new Date().toISOString()
                })
            }
        })
    }


    const postWebhook = async (url: string, label: string) => {
        const maxAttempts = 3
        let lastError: unknown = null

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await axios.post(url, {
                    embeds: embeds
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 15000
                })
                log('main', 'WEBHOOK', `${label} 结论发送成功（${data.totalAccounts} 个账户，+${data.totalCollected}pts）`)
                return
            } catch (error) {
                lastError = error
                if (attempt < maxAttempts) {
                    const delayMs = 1000 * Math.pow(2, attempt - 1)
                    await new Promise(resolve => setTimeout(resolve, delayMs))
                }
            }
        }
        log('main', 'WEBHOOK', `${label} 发送失败，${maxAttempts} 次尝试后：${lastError instanceof Error ? lastError.message : String(lastError)}`, 'error')
    }

    const urls = new Set<string>()
    if (hasConclusion) urls.add(config.conclusionWebhook!.url)
    if (hasWebhook) urls.add(config.webhook!.url)

    await Promise.all(
        Array.from(urls).map((url, index) => postWebhook(url, `conclusion-webhook-${index + 1}`))
    )

    // 可选NTFY通知（简化摘要）
    if (config.ntfy?.enabled && config.ntfy.url && config.ntfy.topic) {
        const message = [
            '🎯 Microsoft Rewards 摘要',
            `状态: ${statusText}`,
            `积分: ${data.totalInitial} → ${data.totalEnd} (+${data.totalCollected})`,
            `账户: ${data.successes}/${data.totalAccounts} 成功`,
            `持续时间: ${formatDuration(data.totalDuration)}`
        ].join('\n')

        const ntfyType = embedColor === DISCORD.COLOR_RED ? 'error' : embedColor === DISCORD.COLOR_ORANGE ? 'warn' : 'log'

        try {
            await Ntfy(message, ntfyType)
            log('main', 'NTFY', '结论通知发送成功')
        } catch (error) {
            log('main', 'NTFY', `发送结论通知失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
        }
    }
}
