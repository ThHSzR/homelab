using System;
using System.IO;
using System.Diagnostics;
class Client {
    static int Main(string[] args) {
        try {
            string action = args.Length == 0 ? "menu" : args[0].TrimStart('-');
            string[] allowed={"menu","conectar","usb","configurar-ssh","diagnostico","desativar-adb","testar","ajuda"};
            if(args.Length>1 || Array.IndexOf(allowed,action)<0) throw new Exception("Use --conectar, --usb, --configurar-ssh, --diagnostico, --desativar-adb, --testar ou --ajuda.");
            string root=AppDomain.CurrentDomain.BaseDirectory;
            string ps=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe");
            var info=new ProcessStartInfo(ps,"-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(root,"A30-Remote.ps1")+"\" -Action "+action);
            info.UseShellExecute=false;
            using(var process=Process.Start(info)) { process.WaitForExit(); return process.ExitCode; }
        } catch(Exception ex) { Console.Error.WriteLine(ex.Message); if(args.Length==0) Console.ReadLine(); return 1; }
    }
}
