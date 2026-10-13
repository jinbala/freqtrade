param(
    [ValidateSet('Setup', 'Start', 'Stop', 'Status', 'Check', 'Download', 'Backtest')]
    [string]$Action = 'Status',
    [switch]$Foreground,
    [ValidateRange(2, 3650)]
    [int]$Days = 30
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PythonExe = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$ConfigFile = Join-Path $RepoRoot 'user_data\config-btc-dryrun.json'
$PidFile = Join-Path $RepoRoot 'user_data\btc-dryrun.pid'
$LogFile = Join-Path $RepoRoot 'user_data\logs\btc-dryrun.log'
Set-Location -LiteralPath $RepoRoot

function Invoke-Freqtrade {
    param([string[]]$CliArgs)
    & $PythonExe -m freqtrade @CliArgs
    if ($LASTEXITCODE -ne 0) { throw "Freqtrade exited with code $LASTEXITCODE" }
}

function Get-BotProcess {
    if (!(Test-Path -LiteralPath $PidFile)) { return $null }
    $BotPid = [int](Get-Content -LiteralPath $PidFile -Raw).Trim()
    $BotProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $BotPid"
    if (!$BotProcess) { return $null }
    if ($BotProcess.CommandLine -notlike '*freqtrade*trade*--dry-run*' -or
        $BotProcess.CommandLine -notlike '*user_data/config-btc-dryrun.json*' -or
        $BotProcess.CommandLine -notlike "*$RepoRoot*") {
        throw "PID $BotPid does not belong to this paper-trading bot."
    }
    return $BotProcess
}

function Invoke-BotApi {
    param([string]$Endpoint, [string]$Method = 'Get')
    $AuthText = '{0}:{1}' -f $Config.api_server.username, $Config.api_server.password
    $AuthValue = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AuthText))
    $ApiUrl = 'http://127.0.0.1:{0}/api/v1/{1}' -f $Config.api_server.listen_port, $Endpoint
    Invoke-RestMethod -Uri $ApiUrl -Method $Method -Headers @{Authorization = "Basic $AuthValue"} -TimeoutSec 10
}

if ($Action -eq 'Setup') {
    if (!(Test-Path -LiteralPath $PythonExe)) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create .venv.' }
    }
    & $PythonExe -m pip install -r requirements.txt -e .
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    foreach ($Subdir in @('logs', 'data', 'backtest_results')) {
        New-Item -ItemType Directory -Path (Join-Path $RepoRoot "user_data\$Subdir") -Force | Out-Null
    }
    if (!(Test-Path -LiteralPath $ConfigFile)) {
        $Template = Get-Content -LiteralPath 'config_examples\btc_dryrun.example.json' -Raw | ConvertFrom-Json
        $Template.api_server.password = [guid]::NewGuid().ToString('N')
        $Template.api_server.jwt_secret_key = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
        $Template.api_server.ws_token = [guid]::NewGuid().ToString('N')
        $Json = $Template | ConvertTo-Json -Depth 20
        [IO.File]::WriteAllText($ConfigFile, $Json, [Text.UTF8Encoding]::new($false))
    }
    Write-Output "Ready. Local API credentials are in $ConfigFile"
    exit 0
}

if (!(Test-Path -LiteralPath $PythonExe) -or !(Test-Path -LiteralPath $ConfigFile)) {
    throw 'Run scripts\btc-dryrun.ps1 Setup first.'
}
$Config = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
if ($Config.dry_run -ne $true -or $Config.trading_mode -ne 'spot' -or
    $Config.exchange.name -ne 'binance' -or
    @($Config.exchange.pair_whitelist).Count -ne 1 -or
    $Config.exchange.pair_whitelist[0] -ne 'BTC/USDT') {
    throw 'This launcher requires dry_run=true, Binance spot, and only BTC/USDT.'
}
if (@(Get-ChildItem Env:FREQTRADE__*).Count -gt 0) {
    throw 'Remove FREQTRADE__ environment overrides before using this dedicated launcher.'
}
if ($Config.api_server.listen_ip_address -ne '127.0.0.1' -or
    !$Config.api_server.enabled -or !$Config.api_server.password) {
    throw 'This launcher requires an authenticated API bound to 127.0.0.1.'
}
$CommonArgs = @('--config', 'user_data/config-btc-dryrun.json', '--userdir', 'user_data')
$StrategyArgs = @('--strategy', 'BtcEmaCross', '--strategy-path', 'strategies')
if ($Action -in @('Check', 'Start', 'Download', 'Backtest')) {
    & $PythonExe scripts/check-btc-dryrun.py
    if ($LASTEXITCODE -ne 0) { throw 'Resolved trading configuration or strategy is invalid.' }
}

