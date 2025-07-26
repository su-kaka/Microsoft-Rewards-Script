import chalk from 'chalk'
import fs from 'fs'
import path from 'path'

import { Webhook } from './Webhook'
import { loadConfig } from './Load'


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

export function log(isMobile: boolean | 'main', title: string, message: string, type: 'log' | 'warn' | 'error' = 'log', color?: keyof typeof chalk): void {
    const configData = loadConfig()

    if (configData.logExcludeFunc.some(x => x.toLowerCase() === title.toLowerCase())) {
        return
    }

    const currentTime = new Date().toLocaleString()
    const platformText = isMobile === 'main' ? 'MAIN' : isMobile ? 'MOBILE' : 'DESKTOP'
    const chalkedPlatform = isMobile === 'main' ? chalk.bgCyan('MAIN') : isMobile ? chalk.bgBlue('MOBILE') : chalk.bgMagenta('DESKTOP')

    // Clean string for the Webhook (no chalk)
    const cleanStr = `[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${platformText} [${title}] ${message}`

    // 保存日志到本地文件
    writeLogToFile(cleanStr)

    // Send the clean string to the Webhook
    if (!configData.webhookLogExcludeFunc.some(x => x.toLowerCase() === title.toLowerCase())) {
        Webhook(configData, cleanStr)
    }

    // Formatted string with chalk for terminal logging
    const str = `[${currentTime}] [PID: ${process.pid}] [${type.toUpperCase()}] ${chalkedPlatform} [${title}] ${message}`

    const applyChalk = color && typeof chalk[color] === 'function' ? chalk[color] as (msg: string) => string : null

    // Log based on the type
    switch (type) {
        case 'warn':
            applyChalk ? console.warn(applyChalk(str)) : console.warn(str)
            break

        case 'error':
            applyChalk ? console.error(applyChalk(str)) : console.error(str)
            break

        default:
            applyChalk ? console.log(applyChalk(str)) : console.log(str)
            break
    }
}
