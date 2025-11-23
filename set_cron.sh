#!/bin/bash

# 要添加的定时任务
CRON_JOB="30 1 * * * cd /root/Microsoft-Rewards-Script && /bin/bash start.sh >> /root/Microsoft-Rewards-Script/cron.log 2>&1"

# 检查是否已存在相同的任务，避免重复添加
(crontab -l 2>/dev/null | grep -F "$CRON_JOB") >/dev/null 2>&1
if [ $? -ne 0 ]; then
    # 追加定时任务到现有crontab
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
fi