export interface OAuth {
    // 访问令牌
    access_token: string;
    // 刷新令牌
    refresh_token: string;
    // 访问范围
    scope: string;
    // 令牌过期时间（秒）
    expires_in: number;
    // 扩展过期时间（秒）
    ext_expires_in: number;
    // foci 值
    foci: string;
    // 令牌类型
    token_type: string;
}