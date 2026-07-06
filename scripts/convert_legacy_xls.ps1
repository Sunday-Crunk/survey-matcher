param(
    [string]$ZipPath = "school files.zip",
    [string]$OutDir = "outputs\converted_school_files"
)

$ErrorActionPreference = "Stop"

$targets = @(
    "Pupil Data Submission - DON VALLEY ACADEMY.xlsx",
    "Pupil Data Submission RNS 02.06.26_UPDATED.xlsx"
)

$root = Resolve-Path "."
$zipFullPath = Join-Path $root $ZipPath
$extractDir = Join-Path $root "outputs\legacy_xls_extract"
$convertDir = Join-Path $root $OutDir
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
New-Item -ItemType Directory -Force -Path $convertDir | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipFullPath)
try {
    foreach ($target in $targets) {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq $target } | Select-Object -First 1
        if (-not $entry) {
            Write-Host "Missing target in zip: $target"
            continue
        }
        $extractPath = Join-Path $extractDir ([IO.Path]::GetFileNameWithoutExtension($target) + ".xls")
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extractPath, $true)
    }
}
finally {
    $zip.Dispose()
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
    foreach ($target in $targets) {
        $sourcePath = Join-Path $extractDir ([IO.Path]::GetFileNameWithoutExtension($target) + ".xls")
        if (-not (Test-Path $sourcePath)) {
            continue
        }
        $destPath = Join-Path $convertDir $target
        $workbook = $excel.Workbooks.Open($sourcePath)
        try {
            $workbook.SaveAs($destPath, 51)
            Write-Host "Converted: $target"
        }
        finally {
            $workbook.Close($false)
        }
    }
}
finally {
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
