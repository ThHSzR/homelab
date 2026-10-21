[CmdletBinding()]
param(
    [ValidateSet('menu', 'conectar', 'testar', 'configurar-ssh', 'diagnostico', 'ajuda')]
    [string]$Action = 'menu'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Data = Join-Path $env:LOCALAPPDATA 'A30Remote'
$Key = Join-Path $env:USERPROFILE '.ssh\a30_remote_ed25519'
. (Join-Path $Root 'dependencies.ps1')
$Adb = Resolve-A30Tool 'adb.exe' $Root
$Scrcpy = Resolve-A30Tool 'scrcpy.exe' $Root
$KnownHosts = Join-Path $Root 'known_hosts'
$Config = Join-Path $Data 'ssh_config'
$SshHost = 'a30-remote-gateway'
$Dest = '100.65.49.34'
$RemoteAdbSocket = '/data/data/com.termux/files/home/.local/share/a30-remote-gateway/adb.sock'
$ExpectedSerial = 'RQ8M70A9WBP'

New-Item -ItemType Directory -Force -Path $Data | Out-Null
if (-not (Test-Path -LiteralPath $Adb)) { throw "ADB ausente: $Adb" }
if (-not (Test-Path -LiteralPath $Scrcpy)) { throw "scrcpy ausente: $Scrcpy" }
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
    throw 'OpenSSH Client ausente. Instale o recurso OpenSSH Client do Windows.'
}

function Convert-ToSshPath([string]$Path) {
    return $Path.Replace('\', '/')
}

function Write-SshConfig {
    $lines = @(
        "Host $SshHost $Dest"
        "  HostName $Dest"
        '  Port 8022'
        '  User u0_a267'
        '  HostKeyAlgorithms ssh-ed25519'
        '  StrictHostKeyChecking yes'
        "  UserKnownHostsFile `"$(Convert-ToSshPath $KnownHosts)`""
        '  ConnectTimeout 10'
        '  ServerAliveInterval 20'
        '  ServerAliveCountMax 3'
    )
    if (Test-Path -LiteralPath $Key) {
        $lines += "  IdentityFile `"$(Convert-ToSshPath $Key)`""
    }
    $userConfig = Join-Path $env:USERPROFILE '.ssh\config'
    $lines += "Include `"$(Convert-ToSshPath $userConfig)`""
    [IO.File]::WriteAllLines($Config, $lines, [Text.UTF8Encoding]::new($false))
}

function Test-Ssh {
    return Test-A30SshConnection $Config $SshHost
}

function Configure-Ssh {
    Write-SshConfig
    if (Test-Ssh) {
        Write-Host 'SSH ja autorizado nesta maquina.'
        return
    }
    $sshDir = Split-Path -Parent $Key
    New-Item -ItemType Directory -Force -Path $sshDir | Out-Null
    if (-not (Test-Path -LiteralPath $Key)) {
        New-A30SshKey $Key
    }
    Write-SshConfig
    $publicKey = [IO.File]::ReadAllText("$Key.pub").Trim()
    if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') {
        throw 'Chave publica SSH invalida.'
    }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($publicKey))
    Write-Host 'Digite a senha SSH do Termux para cadastrar somente a chave publica desta maquina.'
    $remote = "umask 077; mkdir -p `"`$HOME/.ssh`"; touch `"`$HOME/.ssh/authorized_keys`"; k=`$(printf '%s' '$encoded' | base64 -d); grep -qxF `"`$k`" `"`$HOME/.ssh/authorized_keys`" || printf '\n%s\n' `"`$k`" >> `"`$HOME/.ssh/authorized_keys`"; chmod 700 `"`$HOME/.ssh`"; chmod 600 `"`$HOME/.ssh/authorized_keys`""
    & ssh.exe -F $Config -o BatchMode=no $SshHost $remote
    if ($LASTEXITCODE -ne 0 -or -not (Test-Ssh)) {
        Write-Host "Chave publica desta maquina: $publicKey"
        throw 'A autenticacao SSH por chave falhou. Cadastre a chave publica mostrada em authorized_keys.'
    }
    Write-Host 'SSH configurado. Nenhuma autorizacao ADB no celular e necessaria.'
}

function Get-FreeLocalPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Start-Gateway {
    if (-not (Test-Ssh)) { throw 'Entre na Tailnet e execute Configurar SSH.' }
    $output = & ssh.exe -F $Config -n -o BatchMode=yes $SshHost '$HOME/.local/bin/a30-adb-gateway start'
    if ($LASTEXITCODE -ne 0) {
        throw 'O gateway ADB central do Termux nao iniciou. Execute o provisionamento unico.'
    }
    $serial = @($output)[-1].Trim()
    if ($serial -notmatch '^[A-Za-z0-9._:-]+$') { throw 'O gateway retornou um serial invalido.' }
    return $serial
}

function Get-FreeRemotePort {
    $raw = & ssh.exe -F $Config -n -o BatchMode=yes $SshHost "python -c 'import socket; s=socket.socket(); s.bind((`"127.0.0.1`",0)); print(s.getsockname()[1]); s.close()'"
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel reservar a porta remota do scrcpy.' }
    return [int]$raw.Trim()
}

function Start-Tunnel([int]$AdbLocal, [int]$StreamLocal, [int]$StreamRemote) {
    $errorLog = Join-Path $Data 'ssh-session.log'
    $arguments = "-F `"$Config`" -n -o BatchMode=yes -o ExitOnForwardFailure=yes -N -T " +
        "-L 127.0.0.1:${AdbLocal}:$RemoteAdbSocket " +
        "-L 127.0.0.1:${StreamLocal}:127.0.0.1:$StreamRemote $SshHost"
    $process = Start-Process -FilePath 'ssh.exe' -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError $errorLog
    Start-Sleep -Seconds 2
    if ($process.HasExited) {
        $details = if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Raw } else { '' }
        throw "O tunel SSH nao iniciou. $details"
    }
    return $process
}

