# Bulk replace @/components/nguyen/ -> @/components/facebook-crawler/
# Also update crawldFB -> facebook-crawl in import paths within facebook-crawler folder

$base = "D:\CrawlDataLinkedin\linkedin-crawler-ui"
$count = 0

Get-ChildItem -Path $base -Include "*.ts","*.tsx" -Recurse -File |
    Where-Object { $_.FullName -notlike "*\.next\*" } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        if ($content -match '@/components/nguyen/') {
            $newContent = $content -replace '@/components/nguyen/', '@/components/facebook-crawler/'
            Set-Content -Path $_.FullName -Value $newContent -NoNewline
            Write-Host "[OK] $($_.FullName.Replace($base + '\', ''))"
            $count++
        }
        # Also replace crawldFB -> facebook-crawl in import paths
        if ($content -match 'crawldFB') {
            $newContent2 = $content -replace 'crawldFB', 'facebook-crawl'
            if ($newContent2 -ne $content) {
                Set-Content -Path $_.FullName -Value $newContent2 -NoNewline
                Write-Host "[OK] crawldFB -> facebook-crawl in $($_.FullName.Replace($base + '\', ''))"
                $count++
            }
        }
    }

Write-Host ""
Write-Host "Total files modified: $count"
