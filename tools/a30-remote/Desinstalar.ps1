param([switch]$Quiet)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
    if (!$Quiet) {
        $answer=[Windows.Forms.MessageBox]::Show('Remover A30 Remoto? Suas chaves SSH/ADB e logs serao preservados.','Desinstalar A30 Remoto',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2)
        if ($answer -ne [Windows.Forms.DialogResult]::Yes) { exit 0 }
    }
    $expected=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\A30Remoto')).TrimEnd('\')
    $actual=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
    if ($actual -ine $expected) { throw 'Pasta inesperada: nenhuma remocao realizada.' }
    if ((Get-Item -LiteralPath $actual).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Pasta e um link: nenhuma remocao realizada.' }
    $marker=Join-Path $actual '.a30-install-marker'
    if (!(Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw) -ne 'A30RemoteInstall:v1') { throw 'Marcador de instalacao ausente: nenhuma remocao realizada.' }
    $exe=Join-Path $actual 'A30-Remoto.exe'
    $running=Get-CimInstance Win32_Process -Filter "name = 'A30-Remoto.exe'" | Where-Object { $_.ExecutablePath -ieq $exe }
    if ($running) { throw 'Feche A30 Remoto antes de desinstalar.' }
    $shell=New-Object -ComObject WScript.Shell
    $menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'A30 Remoto'
    $links=@((Join-Path $menu 'A30 Remoto.lnk'),(Join-Path $menu 'Desinstalar A30 Remoto.lnk'),(Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'A30 Remoto.lnk'))
    foreach($link in $links) {
        if(Test-Path -LiteralPath $link) {
            $shortcut=$shell.CreateShortcut($link)
            if($shortcut.TargetPath -ieq $exe -or $shortcut.Arguments -like ('*'+(Join-Path $actual 'Desinstalar.ps1')+'*')) { Remove-Item -LiteralPath $link }
        }
    }
    if((Test-Path -LiteralPath $menu) -and !(Get-ChildItem -LiteralPath $menu -Force)) { Remove-Item -LiteralPath $menu }
    $registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\A30Remote'
    if(Test-Path $registry) {
        if((Get-ItemProperty $registry).InstallLocation -ine $actual) { throw 'Registro aponta para outra pasta; preservado.' }
        Remove-Item -LiteralPath $registry
    }
    # $actual foi resolvido, comparado com a pasta fixa e conferido pelo marcador.
    Remove-Item -LiteralPath $actual -Recurse -Force
    if(!$Quiet) { [Windows.Forms.MessageBox]::Show('A30 Remoto removido. Chaves e logs preservados.','A30 Remoto') | Out-Null }
    exit 0
} catch {
    if(!$Quiet) { [Windows.Forms.MessageBox]::Show($_.Exception.Message,'A30 Remoto') | Out-Null }
    else { Write-Error $_.Exception.Message -ErrorAction Continue }
    exit 1
}
