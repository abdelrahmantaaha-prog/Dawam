# Reads commands from stdin, one per line:
#   minimize <hwnd>  - minimize that window
#   focus <hwnd>     - restore (if minimized) and bring that window to the foreground
# Used by Anchor to force-return the user to their task window.

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AnchorEnforce {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim() -split '\s+'
  if ($parts.Count -lt 2) { continue }
  try {
    $h = [IntPtr]([int64]$parts[1])
    if (-not [AnchorEnforce]::IsWindow($h)) { continue }
    if ($parts[0] -eq 'minimize') {
      [void][AnchorEnforce]::ShowWindow($h, 6)  # SW_MINIMIZE
    } elseif ($parts[0] -eq 'focus') {
      if ([AnchorEnforce]::IsIconic($h)) { [void][AnchorEnforce]::ShowWindow($h, 9) }  # SW_RESTORE
      [void][AnchorEnforce]::SetForegroundWindow($h)
    }
  } catch {}
}
