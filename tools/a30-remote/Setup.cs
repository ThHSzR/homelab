using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices;

class Setup {
    const string Product="A30 Remoto";
    const string RegistryPath=@"Software\Microsoft\Windows\CurrentVersion\Uninstall\A30Remote";
    static string Target=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","A30Remoto");
    static string AppPath { get { return Path.Combine(Target,"A30-Remoto.exe"); } }
    [STAThread]
    static int Main(string[] args) {
        bool silent=Array.IndexOf(args,"--silent")>=0;
        try {
            foreach(string arg in args) if(arg!="--silent" && arg!="--no-launch") throw new Exception("Opcoes: --silent --no-launch");
            if(silent) { Install(true); return 0; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form=new Form {Text="Instalar "+Product,ClientSize=new Size(610,390),StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false,Font=new Font("Segoe UI",10)};
            var title=new Label {Text="A30 Remoto",Font=new Font("Segoe UI",22,FontStyle.Bold),Location=new Point(25,20),AutoSize=true};
            var desc=new Label {Text="Tela do Galaxy A30 pelo SSH e Tailscale.\nUsa ADB e scrcpy instalados no PATH.\nInstala apenas para seu usuario.",Location=new Point(28,76),Size=new Size(550,70)};
            var path=new Label {Text="Pasta de instalacao:\n"+Target,Location=new Point(28,155),Size=new Size(550,54)};
            var desktop=new CheckBox {Text="Criar atalho na area de trabalho",Checked=true,Location=new Point(28,220),AutoSize=true};
            var note=new Label {Text="Requer Tailscale conectado e OpenSSH Client.\nNa primeira conexao, configure somente o SSH; nao e preciso tocar no A30.",Location=new Point(28,254),Size=new Size(550,50)};
            var status=new Label {Text="Pronto para instalar.",Location=new Point(28,332),Size=new Size(320,40)};
            var install=new Button {Text="Instalar",Location=new Point(438,325),Size=new Size(140,38)};
            bool installed=false;
            install.Click+=(sender,eventArgs)=>{
                if(installed) { Process.Start(new ProcessStartInfo(AppPath){UseShellExecute=true}); form.Close(); return; }
                install.Enabled=false; status.Text="Instalando..."; status.Refresh();
                try {
                    Install(desktop.Checked);
                    installed=true; status.Text="Instalacao concluida."; install.Text="Abrir aplicativo"; install.Enabled=true;
                    foreach(Control c in new Control[]{desktop}) c.Enabled=false;
                } catch(Exception ex) { status.Text="Nao foi possivel instalar."; MessageBox.Show(ex.Message,Product,MessageBoxButtons.OK,MessageBoxIcon.Error); install.Enabled=true; }
            };
            form.Controls.AddRange(new Control[]{title,desc,path,desktop,note,status,install});
            Application.Run(form); return 0;
        } catch(Exception ex) { if(!silent) MessageBox.Show(ex.Message,Product,MessageBoxButtons.OK,MessageBoxIcon.Error); else { try { File.WriteAllText(Path.Combine(Path.GetTempPath(),"a30-installer-error.log"),ex.ToString()); } catch {} } return 1; }
    }
    static void Install(bool desktop) {
        if(Directory.Exists(Target) && (File.GetAttributes(Target)&FileAttributes.ReparsePoint)!=0) throw new Exception("A pasta de instalacao e um link. Escolha uma instalacao normal antes de continuar.");
        string marker=Path.Combine(Target,".a30-install-marker");
        if(Directory.Exists(Target) && Directory.GetFileSystemEntries(Target).Length>0 && (!File.Exists(marker) || File.ReadAllText(marker)!="A30RemoteInstall:v1")) throw new Exception("A pasta de destino contem arquivos de outra origem; preservados. Renomeie a pasta antes de instalar.");
        foreach(var process in Process.GetProcessesByName("A30-Remoto")) {
            try { if(string.Equals(process.MainModule.FileName,AppPath,StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Feche A30 Remoto antes de atualizar."); } catch(System.ComponentModel.Win32Exception) {}
        }
        Directory.CreateDirectory(Target);
        File.WriteAllText(marker,"A30RemoteInstall:v1");
        using(Stream resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("install.zip"))
        using(var archive=new ZipArchive(resource,ZipArchiveMode.Read)) {
            foreach(var entry in archive.Entries) {
                string output=Path.GetFullPath(Path.Combine(Target,entry.FullName));
                if(!output.StartsWith(Target+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new Exception("Caminho invalido no pacote.");
                if(entry.Name.Length==0) {Directory.CreateDirectory(output);continue;}
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                using(var input=entry.Open()) using(var dest=File.Create(output)) input.CopyTo(dest);
            }
        }
        File.WriteAllText(Path.Combine(Target,".a30-install-marker"),"A30RemoteInstall:v1");
        string menu=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"A30 Remoto");
        Directory.CreateDirectory(menu);
        Shortcut(Path.Combine(menu,"A30 Remoto.lnk"),AppPath,"");
        string ps=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");
        string uninstallArgs="-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""+Path.Combine(Target,"Desinstalar.ps1")+"\"";
        Shortcut(Path.Combine(menu,"Desinstalar A30 Remoto.lnk"),ps,uninstallArgs);
        if(desktop) Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"A30 Remoto.lnk"),AppPath,"");
        using(var key=Registry.CurrentUser.CreateSubKey(RegistryPath)) {
            key.SetValue("DisplayName",Product); key.SetValue("DisplayVersion","1.1.0"); key.SetValue("Publisher","HomeLab pessoal");
            key.SetValue("InstallLocation",Target); key.SetValue("DisplayIcon",AppPath);
            key.SetValue("UninstallString","\""+ps+"\" "+uninstallArgs);
            key.SetValue("QuietUninstallString","\""+ps+"\" "+uninstallArgs+" -Quiet");
            key.SetValue("NoModify",1,RegistryValueKind.DWord); key.SetValue("NoRepair",1,RegistryValueKind.DWord);
            key.SetValue("EstimatedSize",36000,RegistryValueKind.DWord);
        }
    }
    static void Shortcut(string path,string target,string args) {
        dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        dynamic shortcut=shell.CreateShortcut(path);
        shortcut.TargetPath=target; shortcut.Arguments=args; shortcut.WorkingDirectory=Target; shortcut.Description=Product; shortcut.Save();
        Marshal.FinalReleaseComObject(shortcut); Marshal.FinalReleaseComObject(shell);
    }
}