switch ($Action) {
    'Check' {
        Invoke-Freqtrade -CliArgs (@('show-config') + $CommonArgs)
        Invoke-Freqtrade -CliArgs (@('list-strategies') + $CommonArgs + @('--strategy-path', 'strategies'))
        Invoke-Freqtrade -CliArgs (@('test-pairlist') + $CommonArgs)
    }
    'Download' {
        Invoke-Freqtrade -CliArgs (@('download-data') + $CommonArgs + @('--pairs', 'BTC/USDT', '--timeframes', '5m', '--days', "$Days"))
    }
    'Backtest' {
        Invoke-Freqtrade -CliArgs (@('backtesting') + $CommonArgs + $StrategyArgs + @('--cache', 'none', '--export', 'trades'))
    }
    'Status' {
        $BotProcess = Get-BotProcess
        if (!$BotProcess) { Write-Output 'Paper-trading bot is not running.'; exit 0 }
        Write-Output "PID: $($BotProcess.ProcessId)"
        $State = Invoke-BotApi -Endpoint 'show_config'
        $State | Select-Object state, dry_run, exchange, strategy, timeframe, stake_currency, stake_amount, max_open_trades
        Invoke-BotApi -Endpoint 'health'
        Invoke-BotApi -Endpoint 'count'
    }
    'Start' {
        if (Get-BotProcess) { throw 'This paper-trading bot is already running.' }
        $Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, [int]$Config.api_server.listen_port)
        try { $Listener.Start() } finally { $Listener.Stop() }
        $TradeArgs = @('trade', '--dry-run') + $CommonArgs + $StrategyArgs + @('--logfile', 'user_data/logs/btc-dryrun.log', '--no-color')
        if ($Foreground) {
            Invoke-Freqtrade -CliArgs $TradeArgs
        } else {
            $BotProcess = Start-Process -FilePath $PythonExe -ArgumentList (@('-m', 'freqtrade') + $TradeArgs) -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput 'user_data/logs/btc-dryrun.stdout.log' -RedirectStandardError 'user_data/logs/btc-dryrun.stderr.log'
            Set-Content -LiteralPath $PidFile -Value $BotProcess.Id -Encoding ascii
            $Ready = $false
            for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
                Start-Sleep -Seconds 1
                if (!(Get-BotProcess)) { throw "Bot exited during startup. Inspect $LogFile and btc-dryrun.stderr.log." }
                try {
                    $State = Invoke-BotApi -Endpoint 'show_config'
                    $Health = Invoke-BotApi -Endpoint 'health'
                    $Ready = $State.state -eq 'running' -and $State.dry_run -eq $true -and $null -ne $Health.last_process
                } catch { $Ready = $false }
                if ($Ready) { break }
            }
            if (!$Ready) { throw "Startup is still pending. Inspect $LogFile and run Status." }
            Write-Output "Paper-trading bot is running (PID $($BotProcess.Id)). Log: $LogFile"
            Write-Output ('Local dashboard: http://127.0.0.1:{0}' -f $Config.api_server.listen_port)
        }
    }
    'Stop' {
        $BotProcess = Get-BotProcess
        if (!$BotProcess) { Write-Output 'Paper-trading bot is not running.'; exit 0 }
        # Pause the trading loop before terminating the Windows background process.
        $null = Invoke-BotApi -Endpoint 'stop' -Method 'Post'
        $Stopped = $false
        for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
            Start-Sleep -Milliseconds 500
            if ((Invoke-BotApi -Endpoint 'show_config').state -eq 'stopped') {
                $Stopped = $true
                break
            }
        }
        if (!$Stopped) { throw 'Bot has not stopped trading; process was left running.' }
        # On Windows the venv executable is a launcher with a second Python child.
        # Stop that verified child as well, otherwise the API and bot stay alive.
        $Children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($BotProcess.ProcessId)")
        foreach ($Child in $Children) {
            if ($Child.CommandLine -like '*freqtrade*trade*--dry-run*' -and
                $Child.CommandLine -like '*user_data/config-btc-dryrun.json*' -and
                $Child.CommandLine -like "*$RepoRoot*") {
                Stop-Process -Id $Child.ProcessId
            }
        }
        Get-Process -Id $BotProcess.ProcessId -ErrorAction SilentlyContinue | Stop-Process
        Remove-Item -LiteralPath $PidFile
        Write-Output 'Paper-trading bot stopped. Simulated positions and history remain in SQLite.'
    }
}
