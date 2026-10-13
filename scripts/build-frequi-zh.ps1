param([switch]$RestoreEnglish)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PythonExe = Join-Path $RepoRoot '.venv\Scripts\python.exe'
$SourceRoot = Join-Path $RepoRoot 'user_data\frequi-zh'
Set-Location -LiteralPath $RepoRoot

if ($RestoreEnglish) {
    & $PythonExe ui_zh/install.py --restore
    exit $LASTEXITCODE
}
if (!(Test-Path -LiteralPath (Join-Path $SourceRoot 'package.json'))) {
    git clone --depth 1 --branch 3.1.3 https://github.com/freqtrade/frequi.git $SourceRoot
    if ($LASTEXITCODE -ne 0) { throw 'Failed to download the pinned official FreqUI source.' }
}
function Invoke-Npm {
    param([string[]]$CliArgs)
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & npm.cmd @CliArgs
    $CommandExit = $LASTEXITCODE
    $ErrorActionPreference = $PreviousPreference
    if ($CommandExit -ne 0) { throw "npm failed with exit code $CommandExit" }
}

Push-Location -LiteralPath $SourceRoot
try {
    if (!(Test-Path -LiteralPath 'node_modules\@vue\compiler-sfc')) {
        Invoke-Npm -CliArgs @('install', '--no-package-lock', '--no-audit', '--no-fund')
    }
} finally { Pop-Location }

node ui_zh/localize.mjs $SourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Chinese localization failed.' }
Copy-Item -LiteralPath ui_zh/localization.spec.ts -Destination (Join-Path $SourceRoot 'src\zhLocale.spec.ts')
Push-Location -LiteralPath $SourceRoot
try {
    Invoke-Npm -CliArgs @('run', 'build')
    Invoke-Npm -CliArgs @('run', 'typecheck')
    Invoke-Npm -CliArgs @('exec', 'vitest', 'run', 'src/zhLocale.spec.ts')
} finally { Pop-Location }

& $PythonExe ui_zh/install.py
if ($LASTEXITCODE -ne 0) { throw 'Could not install the Chinese UI.' }
