import axios from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { Ntfy } from './Ntfy'
import { loadConfig } from './Load'
import { DISCORD } from '../constants'

type WebhookBuffer = {
    lines: string[]
    sending: boolean
    timer?: NodeJS.Timeout
}

const webhookBuffers = new Map<string, WebhookBuffer>()

// 定期清理旧/空闲的webhook缓冲区以防止内存泄漏
setInterval(() => {
    const now = Date.now()
    const BUFFER_MAX_AGE_MS = 3600000 // 1小时
    
    for (const [url, buf] of webhookBuffers.entries()) {
        if (!buf.sending && buf.lines.length === 0) {
            const lastActivity = (buf as unknown as { lastActivity?: number }).lastActivity || 0
            if (now - lastActivity > BUFFER_MAX_AGE_MS) {
                webhookBuffers.delete(url)
            }
        }
    }
}, 600000) // 每10分钟检查一次


/**
 * 确保日志目录存在
 */
function ensureLogDirectory(): string {
    const logDir = path.join(process.cwd(), 'logs')
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
    }
    return logDir
}

/**
 * 获取当前日期的日志文件路径
 */
function getLogFilePath(): string {
    const logDir = ensureLogDirectory()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD格式
    return path.join(logDir, `${today}.log`)
}

/**
 * 将日志写入文件
 */
function writeLogToFile(logContent: string): void {
    try {
        const logFilePath = getLogFilePath()
        const timestamp = new Date().toISOString()
        const logEntry = `${timestamp} ${logContent}\n`
        
        fs.appendFileSync(logFilePath, logEntry, 'utf8')
    } catch (error) {
        console.error('Failed to write log to file:', error)
    }
}


function getBuffer(url: string): WebhookBuffer {
    let buf = webhookBuffers.get(url)
    if (!buf) {
        buf = { lines: [], sending: false }
        webhookBuffers.set(url, buf)
    }
    // 跟踪最后活动以进行清理
    (buf as unknown as { lastActivity: number }).lastActivity = Date.now()
    return buf
}

async function sendBatch(url: string, buf: WebhookBuffer) {
    if (buf.sending) return
    buf.sending = true
    while (buf.lines.length > 0) {
        const chunk: string[] = []
        let currentLength = 0
        while (buf.lines.length > 0) {
            const next = buf.lines[0]!
            const projected = currentLength + next.length + (chunk.length > 0 ? 1 : 0)
            if (projected > DISCORD.MAX_EMBED_LENGTH && chunk.length > 0) break
            buf.lines.shift()
            chunk.push(next)
            currentLength = projected
        }

        const content = chunk.join('\n').slice(0, DISCORD.MAX_EMBED_LENGTH)
        if (!content) {
            continue
        }

        // 增强的webhook负载，包含嵌入、用户名和头像
        const payload = {
            embeds: [{
                description: `\`\`\`\n${content}\n\`\`\``,
                color: determineColorFromContent(content),
                timestamp: new Date().toISOString()
            }]
        }

        try {
            await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: DISCORD.WEBHOOK_TIMEOUT })
            await new Promise(resolve => setTimeout(resolve, DISCORD.RATE_LIMIT_DELAY))
        } catch (error) {
            // 将失败的批次重新排队到前面并退出循环
            buf.lines = chunk.concat(buf.lines)
            console.error('[Webhook] 实时日志传递失败:', error)
            break
        }
    }
    buf.sending = false
}

function determineColorFromContent(content: string): number {
    const lower = content.toLowerCase()
    // 安全/封禁警报 - 红色
    if (lower.includes('[banned]') || lower.includes('[security]') || lower.includes('suspended') || lower.includes('compromised')) {
        return DISCORD.COLOR_RED
    }
    // 错误 - 深红色
    if (lower.includes('[error]') || lower.includes('✗')) {
        return DISCORD.COLOR_CRIMSON
    }
    // 警告 - 橙色/黄色
    if (lower.includes('[warn]') || lower.includes('⚠')) {
        return DISCORD.COLOR_ORANGE
    }
    // 成功 - 绿色
    if (lower.includes('[ok]') || lower.includes('✓') || lower.includes('complet')) {
        return DISCORD.COLOR_GREEN
    }
    // 信息/主 - 蓝色
    if (lower.includes('[main]')) {
        return DISCORD.COLOR_BLUE
    }
    // 默认 - 灰色
    return 0x95A5A6 // 灰色
}

function enqueueWebhookLog(url: string, line: string) {
    const buf = getBuffer(url)
    buf.lines.push(line)
    if (!buf.timer) {
        buf.timer = setTimeout(() => {
            buf.timer = undefined
            void sendBatch(url, buf)
        }, DISCORD.DEBOUNCE_DELAY)
    }
}

