$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$stage = Join-Path ([IO.Path]::GetTempPath()) ('a30-test-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    foreach ($file in (Get-ChildItem -LiteralPath $src -Filter '*.ps1')) {
        $tokens = $null; $parseErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$parseErrors)
        if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    }
    $fixture = Join-Path $stage 'source with spaces'
    New-Item -ItemType Directory -Path $fixture | Out-Null
    foreach ($file in @('install.ps1','build.ps1','dependencies.ps1','A30-Remote.ps1','Desinstalar.ps1','Client.cs','Setup.cs','known_hosts','LEIA-ME.txt')) {
        Copy-Item -LiteralPath (Join-Path $src $file) -Destination $fixture
    }
    $mockSource = @'
using System;
class Dependency {
    static void Main(string[] args) {
        var expected=Environment.GetEnvironmentVariable("A30_TEST_EXPECT_COMMAND");
        if(expected!=null) {
            if(args.Length==0 || args[args.Length-1]!=expected) Environment.Exit(1);
            return;
        }
        if(Environment.GetEnvironmentVariable("A30_TEST_SSH_FAIL")=="1") {
            Console.Error.WriteLine("Permission denied"); Environment.Exit(255);
        }
        if(args.Length>0 && args[0]=="--help") {
            Console.WriteLine("--force-adb-forward --tunnel-host --tunnel-port --no-audio --max-fps --video-bit-rate --time-limit");
        } else { Console.WriteLine("scrcpy "+(Environment.GetEnvironmentVariable("A30_TEST_VERSION")??"4.1")); }
    }
}
'@
    [IO.File]::WriteAllText((Join-Path $stage 'Dependency.cs'),$mockSource)
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $csc /nologo "/out:$stage\scrcpy.exe" "$stage\Dependency.cs"
    if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
    Copy-Item -LiteralPath "$stage\scrcpy.exe" -Destination "$stage\adb.exe"
    $paths = @{ 'scrcpy.exe' = "$stage\scrcpy.exe"; 'adb.exe' = "$stage\adb.exe" }
    [IO.File]::WriteAllText((Join-Path $fixture 'tool-paths.json'),($paths | ConvertTo-Json))
    . (Join-Path $fixture 'dependencies.ps1')
    $testKey = Join-Path $fixture 'test key'
    New-A30SshKey $testKey
    if (!(Test-Path -LiteralPath "$testKey.pub")) { throw 'Key creation failed in PS 5.1.' }
    $before = (Get-FileHash -LiteralPath $testKey).Hash
    New-A30SshKey $testKey
    if ((Get-FileHash -LiteralPath $testKey).Hash -ne $before) { throw 'Existing key was overwritten.' }
    $publicKey = [IO.File]::ReadAllText("$testKey.pub").Trim()
    foreach ($remoteCommand in @((Get-A30KeyRegistrationCommand $publicKey),(Get-A30FreePortCommand))) {
        $env:A30_TEST_EXPECT_COMMAND = $remoteCommand
        & "$stage\scrcpy.exe" -F 'config path with spaces' fixture-host $remoteCommand
        if ($LASTEXITCODE -ne 0) { throw 'Windows native arguments corrupted the encoded remote command.' }
    }
    Remove-Item Env:A30_TEST_EXPECT_COMMAND
    $env:A30_TEST_SSH_FAIL = '1'
    if (Test-A30SshConnection 'fixture config' 'fixture-host' "$stage\scrcpy.exe") { throw 'SSH denial was accepted.' }
    Remove-Item Env:A30_TEST_SSH_FAIL
    $resolved = Test-A30Dependencies $fixture
    if ($resolved['adb.exe'] -ne $paths['adb.exe']) { throw 'Saved dependency path was ignored.' }
    $oldPath = $env:PATH
    try {
        $env:PATH = ''
        if ((Resolve-A30Tool 'scrcpy.exe' $fixture) -ne $paths['scrcpy.exe']) { throw 'Resolution depends on PATH.' }
    } finally { $env:PATH = $oldPath }
    $env:A30_TEST_VERSION = '1.25'
    $rejected = $false
    try { $null = Test-A30Dependencies $fixture } catch { $rejected = $true }
    if (!$rejected) { throw 'Incompatible scrcpy was accepted.' }
    Remove-Item Env:A30_TEST_VERSION
    & (Join-Path $fixture 'install.ps1') -Check
    & (Join-Path $fixture 'build.ps1') -OutputDirectory (Join-Path $stage 'dist')
    $exe = Join-Path $stage 'dist\Instalar-A30-Windows-x64.exe'
    if (!(Test-Path -LiteralPath $exe)) { throw 'Installer missing.' }
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($exe))
    $resource = $assembly.GetManifestResourceStream('install.zip')
    if (!$resource) { throw 'Installer payload missing.' }
    $resource.Dispose()
    Write-Host 'OK: PowerShell parse, saved dependencies without PATH, incompatible version, Check, Windows compile and embedded payload.'
} finally {
    Remove-Item Env:A30_TEST_VERSION -ErrorAction SilentlyContinue
    Remove-Item Env:A30_TEST_SSH_FAIL -ErrorAction SilentlyContinue
    Remove-Item Env:A30_TEST_EXPECT_COMMAND -ErrorAction SilentlyContinue
    if ((Split-Path -Parent $stage) -ne ([IO.Path]::GetTempPath()).TrimEnd('\')) { throw 'Unexpected temporary path.' }
    Remove-Item -LiteralPath $stage -Recurse -Force
}
