# ============================================================
# 优面AI · 清理冗余文件脚本
# 适用：W4 D6 终版前清理 11 个已被取代/已内联的旧文件
# 执行：右键 PowerShell → 以管理员身份运行 → 执行此脚本
# 备份：原文件会先备份到 .backup-deleted-YYYYMMDD-HHMMSS\
# ============================================================

$backupDir = "C:\Users\33397\Documents\work\.backup-deleted-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Write-Host "备份目录: $backupDir" -ForegroundColor Green

# 待删除的 11 个文件
$files = @(
    'C:\Users\33397\Documents\work\_p07_css.txt',
    'C:\Users\33397\Documents\work\_p07_js.txt',
    'C:\Users\33397\Documents\work\_p07_new.html',
    'C:\Users\33397\Documents\work\all-pages.html',
    'C:\Users\33397\Documents\work\build-pages.js',
    'C:\Users\33397\Documents\work\05-功能流程图_新.docx',
    'C:\Users\33397\Documents\work\llm-integration.js',
    'C:\Users\33397\Documents\work\llm-hooks.js',
    'C:\Users\33397\Documents\work\data\p07-question-bank.js',
    'C:\Users\33397\Documents\work\modules\questionBank.js',
    'C:\Users\33397\Documents\work\modules\questionCustomizer.js'
)

foreach ($f in $files) {
    if (Test-Path $f) {
        $relPath = $f.Substring('C:\Users\33397\Documents\work\'.Length)
        $dest = Join-Path $backupDir $relPath
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Copy-Item $f $dest -Force
        Remove-Item $f -Force
        Write-Host "  [OK] 已删除: $f (备份到 $dest)" -ForegroundColor Green
    } else {
        Write-Host "  [--] 不存在: $f" -ForegroundColor Gray
    }
}

# 清理空目录
Write-Host ""
Write-Host "=== 清理空目录 ===" -ForegroundColor Yellow
$dirs = @('C:\Users\33397\Documents\work\modules', 'C:\Users\33397\Documents\work\.tmp')
foreach ($d in $dirs) {
    if (Test-Path $d) {
        $items = Get-ChildItem $d -Force -ErrorAction SilentlyContinue
        if ($items.Count -eq 0) {
            Remove-Item $d -Recurse -Force
            Write-Host "  [OK] 已删除空目录: $d" -ForegroundColor Green
        } else {
            Write-Host "  [--] 目录非空，跳过: $d ($($items.Count) 项)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "清理完成！" -ForegroundColor Cyan
Write-Host "  备份目录: $backupDir" -ForegroundColor Cyan
Write-Host "  删除文件数: $($files.Count)" -ForegroundColor Cyan
