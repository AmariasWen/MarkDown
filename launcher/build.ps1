$ErrorActionPreference = 'Stop'
$project_path = Split-Path -Parent $PSScriptRoot
$compiler_path = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler_path)) { throw '需要 Windows .NET Framework C# 编译器' }
& $compiler_path /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/out:$project_path\MarkDown.exe" "$PSScriptRoot\Program.cs"
if ($LASTEXITCODE -ne 0) { throw 'MarkDown.exe 编译失败' }
