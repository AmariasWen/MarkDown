using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Program
{
    private const string Address = "http://localhost:3210/";
    private static readonly string ProjectPath = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

    [STAThread]
    private static int Main(string[] arguments)
    {
        bool check_only = Array.IndexOf(arguments, "--check") >= 0;
        try
        {
            using (Mutex launch_lock = new Mutex(false, "Local\\MarkDown.LocalLauncher"))
            {
                bool lock_owned = false;
                try
                {
                    try { lock_owned = launch_lock.WaitOne(20000); }
                    catch (AbandonedMutexException) { lock_owned = true; }
                    if (!lock_owned) throw new Exception("另一个启动器正在运行，请稍后重试。");
                    EnsureService();
                }
                finally
                {
                    if (lock_owned) launch_lock.ReleaseMutex();
                }
            }
            if (!check_only) Process.Start(new ProcessStartInfo(Address) { UseShellExecute = true });
            return 0;
        }
        catch (Exception error)
        {
            if (!check_only) MessageBox.Show(error.Message, "MarkDown 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool IsReady()
    {
        string content;
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Address + "api/health");
            request.Proxy = null;
            request.Timeout = 500;
            request.ReadWriteTimeout = 500;
            using (WebResponse response = request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                content = reader.ReadToEnd();
        }
        catch (WebException) { return false; }
        var health = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(content);
        if (!health.ContainsKey("app") || Convert.ToString(health["app"]) != "markdown-local-library") return false;
        if (!health.ContainsKey("directory") || !String.Equals(Convert.ToString(health["directory"]).TrimEnd(Path.DirectorySeparatorChar), ProjectPath, StringComparison.OrdinalIgnoreCase))
            throw new Exception("3210 端口上运行的是另一个目录的知识库。请先关闭它，再打开此目录中的 MarkDown.exe。");
        return true;
    }

    private static void EnsureService()
    {
        if (IsReady()) return;
        string server_path = Path.Combine(ProjectPath, "server.js");
        string runtime_path = Path.Combine(ProjectPath, "runtime", "node.exe");
        if (!File.Exists(server_path) || !File.Exists(runtime_path))
            throw new Exception("项目文件不完整。请将 MarkDown.exe、server.js、runtime 和 data 保持在同一个项目文件夹内，不要只移动 EXE。");
        ProcessStartInfo info = new ProcessStartInfo(runtime_path, "\"" + server_path + "\"");
        info.WorkingDirectory = ProjectPath;
        info.UseShellExecute = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        Environment.SetEnvironmentVariable("PORT", "3210");
        using (Process service = new Process())
        {
            service.StartInfo = info;
            service.Start();
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < 15000)
            {
                if (IsReady()) return;
                if (service.HasExited)
                {
                    service.WaitForExit();
                    throw new Exception("本地服务未能启动。3210 端口可能被占用，或数据目录不可写。可运行 start.cmd 查看详细错误。");
                }
                Thread.Sleep(100);
            }
            throw new Exception("本地服务启动超时。请稍后重新双击 MarkDown.exe；不要删除 data 文件夹。");
        }
    }
}
