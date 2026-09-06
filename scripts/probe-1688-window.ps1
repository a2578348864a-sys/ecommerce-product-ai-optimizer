[CmdletBinding()]
param(
    [string]$ProfileDir = "",
    [int]$TimeoutMs = 20000,
    [int]$IntervalMs = 500
)

# Set UTF-8 output encoding for cross-process pipe to Node.js (KB: PowerShell中文UTF8读写)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

if (-not ([System.Management.Automation.PSTypeName]'Win32DesktopProbe').Type) {
    $csharp = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class Win32DesktopProbe {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern bool EnumDesktopWindows(IntPtr hDesktop, EnumWindowsProc lpfn, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpfn, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);

    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public class FoundWindow {
        public uint Pid;
        public IntPtr Hwnd;
        public string Title;
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
        public int Width;
        public int Height;
    }

    public static List<FoundWindow> ScanWindows(string desktopName) {
        var results = new List<FoundWindow>();

        Action<IntPtr> scan = (hDesk) => {
            EnumWindowsProc proc = (hWnd, lParam) => {
                if (!IsWindowVisible(hWnd)) return true;
                RECT r;
                if (!GetWindowRect(hWnd, out r)) return true;
                int w = r.Right - r.Left;
                int h = r.Bottom - r.Top;
                if (w < 100 || h < 100) return true;

                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);

                results.Add(new FoundWindow {
                    Pid = pid,
                    Hwnd = hWnd,
                    Title = sb.ToString(),
                    Left = r.Left,
                    Top = r.Top,
                    Right = r.Right,
                    Bottom = r.Bottom,
                    Width = w,
                    Height = h
                });
                return true;
            };

            if (hDesk != IntPtr.Zero) {
                EnumDesktopWindows(hDesk, proc, IntPtr.Zero);
            } else {
                EnumWindows(proc, IntPtr.Zero);
            }
        };

        Thread t = new Thread(() => {
            if (!string.IsNullOrEmpty(desktopName)) {
                IntPtr hDesk = OpenDesktop(desktopName, 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero) {
                    SetThreadDesktop(hDesk);
                    scan(hDesk);
                    CloseDesktop(hDesk);
                    return;
                }
            }
            scan(IntPtr.Zero);
        });
        t.Start();
        t.Join();

        return results;
    }

    public static void ActivateWindow(IntPtr hWnd) {
        Thread t = new Thread(() => {
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) {
                SetThreadDesktop(hDesk);
                ShowWindow(hWnd, 9);
                SetForegroundWindow(hWnd);
                SwitchToThisWindow(hWnd, true);
                CloseDesktop(hDesk);
                return;
            }
            ShowWindow(hWnd, 9);
            SetForegroundWindow(hWnd);
            SwitchToThisWindow(hWnd, true);
        });
        t.Start();
        t.Join();
    }
}
"@
    Add-Type -TypeDefinition $csharp -ErrorAction SilentlyContinue
}
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
$foundResult = $null

$normProfile = ""
if (-not [string]::IsNullOrEmpty($ProfileDir)) {
    $normProfile = $ProfileDir.Trim().Replace('/', '\').ToLower()
}

while ((Get-Date) -lt $deadline) {
    # 1. Scan windows on WinSta0\Default
    $candidateWindows = [Win32DesktopProbe]::ScanWindows("Default")

    # 2. Fallback to scan current desktop if Default returns empty
    if (-not $candidateWindows -or $candidateWindows.Count -eq 0) {
        $candidateWindows = [Win32DesktopProbe]::ScanWindows("")
    }

    if ($candidateWindows) {
        foreach ($w in $candidateWindows) {
            # Window must be large enough to be a browser window (not a tooltip or helper)
            if ($w.Width -lt 300 -or $w.Height -lt 200) { continue }

            $proc = Get-Process -Id $w.Pid -ErrorAction SilentlyContinue
            if ($null -eq $proc -or $proc.ProcessName.ToLower() -ne "chrome") {
                continue
            }

            # If ProfileDir specified, check if Chrome instance matches
            $isTarget = $false
            if (-not [string]::IsNullOrEmpty($normProfile)) {
                $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($w.Pid)" -ErrorAction SilentlyContinue
                if ($cim -and -not [string]::IsNullOrEmpty($cim.CommandLine)) {
                    $normCmd = $cim.CommandLine.Replace('/', '\').ToLower()
                    if ($normCmd.Contains($normProfile)) {
                        $isTarget = $true
                    }
                } else {
                    # Fallback: if process is chrome and title indicates 1688 / login
                    if ($w.Title -match "1688|批发|采购|登录|Google Chrome|about:blank") {
                        $isTarget = $true
                    }
                }
            } else {
                $isTarget = $true
            }

            if (-not $isTarget) { continue }

            # Screen bounds check (with fallback for cross-desktop environments)
            $screens = [System.Windows.Forms.Screen]::AllScreens
            $onScreen = $false
            if ($screens -and $screens.Count -gt 0) {
                foreach ($s in $screens) {
                    $b = $s.WorkingArea
                    if ($b.Width -gt 0 -and $w.Right -gt $b.Left -and $w.Left -lt $b.Right -and $w.Bottom -gt $b.Top -and $w.Top -lt $b.Bottom) {
                        $onScreen = $true
                        break
                    }
                }
            }
            if (-not $onScreen -and $w.Width -ge 300 -and $w.Height -ge 200) {
                $onScreen = $true
            }
            if (-not $onScreen) { continue }

            # Activate window and bring to front
            [Win32DesktopProbe]::ActivateWindow($w.Hwnd)

            $foundResult = @{
                ok = $true
                found = $true
                pid = $w.Pid
                hwnd = [int64]$w.Hwnd
                title = $w.Title
                bounds = @{
                    left = $w.Left
                    top = $w.Top
                    right = $w.Right
                    bottom = $w.Bottom
                    width = $w.Width
                    height = $w.Height
                }
            }
            break
        }
    }

    if ($null -ne $foundResult) { break }
    Start-Sleep -Milliseconds $IntervalMs
}

if ($null -eq $foundResult) {
    $foundResult = @{
        ok = $true
        found = $false
        reason = "timeout_no_visible_window"
    }
}

$foundResult | ConvertTo-Json -Compress
