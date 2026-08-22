# Emits one JSON line per poll: {"title":"...","process":"...","hwnd":123,"host":"youtube.com"}
# host is the browser address-bar domain (via UI Automation), empty for
# non-browser windows or when it can't be read.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class AnchorWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
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

while ($true) {
  try {
    $hwnd = [AnchorWin32]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 1024
    [void][AnchorWin32]::GetWindowText($hwnd, $sb, 1024)
    $title = $sb.ToString()
    $procId = [uint32]0
    [void][AnchorWin32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $pname = ""
    try { $pname = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}

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

    $obj = @{ title = $title; process = $pname; hwnd = $hwnd.ToInt64(); host = $domain } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($obj)
  } catch {}
  Start-Sleep -Milliseconds 1500
}
