# Rename hook files from camelCase to kebab-case + fix schema imports
$hooksDir = "D:\CrawlDataLinkedin\linkedin-crawler-ui\components\facebook-crawler\modules\facebook-crawl\hooks"
$schemasDir = "D:\CrawlDataLinkedin\linkedin-crawler-ui\components\facebook-crawler\modules\facebook-crawl\schemas"

# Rename hook files
$hookRenames = @()
$hookRenames += @{from="useGetCategoriesQuery.ts"; to="use-get-categories-query.ts"}
$hookRenames += @{from="useGetIntents.ts"; to="use-get-intents.ts"}
$hookRenames += @{from="useGetPresetGroups.ts"; to="use-get-preset-groups.ts"}
$hookRenames += @{from="useGetDataFb.ts"; to="use-get-data-fb.ts"}
$hookRenames += @{from="useGetInteraction.ts"; to="use-get-interaction.ts"}
$hookRenames += @{from="useCrawlFB.ts"; to="use-crawl-fb.ts"}
$hookRenames += @{from="useCreateGroups.ts"; to="use-create-groups.ts"}
$hookRenames += @{from="useCreateIntent.ts"; to="use-create-intent.ts"}
$hookRenames += @{from="useDeleteGroup.ts"; to="use-delete-group.ts"}
$hookRenames += @{from="useInteractPost.ts"; to="use-interact-post.ts"}
$hookRenames += @{from="useLogin.ts"; to="use-login.ts"}
$hookRenames += @{from="useUpdateGroup.ts"; to="use-update-group.ts"}

foreach ($r in $hookRenames) {
    $fromPath = Join-Path $hooksDir $r.from
    $toPath = Join-Path $hooksDir $r.to
    if (Test-Path $fromPath) {
        Rename-Item -Path $fromPath -NewName $r.to -Force
        Write-Host "[OK] $($r.from) -> $($r.to)"
    } else {
        Write-Host "[SKIP] $($r.from) not found"
    }
}

# Rename intent_schemas -> intent-schemas
$schemaFrom = Join-Path $schemasDir "intent_schemas.ts"
$schemaTo = Join-Path $schemasDir "intent-schemas.ts"
if (Test-Path $schemaFrom) {
    Rename-Item -Path $schemaFrom -NewName "intent-schemas.ts" -Force
    Write-Host "[OK] intent_schemas.ts -> intent-schemas.ts"
}

Write-Host "Done"
