# Run with PowerShell on Linux to execute the actual serialized remote commands.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dependencies.ps1')
$stage = Join-Path ([IO.Path]::GetTempPath()) ('a30-remote-test-' + [Guid]::NewGuid())
$originalHome = $env:HOME
$originalPath = $env:PATH
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $env:HOME = Join-Path $stage 'home with spaces'
    New-Item -ItemType Directory -Path $env:HOME | Out-Null
    & ln -s (Get-Command python3 -ErrorAction Stop).Source (Join-Path $stage 'python')
    if ($LASTEXITCODE -ne 0) { throw 'Python fixture setup failed.' }
    $env:PATH = $stage + [IO.Path]::PathSeparator + $env:PATH
    $publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly comment with spaces'
    $registration = Get-A30KeyRegistrationCommand $publicKey
    [IO.File]::WriteAllText((Join-Path $stage 'register.sh'),$registration)
    & sh (Join-Path $stage 'register.sh')
    if ($LASTEXITCODE -ne 0) { throw 'First registration failed.' }
    & sh (Join-Path $stage 'register.sh')
    if ($LASTEXITCODE -ne 0) { throw 'Repeat registration failed.' }
    $authorized = Join-Path $env:HOME '.ssh/authorized_keys'
    $lines = @(Get-Content -LiteralPath $authorized | Where-Object { $_ })
    if ($lines.Count -ne 1 -or $lines[0] -cne $publicKey) { throw 'Public key split, duplicated or corrupted.' }
    $mode = & stat -c '%a' $authorized
    if ($mode -ne '600') { throw 'Incorrect authorized_keys permissions.' }
    [IO.File]::WriteAllText((Join-Path $stage 'port.sh'),(Get-A30FreePortCommand))
    $port = & sh (Join-Path $stage 'port.sh')
    if ($LASTEXITCODE -ne 0 -or [int]$port -le 0 -or [int]$port -gt 65535) { throw 'Remote port reservation failed.' }
    Write-Host 'OK: serialized remote commands preserve quotes, register one complete key idempotently and reserve a loopback port.'
} finally {
    $env:HOME = $originalHome
    $env:PATH = $originalPath
    if ((Split-Path -Parent $stage) -ne ([IO.Path]::GetTempPath()).TrimEnd('/')) { throw 'Unexpected temporary path.' }
    Remove-Item -LiteralPath $stage -Recurse -Force
}
