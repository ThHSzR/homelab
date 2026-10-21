[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $src 'dist' }
$dist = [IO.Path]::GetFullPath($OutputDirectory)
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $csc)) { throw 'Compilador .NET Framework x64 ausente.' }
foreach ($dependency in @('ssh.exe','adb.exe','scrcpy.exe')) {
    if (!(Get-Command $dependency -ErrorAction SilentlyContinue)) { throw "Instale $dependency e adicione ao PATH." }
}
$stage = Join-Path ([IO.Path]::GetTempPath()) ('a30-build-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $stage,$dist | Out-Null
try {
    $payload = Join-Path $stage 'payload'
    New-Item -ItemType Directory -Path $payload | Out-Null
    foreach ($file in @('A30-Remote.ps1','Desinstalar.ps1','known_hosts','LEIA-ME.txt')) {
        Copy-Item -LiteralPath (Join-Path $src $file) -Destination $payload
    }
    & $csc /nologo /target:exe /platform:x64 /optimize+ "/out:$payload\A30-Remoto.exe" "$src\Client.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Compilacao do cliente falhou.' }
    Compress-Archive -Path "$payload\*" -DestinationPath "$stage\payload.zip"
    & $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.IO.Compression.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:Microsoft.CSharp.dll "/resource:$stage\payload.zip,install.zip" "/out:$dist\Instalar-A30-Windows-x64.exe" "$src\Setup.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Compilacao do instalador falhou.' }
    Write-Host "Instalador local: $dist\Instalar-A30-Windows-x64.exe"
} finally {
    # This unique temporary directory is owned by this invocation.
    if ((Split-Path -Parent $stage) -ne ([IO.Path]::GetTempPath()).TrimEnd('\')) { throw 'Destino temporario inesperado.' }
    Remove-Item -LiteralPath $stage -Recurse -Force
}
