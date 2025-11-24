import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { AccountProxy } from '../interface/Account'

class AxiosClient {
    private instance: AxiosInstance
    private account: AccountProxy

    constructor(account: AccountProxy) {
        this.account = account
        this.instance = axios.create()

        // 如果提供了代理配置，设置代理
        if (this.account.url && this.account.proxyAxios) {
            const agent = this.getAgentForProxy(this.account)
            this.instance.defaults.httpAgent = agent
            this.instance.defaults.httpsAgent = agent
        }
    }

    private getAgentForProxy(proxyConfig: AccountProxy): HttpProxyAgent<string> | HttpsProxyAgent<string> | SocksProxyAgent {
        const { url, port, username, password } = proxyConfig

        // 构建包含认证的代理 URL
        let proxyUrl: string
        const hasAuth = username && password
        
        switch (true) {
            case url.startsWith('http://'):
                proxyUrl = hasAuth 
                    ? `http://${encodeURIComponent(username!)}:${encodeURIComponent(password!)}@${url.replace('http://', '')}:${port}`
                    : `${url}:${port}`
                return new HttpProxyAgent(proxyUrl)
                
            case url.startsWith('https://'):
                proxyUrl = hasAuth 
                    ? `https://${encodeURIComponent(username!)}:${encodeURIComponent(password!)}@${url.replace('https://', '')}:${port}`
                    : `${url}:${port}`
                return new HttpsProxyAgent(proxyUrl)
                
            case url.startsWith('socks://') || url.startsWith('socks4://') || url.startsWith('socks5://'):
                const protocol = url.split('://')[0]
                const host = url.split('://')[1] || url
                proxyUrl = hasAuth 
                    ? `${protocol}://${encodeURIComponent(username!)}:${encodeURIComponent(password!)}@${host}:${port}`
                    : `${protocol}://${host}:${port}`
                return new SocksProxyAgent(proxyUrl)
                
            default:
                throw new Error(`Unsupported proxy protocol in "${url}". Supported: http://, https://, socks://, socks4://, socks5://`)
        }
    }

    // 通用方法以发出任何Axios请求
    public async request(config: AxiosRequestConfig, bypassProxy = false): Promise<AxiosResponse> {
        if (bypassProxy) {
            const bypassInstance = axios.create()
            return bypassInstance.request(config)
        }

        let lastError: unknown
        const maxAttempts = 2
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.instance.request(config)
            } catch (err: unknown) {
                lastError = err
                const axiosErr = err as AxiosError | undefined

                // 检测HTTP代理身份验证失败（状态407）并重试无代理
                if (axiosErr && axiosErr.response && axiosErr.response.status === 407) {
                    if (attempt < maxAttempts) {
                        await this.sleep(1000 * attempt) // 指数退避
                    }
                    const bypassInstance = axios.create()
                    return bypassInstance.request(config)
                }

                // 如果代理请求因常见代理/网络错误而失败，使用退避重试
                const e = err as { code?: string; cause?: { code?: string }; message?: string } | undefined
                const code = e?.code || e?.cause?.code
                const isNetErr = code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND'
                const msg = String(e?.message || '')
                const looksLikeProxyIssue = /proxy|tunnel|socks|agent/i.test(msg)
                
                if (isNetErr || looksLikeProxyIssue) {
                    if (attempt < maxAttempts) {
                        // 指数退避：1s，2s，4s等。
                        const delayMs = 1000 * Math.pow(2, attempt - 1)
                        await this.sleep(delayMs)
                        continue
                    }
                    // 最后尝试：尝试无代理
                    const bypassInstance = axios.create()
                    return bypassInstance.request(config)
                }
                
                // 不可重试错误
                throw err
            }
        }
        
        throw lastError
    }
    
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

export default AxiosClient