# Fix all remaining imports in facebook-crawler
$base = "D:\CrawlDataLinkedin\linkedin-crawler-ui\components\facebook-crawler"
$count = 0

Get-ChildItem -Path $base -Include "*.ts","*.tsx" -Recurse -File |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        $newContent = $content

        # intent_schemas -> intent-schemas
        $newContent = $newContent -replace 'intent_schemas', 'intent-schemas'

        # Hook imports (camelCase -> kebab-case)
        $newContent = $newContent -replace 'from "\.\./hooks/useGetCategoriesQuery"', 'from "../hooks/use-get-categories-query"'
        $newContent = $newContent -replace 'from "\.\./hooks/useGetIntents"', 'from "../hooks/use-get-intents"'
        $newContent = $newContent -replace 'from "\.\./hooks/useGetPresetGroups"', 'from "../hooks/use-get-preset-groups"'
        $newContent = $newContent -replace 'from "\.\./hooks/useGetDataFb"', 'from "../hooks/use-get-data-fb"'
        $newContent = $newContent -replace 'from "\.\./hooks/useGetInteraction"', 'from "../hooks/use-get-interaction"'
        $newContent = $newContent -replace 'from "\.\./hooks/useCrawlFB"', 'from "../hooks/use-crawl-fb"'
        $newContent = $newContent -replace 'from "\.\./hooks/useCreateGroups"', 'from "../hooks/use-create-groups"'
        $newContent = $newContent -replace 'from "\.\./hooks/useCreateIntent"', 'from "../hooks/use-create-intent"'
        $newContent = $newContent -replace 'from "\.\./hooks/useDeleteGroup"', 'from "../hooks/use-delete-group"'
        $newContent = $newContent -replace 'from "\.\./hooks/useInteractPost"', 'from "../hooks/use-interact-post"'
        $newContent = $newContent -replace 'from "\.\./hooks/useLogin"', 'from "../hooks/use-login"'
        $newContent = $newContent -replace 'from "\.\./hooks/useUpdateGroup"', 'from "../hooks/use-update-group"'

        # Component: intent_component -> intent-component
        $newContent = $newContent -replace '"\./intent_component"', '"./intent-component"'

        if ($newContent -ne $content) {
            Set-Content -Path $_.FullName -Value $newContent -NoNewline
            Write-Host "[OK] $($_.Name)"
            $count++
        }
    }

Write-Host "Total: $count files"
