# Emits one JSON line per sample:
#   {"title":"...","process":"code","path":"C:\\...\\Code.exe","hwnd":123,"host":"youtube.com"}
# host is the browser address-bar domain (via UI Automation), empty for
# non-browser windows or when it can't be read. path is the program file the
# window belongs to; empty when Windows will not say (rare: a few protected
# system processes).
#
# Event-driven. It used to poll every 1.5 seconds, which is how long a window
# that should not be there stayed in front of you. Now Windows tells this
# script the moment the foreground window changes (and when the window in
# front renames itself — a browser switching tabs), and it samples right then.
# The 1.5-second heartbeat stays as well: the session machine finishes judging
# a page that was still loading on a later sample, so samples must keep coming
# even when nothing moves.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RhythmWatch {
  public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjects(uint n, IntPtr[] handles, bool waitAll, uint ms, uint mask);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder name, ref uint size);

  [StructLayout(LayoutKind.Sequential)]
  public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

  const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
  const uint EVENT_OBJECT_NAMECHANGE = 0x800C;
  const uint WINEVENT_OUTOFCONTEXT = 0x0000;
  const uint WINEVENT_SKIPOWNPROCESS = 0x0002;

  public static volatile bool Changed = false;
  static WinEventProc keep = new WinEventProc(OnEvent);
  static IntPtr nameHook = IntPtr.Zero;
  static uint nameHookPid = 0;

  static void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time) {
    if (ev == EVENT_SYSTEM_FOREGROUND) { Changed = true; return; }
    // OBJID_WINDOW only: a renamed window, not a renamed button inside it.
    if (ev == EVENT_OBJECT_NAMECHANGE && idObject == 0 && hwnd == GetForegroundWindow()) Changed = true;
  }

  public static void Hook() {
    SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, keep, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
  }

  /* Title changes are listened for in the foreground process only. Listening
     to every process would wake this script for every clock and progress bar
     on the machine. */
  public static void FollowNames(uint pid) {
    if (pid == nameHookPid) return;
    if (nameHook != IntPtr.Zero) UnhookWinEvent(nameHook);
    nameHookPid = pid;
    nameHook = pid == 0 ? IntPtr.Zero
      : SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, keep, pid, 0, WINEVENT_OUTOFCONTEXT);
  }

  // Sleeps until a window event arrives or ms pass, then delivers the events.
  public static void Pump(uint ms) {
    MsgWaitForMultipleObjects(0, null, false, ms, 0x04FF);
    MSG m;
    while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
  }

  public static string ExePath(uint pid) {
    IntPtr h = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
    if (h == IntPtr.Zero) return "";
    try {
      StringBuilder sb = new StringBuilder(1024);
      uint size = 1024;
      return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : "";
    } finally { CloseHandle(h); }
  }

  /* Store apps (Calculator, Photos, Settings...) all draw inside a frame that
     belongs to ApplicationFrameHost. The app itself is a child window from a
     different process — that process is the one a bubble item names. */
  public static uint HostedPid(IntPtr frame, uint framePid) {
    uint found = 0;
    EnumChildWindows(frame, delegate(IntPtr child, IntPtr l) {
      uint pid;
      GetWindowThreadProcessId(child, out pid);
      if (pid != 0 && pid != framePid) { found = pid; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$browsers = @('chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi', 'arc', 'zen', 'iron', 'librewolf')
$lastSig = ''
$lastDomain = ''

function Get-BrowserDomain($hwnd) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $root) { return '' }
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)
    # Browsers have several Edit controls (sidebars, find bars, doc fields).
    # The address bar is the one whose value parses as a domain — checking by
    # value instead of control name keeps this language- and browser-agnostic.
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    $i = 0
    foreach ($edit in $edits) {
      if ($i -ge 10) { break }
      $i++
      $pat = $null
      if (-not $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pat)) { continue }
      $val = $pat.Current.Value
      if ([string]::IsNullOrWhiteSpace($val)) { continue }
      $val = $val.Trim() -replace '^[A-Za-z]+://', ''
      $domain = ($val -split '[/\s?#]')[0].ToLower()
      # Only accept something that actually looks like a domain — while the
      # user is typing a search, the bar holds arbitrary text.
      if ($domain -match '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$') { return $domain }
    }
    return ''
  } catch { return '' }
}

[RhythmWatch]::Hook()

while ($true) {
  try {
    $hwnd = [RhythmWatch]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 1024
    [void][RhythmWatch]::GetWindowText($hwnd, $sb, 1024)
    $title = $sb.ToString()
    $procId = [uint32]0
    [void][RhythmWatch]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    [RhythmWatch]::FollowNames($procId)

    $exe = [RhythmWatch]::ExePath($procId)
    if ($exe -match '\\ApplicationFrameHost\.exe$') {
      $inner = [RhythmWatch]::HostedPid($hwnd, $procId)
      if ($inner -ne 0) { $exe = [RhythmWatch]::ExePath($inner) }
    }
    $pname = ''
    if ($exe) {
      $pname = [System.IO.Path]::GetFileNameWithoutExtension($exe)
    } else {
      try { $pname = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
    }

    $domain = ''
    if ($browsers -contains $pname.ToLower()) {
      # Same window + same title => the page didn't change; reuse the last read.
      $sig = "$($hwnd.ToInt64())|$title"
      if ($sig -eq $lastSig) {
        $domain = $lastDomain
      } else {
        $domain = Get-BrowserDomain $hwnd
        $lastSig = $sig
        $lastDomain = $domain
      }
    }

    $obj = @{ title = $title; process = $pname; path = $exe; hwnd = $hwnd.ToInt64(); host = $domain } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($obj)
  } catch {}
  [RhythmWatch]::Changed = $false
  [RhythmWatch]::Pump(1500)
}