function Invoke-Session([bool]$TestOnly) {
    Write-SshConfig
    $remoteSerial = Start-Gateway
    $adbLocal = Get-FreeLocalPort
    do { $streamLocal = Get-FreeLocalPort } while ($streamLocal -eq $adbLocal)
    $streamRemote = Get-FreeRemotePort
    $tunnel = $null
    $oldSocket = $env:ADB_SERVER_SOCKET
    $oldAdb = $env:ADB
    try {
        $tunnel = Start-Tunnel $adbLocal $streamLocal $streamRemote
        $env:ADB_SERVER_SOCKET = "tcp:127.0.0.1:$adbLocal"
        $env:ADB = $Adb
        $state = (& $Adb -s $remoteSerial get-state 2>$null).Trim()
        if ($state -ne 'device') { throw 'O servidor ADB central nao apresentou o A30.' }
        $actual = (& $Adb -s $remoteSerial shell getprop ro.serialno).Trim()
        $model = (& $Adb -s $remoteSerial shell getprop ro.product.model).Trim()
        if ($actual -ne $ExpectedSerial -or $model -ne 'SM-A305GT') {
            throw 'O aparelho recebido nao e o Galaxy A30 esperado.'
        }
        $screenArgs = @(
            "--serial=$remoteSerial", '--force-adb-forward', "--port=$streamRemote",
            '--tunnel-host=127.0.0.1', "--tunnel-port=$streamLocal", '--no-audio',
            '--max-size=1280', '--max-fps=30', '--video-bit-rate=4M',
            '--keyboard=sdk', '--mouse=sdk', '--window-title=A30-Remoto', '--verbosity=debug'
        )
        if ($TestOnly) { $screenArgs += '--time-limit=6' }
        Write-Host 'Abrindo tela pelo gateway ADB central do Termux.'
        $stdout = Join-Path $Data 'scrcpy.stdout.log'
        $stderr = Join-Path $Data 'scrcpy.stderr.log'
        $screen = Start-Process -FilePath $Scrcpy -ArgumentList $screenArgs -WorkingDirectory (Split-Path $Scrcpy) -WindowStyle Normal -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -Wait
        if ($screen.ExitCode -ne 0) { throw "scrcpy falhou. Consulte $stderr" }
        if ($TestOnly -and -not ((Get-Content $stdout, $stderr -Raw) -match 'Texture')) {
            throw 'Teste terminou sem confirmar a decodificacao de video.'
        }
        Write-Host 'Sessao concluida.'
    }
    finally {
        if ($env:ADB_SERVER_SOCKET -and $remoteSerial -and $streamRemote) {
            & $Adb -s $remoteSerial forward --remove "tcp:$streamRemote" 2>$null | Out-Null
        }
        if ($tunnel -and -not $tunnel.HasExited) {
            Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
        }
        $env:ADB_SERVER_SOCKET = $oldSocket
        $env:ADB = $oldAdb
    }
}

function Invoke-Diagnostics {
    Write-SshConfig
    & $Adb version
    & $Scrcpy --version
    if (-not (Test-Ssh)) { throw 'SSH nao autorizado ou Tailnet indisponivel.' }
    & ssh.exe -F $Config -n -o BatchMode=yes $SshHost '$HOME/.local/bin/a30-adb-gateway status'
    if ($LASTEXITCODE -ne 0) { throw 'Gateway ADB central indisponivel.' }
    Write-Host 'SSH e gateway ADB central conferidos.'
}

function Show-Help {
    Get-Content (Join-Path $Root 'LEIA-ME.txt') -Encoding UTF8
}

function Execute-Action([string]$Choice) {
    switch ($Choice) {
        'conectar' { Invoke-Session $false }
        'testar' { Invoke-Session $true }
        'configurar-ssh' { Configure-Ssh }
        'diagnostico' { Invoke-Diagnostics }
        'ajuda' { Show-Help }
    }
}

Write-SshConfig
$lock = $null
try {
    $lock = New-Object Threading.Mutex($false, 'Local\A30RemoteClient')
    if (-not $lock.WaitOne(0)) { throw 'O A30 Remoto ja esta aberto nesta sessao do Windows.' }
    if ($Action -ne 'menu') {
        Execute-Action $Action
        exit 0
    }
    while ($true) {
        Write-Host "`nA30 REMOTO - gateway ADB central pelo Termux"
        Write-Host '1 Conectar tela'
        Write-Host '2 Configurar SSH desta maquina'
        Write-Host '3 Diagnostico'
        Write-Host '4 Instrucoes'
        Write-Host '0 Sair'
        $selection = Read-Host 'Opcao'
        if ($selection -eq '0') { break }
        $map = @{'1'='conectar'; '2'='configurar-ssh'; '3'='diagnostico'; '4'='ajuda'}
        if (-not $map.ContainsKey($selection)) { continue }
        try { Execute-Action $map[$selection] }
        catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    }
    exit 0
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
finally {
    if ($lock) { $lock.Dispose() }
}
