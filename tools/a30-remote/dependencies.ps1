# Shared by the native installer, local build and installed client (PowerShell 5.1+).
function ConvertTo-A30RemoteCommand([string]$Script) {
    $encodedScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script.Replace("`r`n","`n")))
    return "printf %s $encodedScript | base64 -d | sh"
}

function Get-A30FreePortCommand {
    return ConvertTo-A30RemoteCommand @'
python - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
'@
}

function Get-A30KeyRegistrationCommand([string]$PublicKey) {
    if ($PublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') { throw 'Chave publica SSH invalida.' }
    $encodedKey = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PublicKey))
    # Encode the complete script: Windows native argument handling must not strip
    # the remote shell's quotes around the public key or HOME.
    $script = @'
set -eu
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
k=$(printf %s __PUBLIC_KEY__ | base64 -d)
grep -qxF "$k" "$HOME/.ssh/authorized_keys" || printf '\n%s\n' "$k" >> "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
'@
    $script = $script.Replace('__PUBLIC_KEY__',$encodedKey).Replace("`r`n","`n")
    return ConvertTo-A30RemoteCommand $script
}

function New-A30SshKey([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source
    # PS 5.1 drops an empty native argument; construct the quoted -N argument explicitly.
    $info.Arguments = '-q -t ed25519 -N "" -C a30-remote-client -f "' + $Path + '"'
    $info.UseShellExecute = $false
    $process = [Diagnostics.Process]::Start($info)
    try {
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw 'Falha ao criar a chave SSH.' }
    } finally { $process.Dispose() }
}

function Test-A30SshConnection([string]$Config, [string]$Destination, [string]$SshExe = (Get-Command ssh.exe -ErrorAction Stop).Source) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $SshExe
    $info.Arguments = '-F "' + $Config + '" -n -o BatchMode=yes ' + $Destination + ' true'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardOutput = $true
    $process = [Diagnostics.Process]::Start($info)
    try {
        $null = $process.StandardError.ReadToEnd()
        $null = $process.StandardOutput.ReadToEnd()
        $process.WaitForExit()
        return $process.ExitCode -eq 0
    } finally { $process.Dispose() }
}

function Resolve-A30Tool([string]$Name, [string]$Root = $PSScriptRoot) {
    $candidates = @()
    $saved = Join-Path $Root 'tool-paths.json'
    if (Test-Path -LiteralPath $saved) {
        try { $candidates += (Get-Content -LiteralPath $saved -Raw | ConvertFrom-Json).$Name } catch {}
    }
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $candidates += $command.Source }
    # A freshly installed WinGet portable package may not be in this process's PATH.
    foreach ($scopePath in @([Environment]::GetEnvironmentVariable('Path','User'),[Environment]::GetEnvironmentVariable('Path','Machine'))) {
        foreach ($directory in ($scopePath -split ';')) {
            if ($directory) { $candidates += Join-Path ([Environment]::ExpandEnvironmentVariables($directory.Trim('"'))) $Name }
        }
    }
    $packages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $packages) {
        foreach ($package in (Get-ChildItem -LiteralPath $packages -Directory | Where-Object { $_.Name -like 'Genymobile.scrcpy_*' -or $_.Name -like 'Google.PlatformTools_*' })) {
            $candidates += Get-ChildItem -LiteralPath $package.FullName -Recurse -File -Filter $Name | Select-Object -ExpandProperty FullName
        }
    }
    $candidates += Join-Path $Root "bin\$Name"
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return [IO.Path]::GetFullPath($candidate) }
    }
    return $null
}

function Test-A30Dependencies([string]$Root = $PSScriptRoot) {
    $adb = Resolve-A30Tool 'adb.exe' $Root
    $scrcpy = Resolve-A30Tool 'scrcpy.exe' $Root
    if (!$adb -or !$scrcpy) { throw 'ADB/scrcpy ausentes. Execute install.ps1 para instalar as dependencias.' }
    & $adb version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'ADB nao executou corretamente.' }
    $version = (& $scrcpy --version 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $version -notmatch 'scrcpy\s+(\d+)' -or [int]$Matches[1] -lt 2) { throw 'scrcpy >= 2 e necessario.' }
    $helpText = (& $scrcpy --help 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'scrcpy --help falhou.' }
    foreach ($option in @('--force-adb-forward','--tunnel-host','--tunnel-port','--no-audio','--max-fps','--video-bit-rate','--time-limit')) {
        if (!$helpText.Contains($option)) { throw "Atualize scrcpy: falta a opcao $option." }
    }
    foreach ($tool in @('ssh.exe','ssh-keygen.exe')) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw 'OpenSSH Client ausente. Instale o recurso OpenSSH Client do Windows e tente novamente.' }
    }
    return @{ 'adb.exe' = $adb; 'scrcpy.exe' = $scrcpy }
}
