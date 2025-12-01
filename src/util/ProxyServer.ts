import * as ProxyChain from 'proxy-chain'
import * as net from 'net'
import { AccountProxy } from '../interface/Account'

interface LocalProxyInfo {
    url: string
    port: number
    server?: any
}

class ProxyServerManager {
    private activeServers: Map<string, LocalProxyInfo> = new Map()
    private static readonly MIN_PORT = 40000 // 高位端口起始
    private static readonly MAX_PORT = 65535 // 最大端口

    /**
     * 检查端口是否可用
     * @param port 要检查的端口号
     * @returns 端口是否可用
     */
    private checkPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer()

            server.once('error', () => {
                resolve(false)
            })

            server.once('listening', () => {
                server.close()
                resolve(true)
            })

            server.listen(port, '127.0.0.1')
        })
    }

    /**
     * 找到一个可用的高位端口
     * @returns 可用的端口号
     */
    private async findAvailablePort(): Promise<number> {
        const maxAttempts = 100

        for (let i = 0; i < maxAttempts; i++) {
            // 在高位端口范围内随机选择
            const port = Math.floor(Math.random() * (ProxyServerManager.MAX_PORT - ProxyServerManager.MIN_PORT + 1)) + ProxyServerManager.MIN_PORT

            if (await this.checkPortAvailable(port)) {
                return port
            }
        }

        throw new Error('无法找到可用的端口')
    }

    /**
     * 为带认证的 SOCKS 代理创建本地 HTTP 代理服务器
     * Chrome 本身支持无认证的 SOCKS 代理，因此只为需要认证的代理创建中转
     * @param proxy 账户代理配置
     * @returns 本地 HTTP 代理信息，如果不需要中转则返回原始代理信息
     */
    async createLocalProxy(proxy: AccountProxy): Promise<LocalProxyInfo> {
        const proxyKey = `${proxy.url}:${proxy.port}`

        // 如果已经存在该代理的服务器，直接返回
        if (this.activeServers.has(proxyKey)) {
            return this.activeServers.get(proxyKey)!
        }

        try {
            const protocol = proxy.url.includes('://') ? proxy.url.split('://')[0] : 'socks5'
            const host = proxy.url.includes('://') ? proxy.url.split('://')[1] : proxy.url

            // 只为带账号密码认证的 SOCKS 代理创建中转
            // Chrome 本身支持无认证的 SOCKS 代理
            if (proxy.username && proxy.password) {
                // 先找到一个可用的高位端口
                const availablePort = await this.findAvailablePort()

                // 构建上游代理 URL（包含认证信息）
                const upstreamProxyUrl = `${protocol}://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${host}:${proxy.port}`

                // 创建本地代理服务器，指定使用找到的可用端口
                const localProxyUrl = await ProxyChain.anonymizeProxy({
                    url: upstreamProxyUrl,
                    port: availablePort
                })

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
            } else {
                // 无需认证的 SOCKS 代理直接返回原始信息，Chrome 原生支持
                const directProxyInfo: LocalProxyInfo = {
                    url: `${protocol}://${host}`,
                    port: proxy.port
                }

                this.activeServers.set(proxyKey, directProxyInfo)
                return directProxyInfo
            }

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
