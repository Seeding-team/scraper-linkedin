# Refactor nguyen/ -> facebook-crawler/
# Run from D:\CrawlDataLinkedin\linkedin-crawler-ui\

$ErrorActionPreference = "Stop"

$base = "D:\CrawlDataLinkedin\linkedin-crawler-ui\components"

# Step 1: Rename top-level folder nguyen -> facebook-crawler
$nguyenPath = "$base\nguyen"
$fbCrawlerPath = "$base\facebook-crawler"

if (Test-Path $nguyenPath) {
    Rename-Item -Path $nguyenPath -NewName "facebook-crawler" -Force
    Write-Host "[OK] Renamed: nguyen -> facebook-crawler"
} else {
    Write-Host "[SKIP] $nguyenPath not found"
}

# Step 2: Rename crawldFB -> facebook-crawl inside facebook-crawler
$crawldFBPath = "$base\facebook-crawler\modules\crawldFB"
if (Test-Path $crawldFBPath) {
    Rename-Item -Path $crawldFBPath -NewName "facebook-crawl" -Force
    Write-Host "[OK] Renamed: crawldFB -> facebook-crawl"
}

# Step 3: Rename individual files (camelCase -> kebab-case)
$renames = @(
    # components
    @{from="dashboardPost.tsx"; to="dashboard-post.tsx"},
    @{from="dataFbCard_component.tsx"; to="post-card.tsx"},
    @{from="crawlFB_form.tsx"; to="crawl-form.tsx"},
    @{from="CreateGroup_form.tsx"; to="create-group-form.tsx"},
    @{from="Interaction_form.tsx"; to="interaction-form.tsx"},
    @{from="UpdateGroupModal.tsx"; to="update-group-modal.tsx"},
    @{from="SelectPresetGroupsModal.tsx"; to="select-preset-groups-modal.tsx"},
    @{from="dashboardGroups.tsx"; to="dashboard-groups.tsx"},
    @{from="Interaction_component.tsx"; to="interaction-component.tsx"},
    @{from="intent_component.tsx"; to="intent-component.tsx"},
    @{from="processRawFacebookPosts.tsx"; to="process-raw-posts.tsx"},
    @{from="CombinedCrawlForm.tsx"; to="combined-crawl-form.tsx"},
    # types
    @{from="dataFb.type.ts"; to="data-fb.type.ts"},
    @{from="crawlFB_type.ts"; to="crawl-fb.type.ts"},
    @{from="interaction.type.ts"; to="interaction.type.ts"},
    # schemas
    @{from="create_groups_shemas.ts"; to="create-groups-schemas.ts"},
    @{from="crawlFb_schemas.ts"; to="crawl-fb-schemas.ts"},
    @{from="Interaction_schemas.ts"; to="interaction-schemas.ts"},
    @{from="intent_schemas.ts"; to="intent-schemas.ts"},
    @{from="login_shemas.ts"; to="login-schemas.ts"},
    # lib
    @{from="facebook-api-base.ts"; to="facebook-api-base.ts"}
)

$componentsDir = "$base\facebook-crawler\modules\facebook-crawl\components"
$typesDir = "$base\facebook-crawler\modules\facebook-crawl\types"
$schemasDir = "$base\facebook-crawler\modules\facebook-crawl\schemas"
$libDir = "$base\facebook-crawler\modules\facebook-crawl\lib"

foreach ($r in $renames) {
    $fromName = $r.from
    $toName = $r.to

    # components dir
    if ($fromName -match "tsx$") {
        $fromPath = "$componentsDir\$fromName"
        $toPath = "$componentsDir\$toName"
    }
    # types
    elseif ($fromName -match "\.type\.ts$") {
        $fromPath = "$typesDir\$fromName"
        $toPath = "$typesDir\$toName"
    }
    # schemas
    elseif ($fromName -match "_schemas\.ts$") {
        $fromPath = "$schemasDir\$fromName"
        $toPath = "$schemasDir\$toName"
    }
    # lib
    else {
        $fromPath = "$libDir\$fromName"
        $toPath = "$libDir\$toName"
    }

    if (Test-Path $fromPath) {
        Rename-Item -Path $fromPath -NewName $toName -Force
        Write-Host "[OK] $fromName -> $toName"
    } else {
        Write-Host "[SKIP] $fromPath not found"
    }
}

Write-Host ""
Write-Host "Done! Now update tsconfig.json for path alias."
