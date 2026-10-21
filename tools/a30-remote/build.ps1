[CmdletBinding()]
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $src 'dist' }
$build = Join-Path $src 'build'
$cache = Join-Path $build 'cache'
$dist = [IO.Path]::GetFullPath($OutputDirectory)
$buildId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$win = Join-Path $build ('windows-payload-'+$buildId)
$linux = Join-Path $build ('linux-payload-'+$buildId)
$vendor = Join-Path $build ('vendor-'+$buildId)
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $csc)) { throw 'Compilador .NET Framework x64 ausente.' }
New-Item -ItemType Directory -Force -Path "$win\bin","$linux\bin",$vendor,$cache,$dist | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-VerifiedArchive([string]$name,[string]$expected) {
    $path = Join-Path $cache $name
    if (!(Test-Path -LiteralPath $path)) {
        Invoke-WebRequest -UseBasicParsing -Uri ('https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/'+$name) -OutFile $path
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $expected) { throw "SHA256 incorreto: $path. Arquivo preservado para inspecao." }
    return $path
}
$winArchive = Get-VerifiedArchive 'scrcpy-win64-v5.0.1.zip' 'b12a2c4ee8be317422451fc7dcf8ee20a71b5ea7ef9ad73ddd825a25316227a5'
$linuxArchive = Get-VerifiedArchive 'scrcpy-linux-x86_64-v5.0.1.tar.gz' '9f969d30cc574816077edecda65719c1c70b0aee1df1ba5fa00779ac07b8fd6e'
Expand-Archive -LiteralPath $winArchive -DestinationPath $vendor
Copy-Item "$vendor\scrcpy-win64-v5.0.1\*" "$win\bin"
foreach ($file in @('A30-Remote.ps1','Desinstalar.ps1','known_hosts','LEIA-ME.txt')) { Copy-Item (Join-Path $src $file) $win }
foreach ($file in @('a30-remote','known_hosts','LEIA-ME.txt')) { Copy-Item (Join-Path $src $file) $linux }
& tar -xzf $linuxArchive -C "$linux\bin" --strip-components=1
if ($LASTEXITCODE -ne 0) { throw 'Extracao Linux falhou' }
foreach ($path in @("$linux\a30-remote","$linux\known_hosts","$linux\LEIA-ME.txt")) {
    $content = [IO.File]::ReadAllText($path).Replace("`r`n","`n")
    [IO.File]::WriteAllText($path,$content,(New-Object Text.UTF8Encoding($false)))
}
& $csc /nologo /target:exe /platform:x64 /optimize+ /out:"$win\A30-Remoto.exe" "$src\Client.cs"
if ($LASTEXITCODE -ne 0) { throw 'Compilacao do cliente falhou' }
Compress-Archive -Path "$win\*" -DestinationPath "$build\payload-windows.zip" -Force
& $csc /nologo /target:winexe /platform:x64 /optimize+ /reference:System.IO.Compression.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:Microsoft.CSharp.dll /resource:"$build\payload-windows.zip",install.zip /out:"$dist\Instalar-A30-Windows-x64.exe" "$src\Setup.cs"
if ($LASTEXITCODE -ne 0) { throw 'Compilacao Windows falhou' }
& tar -czf "$build\payload-linux.tar.gz" -C $linux .
if ($LASTEXITCODE -ne 0) { throw 'Empacotamento Linux falhou' }
$hash = (Get-FileHash "$build\payload-linux.tar.gz").Hash.ToLowerInvariant()
$header = [IO.File]::ReadAllText("$src\install-linux-header.sh").Replace("`r`n","`n").Replace('__PAYLOAD_SHA256__',$hash)
if (!$header.EndsWith("`n")) { $header += "`n" }
$stream = [IO.File]::Create("$dist\Instalar-A30-Linux-x86_64.run")
try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($header)
    $stream.Write($bytes,0,$bytes.Length)
    $payload = [IO.File]::OpenRead("$build\payload-linux.tar.gz")
    try { $payload.CopyTo($stream) } finally { $payload.Dispose() }
} finally { $stream.Dispose() }
foreach ($file in @('LEIA-ME.txt','VALIDACAO.md')) { Copy-Item (Join-Path $src $file) $dist }
$sourceFiles = Get-ChildItem -LiteralPath $src -File
Compress-Archive -LiteralPath $sourceFiles.FullName -DestinationPath "$dist\A30-Remoto-Fontes.zip" -Force
Get-ChildItem $dist -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_.FullName).Hash.ToLowerInvariant(),$_.Name } | Set-Content -Encoding ascii "$dist\SHA256SUMS.txt"
Get-ChildItem $dist | Select-Object Name,Length
