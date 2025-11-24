import * as ProxyChain from 'proxy-chain'
import { AccountProxy } from '../interface/Account'

interface LocalProxyInfo {
    url: string
    port: number
    server?: any
}

class ProxyServerManager {
    private activeServers: Map<string, LocalProxyInfo> = new Map()

    /**
     * 为 SOCKS 代理创建本地 HTTP 代理服务器
     * @param proxy 账户代理配置
     * @returns 本地 HTTP 代理信息
     */
    async createLocalProxy(proxy: AccountProxy): Promise<LocalProxyInfo> {
        const proxyKey = `${proxy.url}:${proxy.port}`
        
        // 如果已经存在该代理的服务器，直接返回
        if (this.activeServers.has(proxyKey)) {
            return this.activeServers.get(proxyKey)!
        }

        try {
            // 构建上游代理 URL（包含认证信息）
            let upstreamProxyUrl: string
            const protocol = proxy.url.includes('://') ? proxy.url.split('://')[0] : 'socks5'
            const host = proxy.url.includes('://') ? proxy.url.split('://')[1] : proxy.url
            
            if (proxy.username && proxy.password) {
                upstreamProxyUrl = `${protocol}://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${host}:${proxy.port}`
            } else {
                upstreamProxyUrl = `${protocol}://${host}:${proxy.port}`
            }

            // 创建本地代理服务器（使用匿名函数处理请求）
            const localProxyUrl = await ProxyChain.anonymizeProxy(upstreamProxyUrl)
            
            // 从返回的 URL 中提取端口
            const localUrl = new URL(localProxyUrl)
            const localPort = parseInt(localUrl.port, 10)

            const localProxyInfo: LocalProxyInfo = {
                url: 'http://127.0.0.1',
                port: localPort,
                server: localProxyUrl // 保存用于后续关闭
            }

            this.activeServers.set(proxyKey, localProxyInfo)
            return localProxyInfo

        } catch (error) {
            throw new Error(`Failed to create local proxy server: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /**
     * 关闭指定的代理服务器
     */
    async closeProxy(proxyKey: string): Promise<void> {
        const proxyInfo = this.activeServers.get(proxyKey)
        if (proxyInfo && proxyInfo.server) {
            try {
                await ProxyChain.closeAnonymizedProxy(proxyInfo.server, true)
            } catch (error) {
                // 忽略关闭错误
            }
            this.activeServers.delete(proxyKey)
        }
    }

    /**
     * 关闭所有活动的代理服务器
     */
    async closeAll(): Promise<void> {
        const closePromises = Array.from(this.activeServers.values())
            .filter(info => info.server)
            .map(info => ProxyChain.closeAnonymizedProxy(info.server, true).catch(() => {}))
        
        await Promise.allSettled(closePromises)
        this.activeServers.clear()
    }

    /**
     * 检查代理 URL 是否为 SOCKS 协议
     */
    static isSocksProxy(url: string): boolean {
        return /^socks[45]?:\/\//i.test(url)
    }
}

export default ProxyServerManager