// 同步记录器，当 type === 'error' 时返回一个 Error，以便调用者可以安全地 `throw log(...)`。
export function log(isMobile: boolean | 'main', title: string, message: string, type: 'log' | 'warn' | 'error' = 'log', color?: keyof typeof chalk): Error | void {
    const configData = loadConfig()

    // 访问日志配置以向后兼容
    const configAny = configData as unknown as Record<string, unknown>
    const logging = configAny.logging as { excludeFunc?: string[]; logExcludeFunc?: string[] } | undefined
    const logExcludeFunc = logging?.excludeFunc ?? (configData as { logExcludeFunc?: string[] }).logExcludeFunc ?? []

    if (logExcludeFunc.some((x: string) => x.toLowerCase() === title.toLowerCase())) {
        return
    }

    const currentTime = new Date().toLocaleString()
    const platformText = isMobile === 'main' ? 'MAIN' : isMobile ? 'MOBILE' : 'DESKTOP'
    
    // 用于通知的干净字符串（无chalk，结构化）
    type LoggingCfg = { excludeFunc?: string[]; webhookExcludeFunc?: string[]; redactEmails?: boolean }
    const loggingCfg: LoggingCfg = (configAny.logging || {}) as LoggingCfg
    const shouldRedact = !!loggingCfg.redactEmails
    const redact = (s: string) => shouldRedact ? s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, (m) => {
        const [u, d] = m.split('@'); return `${(u || '').slice(0, 2)}***@${d || ''}`
    }) : s
    const cleanStr = redact(`[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${platformText} [${title}] ${message}`)

    // 保存日志到本地文件
    writeLogToFile(cleanStr)
    
    // Define conditions for sending to NTFY 
    const ntfyConditions = {
        log: [
            message.toLowerCase().includes('started tasks for account'),
            message.toLowerCase().includes('press the number'),
            message.toLowerCase().includes('no points to earn')
        ],
        error: [],
        warn: [
            message.toLowerCase().includes('aborting'),
            message.toLowerCase().includes('didn\'t gain')
        ]
    }

    // 检查当前日志类型和消息是否满足NTFY条件
    try {
        if (type in ntfyConditions && ntfyConditions[type as keyof typeof ntfyConditions].some(condition => condition)) {
            // 一次性发送
            Promise.resolve(Ntfy(cleanStr, type)).catch(() => { /* 忽略ntfy错误 */ })
        }
    } catch { /* 忽略 */ }

    // 控制台输出，格式化更好且带有上下文图标
    const typeIndicator = type === 'error' ? '✗' : type === 'warn' ? '⚠' : '✓'
    const platformColor = isMobile === 'main' ? chalk.cyan : isMobile ? chalk.blue : chalk.magenta
    const typeColor = type === 'error' ? chalk.red : type === 'warn' ? chalk.yellow : chalk.green
    
    // 基于标题/消息添加上下文图标（ASCII安全，适用于Windows PowerShell）
    const titleLower = title.toLowerCase()
    const msgLower = message.toLowerCase()
    
    // ASCII安全图标，兼容Windows PowerShell
    const iconMap: Array<[RegExp, string]> = [
        [/security|compromised/i, '[SECURITY]'],
        [/ban|suspend/i, '[BANNED]'],
        [/error/i, '[ERROR]'],
        [/warn/i, '[WARN]'],
        [/success|complet/i, '[OK]'],
        [/login/i, '[LOGIN]'],
        [/point/i, '[POINTS]'],
        [/search/i, '[SEARCH]'],
        [/activity|quiz|poll/i, '[ACTIVITY]'],
        [/browser/i, '[BROWSER]'],
        [/main/i, '[MAIN]']
    ]

    let icon = ''
    for (const [pattern, symbol] of iconMap) {
        if (pattern.test(titleLower) || pattern.test(msgLower)) {
            icon = chalk.dim(symbol)
            break
        }
    }

    const iconPart = icon ? icon + ' ' : ''

    const formattedStr = [
        chalk.gray(`[${currentTime}]`),
        chalk.gray(`[${process.pid}]`),
        typeColor(`${typeIndicator}`),
        platformColor(`[${platformText}]`),
        chalk.bold(`[${title}]`),
        iconPart + redact(message)
    ].join(' ')

    const applyChalk = color && typeof chalk[color] === 'function' ? chalk[color] as (msg: string) => string : null

    // 根据类型记录日志
    switch (type) {
        case 'warn':
            applyChalk ? console.warn(applyChalk(formattedStr)) : console.warn(formattedStr)
            break

        case 'error':
            applyChalk ? console.error(applyChalk(formattedStr)) : console.error(formattedStr)
            break

        default:
            applyChalk ? console.log(applyChalk(formattedStr)) : console.log(formattedStr)
            break
    }

    // Webhook流（实时日志）
    try {
        const loggingCfg: Record<string, unknown> = (configAny.logging || {}) as Record<string, unknown>
        const webhookCfg = configData.webhook
        const liveUrlRaw = typeof loggingCfg.liveWebhookUrl === 'string' ? loggingCfg.liveWebhookUrl.trim() : ''
        const liveUrl = liveUrlRaw || (webhookCfg?.enabled && webhookCfg.url ? webhookCfg.url : '')
        const webhookExclude = Array.isArray(loggingCfg.webhookExcludeFunc) ? loggingCfg.webhookExcludeFunc : configData.webhookLogExcludeFunc || []
        const webhookExcluded = Array.isArray(webhookExclude) && webhookExclude.some((x: string) => x.toLowerCase() === title.toLowerCase())
        if (liveUrl && !webhookExcluded) {
            enqueueWebhookLog(liveUrl, cleanStr)
        }
    } catch (error) {
        console.error('[Logger] Failed to enqueue webhook log:', error)
    }

    // 记录错误时返回一个Error，以便调用者可以 `throw log(...)`
    if (type === 'error') {
        // 根据项目政策禁用CommunityReporter
        return new Error(cleanStr)
    }
}
