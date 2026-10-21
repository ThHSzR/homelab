param([ValidateSet('menu','conectar','usb','configurar-ssh','diagnostico','desativar-adb','testar','ajuda')][string]$Action='menu')
$ErrorActionPreference = 'Stop'
$adb = Join-Path $PSScriptRoot 'bin\adb.exe'
$scrcpy = Join-Path $PSScriptRoot 'bin\scrcpy.exe'
$ssh = (Get-Command ssh.exe -ErrorAction SilentlyContinue).Source
if (!$ssh) { throw 'OpenSSH Client ausente. Instale o recurso OpenSSH Client do Windows e abra novamente.' }
$dataRoot = Join-Path $env:LOCALAPPDATA 'A30Remote'
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$key = Join-Path $env:USERPROFILE '.ssh\a30_remote_ed25519'
$config = Join-Path $dataRoot 'ssh_config'
$destination = '100.65.49.34'
$serial = 'RQ8M70A9WBP'

function Write-SshConfig {
    $known = (Join-Path $PSScriptRoot 'known_hosts').Replace('\','/')
    $lines = @('Host 100.65.49.34','  HostName 100.65.49.34','  Port 8022','  User u0_a267','  HostKeyAlgorithms ssh-ed25519','  StrictHostKeyChecking yes',('  UserKnownHostsFile "'+$known+'"'),'  ConnectTimeout 10','  ServerAliveInterval 20','  ServerAliveCountMax 3')
    if (Test-Path -LiteralPath $key) { $lines += '  IdentityFile "'+$key.Replace('\','/')+'"' }
    $lines += 'Include "'+(Join-Path $env:USERPROFILE '.ssh\config').Replace('\','/')+'"'
    [IO.File]::WriteAllLines($config,$lines,(New-Object Text.UTF8Encoding($false)))
}
Write-SshConfig

function Test-Ssh {
    & $ssh -F $config -o BatchMode=yes $destination true
    return ($LASTEXITCODE -eq 0)
}
function Setup-Ssh {
    if (Test-Ssh) { Write-Host 'SSH ja autorizado nesta maquina.'; return }
    if (!(Test-Path -LiteralPath $key)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $key) | Out-Null
        $generator = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $generator
        $info.Arguments = '-q -t ed25519 -N "" -C "a30-remote-client" -f "'+$key+'"'
        $info.UseShellExecute = $false
        $process = [Diagnostics.Process]::Start($info)
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw 'Falha ao criar chave SSH local.' }
    }
    Write-SshConfig
    $public = (Get-Content -LiteralPath ($key+'.pub') -Raw).Trim()
    if ($public -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') { throw 'Chave publica invalida.' }
    Write-Host 'Autorize esta maquina com a senha SSH do Termux (a senha nao sera salva).'
    Write-Host 'Se o Termux nao tem senha configurada, execute passwd nele primeiro.'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($public))
    $enroll = @'
set -e
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
k=$(printf '%s' '__KEY__' | base64 -d)
grep -qxF "$k" "$HOME/.ssh/authorized_keys" || printf '\n%s\n' "$k" >> "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
'@.Replace('__KEY__',$encoded)
    $enroll | & $ssh -F $config -o BatchMode=no $destination sh -s
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Chave publica desta maquina: $public"
        throw 'Nao foi possivel cadastrar a chave. Adicione a chave publica ao ~/.ssh/authorized_keys do Termux e tente novamente. Nunca copie a chave privada de outro computador.'
    }
    if (!(Test-Ssh)) { throw 'A chave foi enviada, mas o SSH sem senha ainda nao funcionou.' }
    Write-Host 'SSH configurado. A chave privada ficou somente nesta maquina.'
}
function Prepare-Usb {
    $devices = & $adb devices
    if (!($devices -match ('^'+[regex]::Escape($serial)+'\s+device\s*$'))) { throw 'Conecte o A30 por USB nesta maquina e aceite a autorizacao ADB no Android.' }
    & $adb -s $serial tcpip 5555
    if ($LASTEXITCODE -ne 0) { throw 'Android recusou ADB TCP.' }
    Start-Sleep -Seconds 2
}
function Run-Session([bool]$disable,[bool]$smoke) {
    if (!(Test-Ssh)) { throw 'SSH indisponivel. Entre na mesma tailnet e use Configurar SSH no menu.' }
    $probe = @'
python -c 'import socket; s=socket.create_connection(("127.0.0.1",5555),5); s.close()'
'@
    $probe | & $ssh -F $config -o BatchMode=yes $destination sh -s
    if ($LASTEXITCODE -ne 0) { throw 'ADB TCP do A30 desligado. Conecte USB em uma maquina autorizada e ative TCP 5555; nao e necessario root.' }
    $reservation = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    $reservation.Start(); $port = $reservation.LocalEndpoint.Port; $reservation.Stop()
    $endpoint = '127.0.0.1:'+$port
    $sshArgs = '-F "'+$config+'" -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -L 127.0.0.1:'+ $port +':127.0.0.1:5555 '+$destination
    $tunnel = $null
    $oldAdb = $env:ADB
    try {
        $tunnel = Start-Process -FilePath $ssh -ArgumentList $sshArgs -WindowStyle Hidden -RedirectStandardError "$dataRoot\ssh-session.log" -PassThru
        Start-Sleep -Seconds 2
        if ($tunnel.HasExited) { throw "Falha no tunel: $(Get-Content "$dataRoot\ssh-session.log" -Raw)" }
        & $adb connect $endpoint
        Write-Host 'Se aparecer uma solicitacao ADB no A30, aceite a chave desta maquina.'
        $authorized = $false
        for ($attempt=0; $attempt -lt 30; $attempt++) {
            $devices = & $adb devices
            if ($devices -match ('^'+[regex]::Escape($endpoint)+'\s+device\s*$')) { $authorized=$true; break }
            if ($tunnel.HasExited) { break }
            Start-Sleep -Seconds 1
        }
        if (!$authorized) { throw 'ADB TCP nao autorizado. Aceite a chave no Android ou autorize esta maquina por USB. As chaves existentes foram preservadas.' }
        $actual = & $adb -s $endpoint shell getprop ro.serialno
        if ($LASTEXITCODE -ne 0 -or $actual.Trim() -ne $serial) { throw 'O aparelho recebido nao e o A30 esperado.' }
        if ($disable) {
            & $adb -s $endpoint usb
            if ($LASTEXITCODE -ne 0) { throw 'Falha ao desativar ADB TCP.' }
            Start-Sleep -Seconds 2
            $closedProbe = @'
python -c 'import socket,sys; s=socket.socket(); s.settimeout(3); r=s.connect_ex(("127.0.0.1",5555)); s.close(); sys.exit(0 if r else 1)'
'@
            $closedProbe | & $ssh -F $config -o BatchMode=yes $destination sh -s
            if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel confirmar o fechamento de 5555.' }
            Write-Host 'ADB TCP desativado. Para conectar novamente, reative por USB.'
            return
        }
        Write-Host 'Abrindo tela. Fechar o scrcpy encerra este tunel, mantendo ADB TCP para reconectar.'
        $env:ADB = $adb
        $screenArgs = @("--serial=$endpoint",'--force-adb-forward','--no-audio','--max-size=1280','--max-fps=30','--video-bit-rate=4M','--keyboard=sdk','--mouse=sdk','--window-title=A30-Remoto','--verbosity=debug')
        if ($smoke) { $screenArgs += '--time-limit=6' }
        $screen = Start-Process -FilePath $scrcpy -ArgumentList $screenArgs -WorkingDirectory (Split-Path $scrcpy) -WindowStyle Normal -RedirectStandardOutput "$dataRoot\scrcpy.stdout.log" -RedirectStandardError "$dataRoot\scrcpy.stderr.log" -PassThru -Wait
        if ($screen.ExitCode -ne 0) { throw "scrcpy falhou. Consulte $dataRoot\scrcpy.stderr.log" }
        if ($smoke -and !((Get-Content "$dataRoot\scrcpy.stdout.log" -Raw) -match 'Texture')) { throw 'Teste terminou sem confirmar decodificacao de video.' }
        Write-Host 'Sessao concluida.'
    } finally {
        $env:ADB = $oldAdb
        & $adb disconnect $endpoint
        if ($tunnel -and !$tunnel.HasExited) { $tunnel.Kill(); $tunnel.WaitForExit() }
    }
}
function Diagnostics {
    & $adb version
    & $scrcpy --version
    & $adb devices -l
    if (!(Test-Ssh)) { throw 'SSH nao autorizado ou tailnet indisponivel.' }
    & $ssh -F $config -o BatchMode=yes $destination 'getprop ro.product.model; getprop service.adb.tcp.port'
    if ($LASTEXITCODE -ne 0) { throw 'Falha no diagnostico SSH.' }
    Write-Host 'SSH e chave do servidor conferidos. Nenhum servico remoto foi alterado.'
}
function Execute-Action([string]$choice) {
    switch ($choice) {
        'conectar' { Run-Session $false $false }
        'usb' { Prepare-Usb; Run-Session $false $false }
        'configurar-ssh' { Setup-Ssh }
        'diagnostico' { Diagnostics }
        'desativar-adb' { Run-Session $true $false }
        'testar' { Run-Session $false $true }
        'ajuda' { Get-Content (Join-Path $PSScriptRoot 'LEIA-ME.txt') -Encoding UTF8 }
    }
}
try {
    $lock = New-Object Threading.Mutex($false,'Local\A30RemoteClient')
    if (!$lock.WaitOne(0)) { throw 'O A30 Remoto ja esta aberto nesta sessao do Windows.' }
    if ($Action -ne 'menu') { Execute-Action $Action; exit 0 }
    while ($true) {
        Write-Host "`nA30 REMOTO - SSH pela tailnet"
        Write-Host '1 Conectar tela'
        Write-Host '2 Ativar ADB TCP por USB e conectar'
        Write-Host '3 Configurar SSH desta maquina'
        Write-Host '4 Diagnostico'
        Write-Host '5 Desativar ADB TCP (exige USB para voltar)'
        Write-Host '6 Instrucoes'
        Write-Host '0 Sair'
        $selection = Read-Host 'Opcao'
        if ($selection -eq '0') { break }
        $map = @{'1'='conectar';'2'='usb';'3'='configurar-ssh';'4'='diagnostico';'5'='desativar-adb';'6'='ajuda'}
        if (!$map.ContainsKey($selection)) { continue }
        if ($selection -eq '5' -and (Read-Host 'Isso corta o acesso remoto ADB. Digite DESATIVAR para continuar') -cne 'DESATIVAR') { continue }
        try { Execute-Action $map[$selection] } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    }
    exit 0
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
finally { if ($lock) { $lock.Dispose() } }
