import { loadConfig } from './Load'
import axios from 'axios'

const NOTIFICATION_TYPES = {
    error: { priority: 'max', tags: 'rotating_light' }, // 在此处自定义ERROR图标，请参阅：https://docs.ntfy.sh/emojis/
    warn: { priority: 'high', tags: 'warning' }, // 在此处自定义WARN图标，请参阅：https://docs.ntfy.sh/emojis/
    log: { priority: 'default', tags: 'medal_sports' } // 在此处自定义LOG图标，请参阅：https://docs.ntfy.sh/emojis/
}

export async function Ntfy(message: string, type: keyof typeof NOTIFICATION_TYPES = 'log'): Promise<void> {
    const config = loadConfig().ntfy
    if (!config?.enabled || !config.url || !config.topic) return

    try {
        const { priority, tags } = NOTIFICATION_TYPES[type]
        const headers = {
            Title: 'Microsoft Rewards Script',
            Priority: priority,
            Tags: tags,
            ...(config.authToken && { Authorization: `Bearer ${config.authToken}` })
        }

        await axios.post(`${config.url}/${config.topic}`, message, { headers })
    } catch (error) {
        // 静默失败 - NTFY 是一个非关键通知服务
    }
}