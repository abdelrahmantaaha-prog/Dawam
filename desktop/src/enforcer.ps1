# Reads commands from stdin, one per line:
#   minimize <hwnd>        - minimize that window
#   focus <hwnd>           - restore (if minimized) and bring that window to the foreground
#   activate <id> <name>   - bring forward the first window of the program <name> (file name,
#                            no .exe); answers {"id":..,"ok":true|false}
#   list <id>              - the open app windows; answers {"id":..,"windows":[{title,process,path,hwnd}]}
#   taskbar hide|show      - the Windows taskbar on every screen (bubbles replace it)
# Used to send you back to your work, and by the bubble's dock and drag palette.
# Answers are one JSON line each on stdout, matched to the question by id.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class RhythmEnforce {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);

  /* Windows only lets the process you last touched take the foreground. This
     helper is never that process, so it borrows the foreground thread's input
     state for the moment it takes to switch — the documented way around the
     lock, and the one that does not fake a keypress into someone's app. */
  public static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
    uint pid;
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fg, false);
  }

  static string ExePath(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return "";
    try {
      StringBuilder sb = new StringBuilder(1024);
      uint size = 1024;
      return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    } finally { CloseHandle(h); }
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);

  /* The Windows taskbar, on every screen: hidden while a bubble runs (the
     bubble bar stands in its place), shown again after. Hiding the window
     leaves its strip of screen reserved, so maximized windows stay clear of
     the bar that takes its place, and no Windows setting is changed. Returns
     how many taskbars there were. */
  public static int Taskbar(bool show) {
    int n = 0;
    foreach (string cls in new string[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" }) {
      IntPtr h = IntPtr.Zero;
      while ((h = FindWindowEx(IntPtr.Zero, h, cls, null)) != IntPtr.Zero) {
        ShowWindow(h, show ? 5 : 0); // SW_SHOW : SW_HIDE
        n++;
      }
    }
    return n;
  }

  public class Win { public IntPtr Hwnd; public string Title; public string Path; }

  /* The windows a person would call open: visible, titled, not owned by
     another window, not a tool palette, and not cloaked — Store apps leave
     invisible-but-"visible" frames around that are only cloaked. */
  public static List<Win> Windows() {
    List<Win> list = new List<Win>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;              // GW_OWNER
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;         // WS_EX_TOOLWINDOW
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      string path = ExePath(pid);
      if (path.EndsWith("\\ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase)) {
        uint inner = 0;
        EnumChildWindows(h, delegate(IntPtr c, IntPtr l2) {
          uint cp; GetWindowThreadProcessId(c, out cp);
          if (cp != 0 && cp != pid) { inner = cp; return false; }
          return true;
        }, IntPtr.Zero);
        if (inner != 0) path = ExePath(inner);
      }
      Win w = new Win(); w.Hwnd = h; w.Title = sb.ToString(); w.Path = path;
      list.Add(w);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

function Answer($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4)) }

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim() -split '\s+', 3
  if ($parts.Count -lt 2) { continue }
  try {
    switch ($parts[0]) {
      'taskbar' {
        [void][RhythmEnforce]::Taskbar($parts[1] -eq 'show')
      }
      'minimize' {
        $h = [IntPtr]([int64]$parts[1])
        if ([RhythmEnforce]::IsWindow($h)) { [void][RhythmEnforce]::ShowWindow($h, 6) }  # SW_MINIMIZE
      }
      'focus' {
        $h = [IntPtr]([int64]$parts[1])
        if ([RhythmEnforce]::IsWindow($h)) { [RhythmEnforce]::Focus($h) }
      }
      'activate' {
        $want = if ($parts.Count -ge 3) { $parts[2].ToLower() } else { '' }
        $hit = [RhythmEnforce]::Windows() | Where-Object { $_.Path -and ([System.IO.Path]::GetFileNameWithoutExtension($_.Path).ToLower() -eq $want) } | Select-Object -First 1
        if ($hit) { [RhythmEnforce]::Focus($hit.Hwnd) }
        Answer @{ id = $parts[1]; ok = [bool]$hit }
      }
      'list' {
        # The program's own name for itself ("Visual Studio Code", "Windows
        # PowerShell") — a window title says what is open in it, not what it is.
        $wins = @([RhythmEnforce]::Windows() | ForEach-Object {
          $desc = ''
          if ($_.Path) { try { $desc = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($_.Path).FileDescription } catch {} }
          @{ title = $_.Title; path = $_.Path; hwnd = $_.Hwnd.ToInt64(); description = "$desc".Trim(); process = $(if ($_.Path) { [System.IO.Path]::GetFileNameWithoutExtension($_.Path) } else { '' }) }
        })
        Answer @{ id = $parts[1]; windows = $wins }
      }
    }
  } catch {
    if ($parts[0] -eq 'activate' -or $parts[0] -eq 'list') { Answer @{ id = $parts[1]; ok = $false; windows = @() } }
  }
}
