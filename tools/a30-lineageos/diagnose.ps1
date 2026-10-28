param(
    [Parameter(Mandatory = $true)][string]$AdbPath,
    [string]$Serial = 'RQ8M70A9WBP',
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) { throw "ADB não encontrado: $AdbPath" }
$devices = & $AdbPath devices -l
if ($LASTEXITCODE -ne 0 -or -not ($devices | Where-Object { $_ -match "^$([regex]::Escape($Serial))\s+device\b" })) {
    throw "Serial $Serial ausente ou não autorizado no ADB"
}
$model = (& $AdbPath -s $Serial shell getprop ro.product.model).Trim()
if ($LASTEXITCODE -ne 0 -or $model -ne 'SM-A305GT') { throw "Alvo divergente: $model" }

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("serial=$Serial")
foreach ($key in @(
    'sys.boot_completed', 'ro.product.model', 'ro.product.device', 'ro.product.board',
    'ro.build.fingerprint', 'ro.build.version.security_patch', 'ro.bootloader',
    'ro.boot.flash.locked', 'ro.boot.verifiedbootstate', 'ro.boot.vbmeta.device_state'
)) {
    $value = (& $AdbPath -s $Serial shell getprop $key).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Falha ao ler $key" }
    $lines.Add("$key=$value")
}
foreach ($entry in @(
    @{ Label = 'uname'; Args = @('uname', '-a') },
    @{ Label = 'meminfo'; Args = @('cat', '/proc/meminfo') },
    @{ Label = 'storage'; Args = @('df', '-h', '/data') },
    @{ Label = 'route'; Args = @('ip', 'route', 'get', '1.1.1.1') },
    @{ Label = 'battery'; Args = @('dumpsys', 'battery') }
)) {
    $result = & $AdbPath -s $Serial shell @($entry.Args)
    if ($LASTEXITCODE -ne 0) { throw "Falha na leitura: $($entry.Label)" }
    $lines.Add("[$($entry.Label)]")
    if ($entry.Label -eq 'meminfo') { $result = $result | Select-Object -First 5 }
    if ($entry.Label -eq 'battery') { $result = $result | Select-String 'USB powered|status:|health:|level:|temperature:' }
    foreach ($item in $result) { $lines.Add("$item") }
}
$packages = & $AdbPath -s $Serial shell pm list packages
if ($LASTEXITCODE -ne 0) { throw 'Falha na lista de pacotes' }
foreach ($package in @('com.termux', 'com.tailscale.ipn', 'org.fdroid.fdroid', 'com.topjohnwu.magisk')) {
    $installed = [bool]($packages | Where-Object { $_ -eq "package:$package" })
    $lines.Add("package.$package=$installed")
}
if ($OutputPath) {
    $parent = Split-Path -Parent $OutputPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "Diretório ausente: $parent" }
    $lines | Set-Content -LiteralPath $OutputPath -Encoding UTF8
} else {
    $lines
}
