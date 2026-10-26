# Bulk update import paths from old nguyen/crawldFB -> new facebook-crawler/facebook-crawl
$base = "D:\CrawlDataLinkedin\linkedin-crawler-ui"
$count = 0
$skipPattern = "\.next\\|node_modules"

Get-ChildItem -Path $base -Include "*.ts","*.tsx" -Recurse -File |
    Where-Object { $_.FullName -notmatch "\.next\\" } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        $newContent = $content

        # Replace @/components/nguyen/ -> @/components/facebook-crawler/
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/components/CombinedCrawlForm',
            '@/components/facebook-crawler/modules/facebook-crawl/components/combined-crawl-form'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/components/dashboardPost',
            '@/components/facebook-crawler/modules/facebook-crawl/components/dashboard-post'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/components/dashboardGroups',
            '@/components/facebook-crawler/modules/facebook-crawl/components/dashboard-groups'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/components/Interaction_component',
            '@/components/facebook-crawler/modules/facebook-crawl/components/interaction-component'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/components/login',
            '@/components/facebook-crawler/modules/facebook-crawl/components/login'

        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/types/dataFb\.type',
            '@/components/facebook-crawler/modules/facebook-crawl/types/data-fb.type'

        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/services/login',
            '@/components/facebook-crawler/modules/facebook-crawl/services/login'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/services/group',
            '@/components/facebook-crawler/modules/facebook-crawl/services/group'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/services/createGroupsService',
            '@/components/facebook-crawler/modules/facebook-crawl/services/create-groups-service'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/schemas/create_groups_shemas',
            '@/components/facebook-crawler/modules/facebook-crawl/schemas/create-groups-schemas'

        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/hooks/useGetIntents',
            '@/components/facebook-crawler/modules/facebook-crawl/hooks/use-get-intents'
        $newContent = $newContent -replace '@/components/nguyen/modules/crawldFB/hooks/useGetCategoriesQuery',
            '@/components/facebook-crawler/modules/facebook-crawl/hooks/use-get-categories-query'

        if ($newContent -ne $content) {
            Set-Content -Path $_.FullName -Value $newContent -NoNewline
            Write-Host "[OK] $($_.FullName.Replace($base + '\', ''))"
            $count++
        }
    }

Write-Host ""
Write-Host "Total files modified: $count"
