param(
  [string]$TitleNeedle = 'IQAI ARC GIS AUTH'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class IqaiWinFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static string Focus(string needle) {
    string result = null;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      var title = sb.ToString();
      if (string.IsNullOrWhiteSpace(title)) return true;
      if (title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0
          && title.IndexOf("localhost:3000", StringComparison.OrdinalIgnoreCase) < 0
          && title.IndexOf("arcgis.com", StringComparison.OrdinalIgnoreCase) < 0) return true;
      GetWindowRect(h, out var rect);
      ShowWindow(h, 3);
      SetForegroundWindow(h);
      result = title + "|rect=" + rect.Left + "," + rect.Top + "," + rect.Right + "," + rect.Bottom;
      return false;
    }, IntPtr.Zero);
    return result;
  }
}
"@

$primary = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$r = [IqaiWinFocus]::Focus($TitleNeedle)
if (-not $r) { exit 2 }
Write-Output ($r + "|primary=" + $primary.X + "," + $primary.Y + "," + $primary.Width + "," + $primary.Height)
