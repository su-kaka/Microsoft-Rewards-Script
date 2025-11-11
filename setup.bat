@echo off
setlocal enabledelayedexpansion

echo ===================================
echo 微软奖励脚本环境自动安装程序
echo ===================================
echo.

:: 检查Node.js是否已安装
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Node.js未安装，正在下载并安装...
    
    :: 创建临时目录
    mkdir %TEMP%\node-install >nul 2>nul
    cd %TEMP%\node-install
    
    :: 下载Node.js安装程序
    echo 正在下载Node.js安装程序...
    powershell -Command "(New-Object System.Net.WebClient).DownloadFile('https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi', 'node-installer.msi')"
    
    :: 安装Node.js
    echo 正在安装Node.js...
    start /wait msiexec /i node-installer.msi /quiet /norestart
    
    :: 清理临时文件
    cd %~dp0
    rmdir /s /q %TEMP%\node-install >nul 2>nul
    

    :: 检查Node.js是否可用
    where node >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo 警告：Node.js安装完成，但环境变量可能未生效。
        echo 请关闭此窗口，重新打开命令提示符，然后运行setup.bat继续安装。
        pause
        exit
    )
) else (
    echo Node.js已安装，版本信息：
    node -v
)

:: 检查pnpm是否已安装
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo npm更新...
    call npm install -g npm
    echo npm未安装，正在安装...

    if %ERRORLEVEL% neq 0 (
        echo 安装npm失败，请检查网络连接或手动安装。
        pause
        exit /b 1
    )
) else (
    echo npm已安装
)

echo.

:: 安装项目依赖
echo 正在安装项目依赖...
call npm install
if %ERRORLEVEL% neq 0 (
    echo 安装依赖失败，请检查网络连接或手动安装。
    pause
    exit /b 1
)

:: 安装Playwright
echo 正在安装Playwright...
call npm exec playwright install chromium
call npm exec playwright install msedge
if %ERRORLEVEL% neq 0 (
    echo 安装Playwright失败，请检查网络连接或手动安装。
    pause
    exit /b 1
)

:: 检查并准备账户配置文件
if not exist "src\accounts.jsonc" (
    if exist "src\accounts.example.jsonc" (
        echo 正在创建账户配置文件...
        copy "src\accounts.example.jsonc" "src\accounts.jsonc"
        echo 已创建accounts.jsonc文件，请在运行脚本前编辑此文件添加您的账户信息。
    ) else (
        echo 警告：未找到accounts.example.jsonc文件，请手动创建accounts.jsonc文件。
    )
) else (
    echo accounts.json文件已存在。
)

:: 构建项目
echo 正在构建项目...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo 构建项目失败，请检查错误信息。
    pause
    exit /b 1
)

:: 检查配置文件
if exist "dist\config.jsonc" (
    echo config.json文件已存在，请确保已按照您的喜好进行了配置。
) else (
    echo 警告：未找到config.jsonc文件，请确保该文件存在并已正确配置。
)

echo.
echo ===================================
echo 安装完成！
echo 后续步骤：
echo 1. dist\accounts.jsonc文件添加您的账户信息
echo 2. 检查并按需修改dist\config.jsonc配置文件
echo 3. 执行终端命令：npm start，或运行脚本：run.bat
echo ===================================

pause