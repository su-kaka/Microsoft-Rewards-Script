#!/bin/sh
set -e

# 设置时区
if [ ! -z "$TZ" ]; then
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime
    echo $TZ > /etc/timezone
fi

# 确保配置文件存在
if [ ! -f "src/accounts.json" ]; then
    echo "Error: accounts.json not found. Please mount it or create it."
    exit 1
fi

# 设置 cron 任务
if [ -f "/etc/cron.d/microsoft-rewards-cron.template" ]; then
    # 替换模板中的占位符
    sed -i "s|SCRIPT_PATH|/usr/src/microsoft-rewards-script/src/run_daily.sh|g" /etc/cron.d/microsoft-rewards-cron.template
    
    # 启用 cron 任务
    cp /etc/cron.d/microsoft-rewards-cron.template /etc/cron.d/microsoft-rewards-cron
    chmod 0644 /etc/cron.d/microsoft-rewards-cron
    
    # 启动 cron 服务
    echo "Starting cron service..."
    service cron start
    
    # 检查 cron 服务状态
    if service cron status; then
        echo "Cron service started successfully"
    else
        echo "Warning: Cron service failed to start"
    fi
else
    echo "Warning: Cron template not found at /etc/cron.d/microsoft-rewards-cron.template"
fi

# 启动应用
echo "Starting Microsoft Rewards Script..."
exec "$@"
