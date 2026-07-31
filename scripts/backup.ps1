# AGG Project Backup Script
# Usage: .\backup.ps1 [-Reason "backup reason"]
# Example: .\backup.ps1 -Reason "Before Agent system refactor"

param(
    [string]$Reason = "Routine backup"
)

$ErrorActionPreference = "Stop"
$ProjectDir = "c:\Users\super\Documents\trae_projects\AGG-main"
$BackupDir = "E:\AGG-BACKUP"
$MaxBackups = 20

# --- 1. Pre-checks ---

if (-not (Test-Path $ProjectDir)) {
    Write-Host "[ERROR] Project dir not found: $ProjectDir" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Host "[INFO] Created backup dir: $BackupDir" -ForegroundColor Cyan
}

$drive = (Resolve-Path $BackupDir -ErrorAction SilentlyContinue).Drive.Name
if ($drive) {
    $freeSpace = (Get-PSDrive -Name $drive).Free / 1GB
    if ($freeSpace -lt 2) {
        Write-Host "[WARNING] Drive $drive`: free space < 2GB ($([math]::Round($freeSpace, 2)) GB)" -ForegroundColor Yellow
        $continue = Read-Host "Continue? (y/n)"
        if ($continue -ne 'y') { exit 0 }
    }
}

# --- 2. Execute backup ---

$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$backupFile = "$BackupDir\AGG-backup-$timestamp.zip"
$tempDir = "$ProjectDir\.backup-temp-$timestamp"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AGG Project Backup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Time  : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host "  Reason: $Reason" -ForegroundColor White
Write-Host "  Target: $backupFile" -ForegroundColor White
Write-Host "  Exclude: node_modules, .git" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Creating temp dir..." -ForegroundColor Green
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

Write-Host "[2/4] Copying files (excluding node_modules, .git)..." -ForegroundColor Green
$robocopyResult = robocopy $ProjectDir $tempDir /E /XD node_modules .git ".backup-temp-*" /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) {
    Write-Host "[ERROR] robocopy failed with exit code: $LASTEXITCODE" -ForegroundColor Red
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "[3/4] Compressing..." -ForegroundColor Green
Compress-Archive -Path "$tempDir\*" -DestinationPath $backupFile -Force -CompressionLevel Optimal

Write-Host "[4/4] Cleaning temp dir..." -ForegroundColor Green
Get-ChildItem $tempDir -Recurse | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
Remove-Item -Path $tempDir -Force -ErrorAction SilentlyContinue

# --- 3. Verify ---

if (-not (Test-Path $backupFile)) {
    Write-Host "[ERROR] Backup file not created!" -ForegroundColor Red
    exit 1
}

$fileSize = (Get-Item $backupFile).Length / 1MB
if ($fileSize -lt 1) {
    Write-Host "[WARNING] Backup file suspiciously small: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Backup file size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
}

# --- 4. Cleanup old backups ---

$backups = Get-ChildItem "$BackupDir\AGG-backup-*.zip" | Sort-Object Name -Descending
if ($backups.Count -gt $MaxBackups) {
    $toDelete = $backups | Select-Object -Skip $MaxBackups
    Write-Host ""
    Write-Host "[CLEANUP] Removing old backups (keeping latest $MaxBackups)..." -ForegroundColor Yellow
    foreach ($old in $toDelete) {
        Remove-Item $old.FullName -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $old.FullName)) {
            Write-Host "  Deleted: $($old.Name)" -ForegroundColor DarkGray
        } else {
            Write-Host "  Failed to delete (manual cleanup needed): $($old.Name)" -ForegroundColor Red
        }
    }
}

# --- 5. Output results ---

$backupTime = Get-Date -Format 'yyyy-MM-dd HH:mm'

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Backup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "  File  : $backupFile" -ForegroundColor White
Write-Host "  Size  : $([math]::Round($fileSize, 2)) MB" -ForegroundColor White
Write-Host "  Reason: $Reason" -ForegroundColor White
Write-Host "  Time  : $backupTime" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Record the following in achievement file:" -ForegroundColor Cyan
Write-Host ""
Write-Host "### Pre-update Offsite Backup"
Write-Host "- **Backup Time**: $backupTime"
Write-Host "- **Backup File**: $backupFile"
Write-Host "- **Trigger Reason**: $Reason"
Write-Host ""

Write-Host "Current backups:" -ForegroundColor Cyan
$currentBackups = Get-ChildItem "$BackupDir\AGG-backup-*.zip" | Sort-Object Name -Descending
foreach ($b in $currentBackups) {
    $size = [math]::Round($b.Length / 1MB, 2)
    Write-Host "  $($b.Name)  ($size MB)" -ForegroundColor DarkGray
}