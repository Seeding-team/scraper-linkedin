from app.modules.all_platform.schemas.common import BaseResponse
from app.modules.all_platform.schemas.seeding import (
    SeedingMarkSaveRequest,
    SeedingMarkVerifyRequest,
    SeedingMarkGetAllRequest,
    SeedingCountRequest,
    SeedingCountResponse,
    SeedingKpiSaveRequest,
    KpiTargetRequest,
)
from app.modules.all_platform.schemas.kpi import (
    KpiWeekItem,
    AssignKpiRequest,
    KpiMemberData,
    GetKpiByEmailRequest,
    GetAllKpiRequest,
    CheckPermissionRequest,
    VerifyLeaderCodeRequest,
    UpdateRoleToMemberRequest,
    SyncProgressRequest,
)
from app.modules.all_platform.schemas.posts import (
    GetAllPostsRequest,
    FilterPostsRequest,
    UnifiedPostsRequest,
    UnifiedFilterRequest,
)
from app.modules.all_platform.schemas.categories import (
    CategoryAddRequest,
    CategoryUpdateRequest,
    CategoryDeleteRequest,
)
from app.modules.all_platform.schemas.members import (
    MemberCreateRequest,
    MemberUpdateRequest,
    MemberDeleteRequest,
)
from app.modules.all_platform.schemas.quick_comment import (
    QuickCommentAddRequest,
    QuickCommentUpdateRequest,
    QuickCommentReorderRequest,
)
from app.modules.all_platform.schemas.quick_inbox import (
    QuickInboxAddRequest,
    QuickInboxUpdateRequest,
    QuickInboxReorderRequest,
)
from app.modules.all_platform.schemas.quote import (
    QuoteFormCreateRequest,
    QuoteFormUpdateRequest,
    QuoteItemInput,
    QuoteCreateRequest,
    QuoteUpdateRequest,
    QuoteStageUpdateRequest,
    QuoteOwnersUpdateRequest,
    QuoteVersionReasonRequest,
    QuoteHandoffChecklistUpdateRequest,
    QuoteCancelRequest,
    QuoteSoftDeleteRequest,
    QuoteHardDeleteRequest,
    QuoteRequestChangesRequest,
    QuoteApproveRequest,
    IssuerCompanyCreateRequest,
    IssuerCompanyUpdateRequest,
)
from app.modules.all_platform.schemas.service_catalog import (
    ServiceCatalogItemCreateRequest,
    ServiceCatalogItemUpdateRequest,
    ServiceCatalogItemPricingUpsertRequest,
    ServiceCatalogReorderRequest,
    BundleComponentInput,
    BundleComponentsSetRequest,
    QuoteFormCatalogLinksSetRequest,
)
from app.modules.all_platform.schemas.sales_asset import (
    SalesAssetCreateRequest,
    SalesAssetUpdateRequest,
    SalesAssetSendRequest,
)
from app.modules.all_platform.schemas.kpi_reward import (
    KpiRewardRulesSaveRequest,
    KpiRewardSubmitRequest,
    KpiRewardReviewRequest,
    KpiRewardSummaryRequest,
)
from app.modules.all_platform.schemas.internal_engagement import (
    InternalEngagementActionRecordRequest,
    InternalEngagementPost,
    InternalEngagementSummaryRequest,
    MyMarksRequest,
    PostInteractionsRequest,
    TeamTotalsRequest,
    TeamTrendRequest,
)
from app.modules.all_platform.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    GoogleLoginRequest,
    RefreshTokenRequest,
    UpdateProfileRequest,
    PromoteToLeaderRequest,
    SocialAccountCreateRequest,
    SocialAccountUpdateRequest,
    ChangePasswordRequest,
    DeactivateAccountRequest,
    CheckEmailRequest,
    ResetPasswordRequest,
)
from app.modules.all_platform.schemas.contract import (
    ContractClauseInput,
    ContractCreateRequest,
    ContractUpdateRequest,
    ContractStatusUpdateRequest,
    ContractGenerateRequest,
    ContractReviewRequest,
    ContractRefineRequest,
)
