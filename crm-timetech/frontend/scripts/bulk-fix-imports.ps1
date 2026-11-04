# Bulk fix all remaining old import paths in facebook-crawler
$base = "D:\CrawlDataLinkedin\linkedin-crawler-ui\components\facebook-crawler"
$count = 0

Get-ChildItem -Path $base -Include "*.ts","*.tsx" -Recurse -File |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        $newContent = $content

        # dataFb.type -> data-fb.type
        $newContent = $newContent -replace '"\.\./types/dataFb\.type"', '"../types/data-fb.type"'
        $newContent = $newContent -replace '"\./types/dataFb\.type"', '"./types/data-fb.type"'

        # crawlFb_schemas -> crawl-fb-schemas
        $newContent = $newContent -replace '"\.\./schemas/crawlFb_schemas"', '"../schemas/crawl-fb-schemas"'

        # intent_schemas -> intent-schemas
        $newContent = $newContent -replace '"\.\./schemas/intent_schemas"', '"../schemas/intent-schemas"'

        # Interaction_schemas -> interaction-schemas
        $newContent = $newContent -replace '"\.\./schemas/Interaction_schemas"', '"../schemas/interaction-schemas"'
        $newContent = $newContent -replace '"\./schemas/Interaction_schemas"', '"./schemas/interaction-schemas"'

        # SelectPresetGroupsModal -> select-preset-groups-modal (import path only, not JSX tag)
        $newContent = $newContent -replace 'from "\./SelectPresetGroupsModal"', 'from "./select-preset-groups-modal"'

        # processRawFacebookPosts -> process-raw-posts
        $newContent = $newContent -replace '"\./processRawFacebookPosts"', '"./process-raw-posts"'

        # intent_component -> intent-component
        $newContent = $newContent -replace '"\./intent_component"', '"./intent-component"'

        if ($newContent -ne $content) {
            Set-Content -Path $_.FullName -Value $newContent -NoNewline
            Write-Host "[OK] $($_.Name)"
            $count++
        }
    }

Write-Host "Total: $count files"
