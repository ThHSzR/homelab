[CmdletBinding()]
param([switch]$Check, [string]$Ref = 'main', [switch]$SkipDependencies, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'No Linux, use bash install.sh.' }
if ($Ref -notmatch '^[A-Za-z0-9._/-]+$' -or $Ref.Contains('..')) { throw 'Ref invalida.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$stage = Join-Path ([IO.Path]::GetTempPath()) ('a30-install-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    $source = $PSScriptRoot
    if (!$source -or !(Test-Path -LiteralPath (Join-Path $source 'Setup.cs'))) {
        $source = Join-Path $stage 'source'
        New-Item -ItemType Directory -Path $source | Out-Null
        foreach ($file in @('build.ps1','dependencies.ps1','A30-Remote.ps1','Desinstalar.ps1','Client.cs','Setup.cs','known_hosts','LEIA-ME.txt')) {
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri "https://raw.githubusercontent.com/ThHSzR/homelab/$Ref/tools/a30-remote/$file" -OutFile (Join-Path $source $file)
            if ((Get-Item -LiteralPath (Join-Path $source $file)).Length -eq 0) { throw "Fonte vazio: $file" }
        }
    }
    . (Join-Path $source 'dependencies.ps1')
    foreach ($tool in @('ssh.exe','ssh-keygen.exe')) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw 'Habilite o recurso OpenSSH Client do Windows e execute novamente.' }
    }
    $dependencyFailure = $null
    try { $null = Test-A30Dependencies $source } catch { $dependencyFailure = $_ }
    if ($dependencyFailure) {
        if ($Check -or $SkipDependencies) { throw $dependencyFailure }
        if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Instale o Instalador de Aplicativo (WinGet) pela Microsoft Store e execute este comando novamente.' }
        Write-Host 'Instalando scrcpy/ADB pelo WinGet...'
        & winget.exe install --id Genymobile.scrcpy --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity
        if ($LASTEXITCODE -ne 0) { throw "WinGet falhou (codigo $LASTEXITCODE). Execute winget install --id Genymobile.scrcpy --exact e tente novamente." }
        $null = Test-A30Dependencies $source
    }
    if ($Check) { Write-Host 'Dependencias OK. Nenhuma instalacao ou conexao realizada.'; return }
    $installed = Join-Path $env:LOCALAPPDATA 'Programs\A30Remoto'
    foreach ($running in (Get-Process -Name A30-Remoto -ErrorAction SilentlyContinue)) {
        if ($running.Path -eq (Join-Path $installed 'A30-Remoto.exe')) { throw 'Feche A30 Remoto e execute o instalador novamente.' }
    }
    $dist = Join-Path $stage 'dist'
    & (Join-Path $source 'build.ps1') -OutputDirectory $dist
    $installer = Join-Path $dist 'Instalar-A30-Windows-x64.exe'
    $process = Start-Process -FilePath $installer -ArgumentList '--silent' -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        $errorFile = Join-Path ([IO.Path]::GetTempPath()) 'a30-installer-error.log'
        $reason = if (Test-Path -LiteralPath $errorFile) { Get-Content -LiteralPath $errorFile -First 1 } else { "Codigo $($process.ExitCode)" }
        throw "Instalacao falhou: $reason"
    }
    & (Join-Path $installed 'A30-Remoto.exe') --ajuda | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'O cliente instalado falhou ao abrir em modo ajuda.' }
    Write-Host "Instalado e verificado. Abra A30 Remoto no menu Iniciar. Pasta: $installed"
    Write-Host 'No primeiro acesso, escolha Configurar SSH para autorizar esta maquina no Termux.'
    if (!$NoLaunch) { Start-Process -FilePath (Join-Path $installed 'A30-Remoto.exe') -WindowStyle Normal | Out-Null }
} finally {
    if ((Split-Path -Parent $stage) -ne ([IO.Path]::GetTempPath()).TrimEnd('\')) { throw 'Destino temporario inesperado.' }
    Remove-Item -LiteralPath $stage -Recurse -Force
}
