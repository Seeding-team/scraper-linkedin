from app.modules.all_platform.services.supabase_seeding_service import (
    save_seeding_mark,
    verify_seeding_mark,
    get_all_seeding_marks,
    get_unverified_seeding_marks,
    get_member_seeding_count,
    save_seeding_kpi,
    get_all_seeding_kpi,
    get_kpi_target,
)
from app.modules.all_platform.services.supabase_kpi_service import (
    assign_kpi,
    compute_kpi_inbox_progress,
    get_all_kpis_for_leader,
    get_kpi_by_email,
    get_kpi_inbox_progress_by_email,
    count_fb_inbox_kpi,
    get_fb_inbox_kpi_summary,
    get_pending_fb_inbox_kpi,
    sync_kpi_progress,
    check_permission,
    verify_leader_code,
    update_user_role_to_member,
)
from app.modules.all_platform.services.supabase_posts_service import (
    get_all_facebook_posts,
    get_all_linkedin_posts,
    filter_facebook_posts,
    filter_linkedin_posts,
    sync_facebook_post_progress,
)
from app.modules.all_platform.services.supabase_categories_service import (
    get_all_categories,
    get_categories_by_type,
    add_category,
    update_category,
    delete_category,
)
from app.modules.all_platform.services.supabase_members_service import (
    get_all_members,
    get_member,
    create_member,
    update_member,
    delete_member,
    get_all_skills,
    create_skill,
    update_skill,
    delete_skill,
    parse_excel_rows,
    import_members_from_rows,
    sync_members_from_list,
)
from app.modules.all_platform.services.supabase_quick_comment_service import (
    get_all_quick_comments,
    add_quick_comment,
    update_quick_comment,
    delete_quick_comment,
    reorder_quick_comment,
)
from app.modules.all_platform.services.supabase_quote_service import (
    list_quote_forms,
    get_quote_form,
    get_public_quote_form,
    create_quote_form,
    update_quote_form,
    delete_quote_form,
    duplicate_quote_form,
    share_quote_form,
    list_quotes,
    get_quote,
    get_public_quote,
    create_quote,
    update_quote,
    delete_quote,
    approve_quote,
    update_and_approve_quote,
    create_quote_version,
    list_quote_versions,
    link_quote_to_deal,
    list_issuer_companies,
    create_issuer_company,
    update_issuer_company,
)
from app.modules.all_platform.services.supabase_service_catalog_service import (
    list_service_catalog_items,
    get_service_catalog_item,
    create_service_catalog_item,
    update_service_catalog_item,
    delete_service_catalog_item,
    reorder_service_catalog_item,
    set_bundle_components,
    render_bundle_description,
    get_quote_form_catalog_links,
    set_quote_form_catalog_links,
    get_service_catalog_options_for_form,
)
from app.modules.all_platform.services.quote_telegram_service import (
    send_quote_to_telegram,
    get_quote_telegram_log,
)
from app.modules.all_platform.services.supabase_sales_asset_service import (
    list_sales_assets,
    get_sales_asset,
    create_sales_asset,
    update_sales_asset,
    archive_sales_asset,
    delete_sales_asset,
    send_sales_asset,
)
from app.modules.all_platform.services.supabase_kpi_reward_service import (
    list_reward_rules,
    save_reward_rules,
    submit_reward_rules,
    review_reward_rules,
    get_reward_summary,
)
from app.modules.all_platform.services.supabase_quick_inbox_service import (
    get_all_quick_inbox,
    add_quick_inbox,
    update_quick_inbox,
    delete_quick_inbox,
    reorder_quick_inbox,
)
from app.modules.all_platform.services.supabase_groups_service import (
    get_facebook_groups,
    add_facebook_group,
    update_facebook_group,
    delete_facebook_group,
    get_linkedin_groups,
    add_linkedin_group,
    update_linkedin_group,
    delete_linkedin_group,
)
from app.modules.all_platform.services.supabase_user_service import (
    get_user,
    upsert_user,
    update_user_slug,
    update_user_role,
    update_user_active_status,
    update_user_quote_approver,
    get_team_members,
    add_team_member,
    get_all_users,
    get_users_by_role,
    get_all_teams,
    get_all_teams_with_kpi,
    create_team,
    update_team,
    delete_team,
)
from app.modules.all_platform.services.auth_service import (
    register_user,
    login_user,
    login_with_google,
    admin_create_user,
    logout_user,
    decode_token,
    get_user_by_id,
    get_user_by_email,
    update_user_profile,
    create_access_token,
    verify_leader_code,
    promote_to_leader,
    promote_to_leader,
    get_user_sessions,
    delete_session,
    delete_all_sessions,
    change_password,
    deactivate_account,
    reset_password_without_old,
)
from app.modules.all_platform.services.social_accounts_service import (
    get_social_accounts,
    get_social_account_by_id,
    get_primary_account,
    create_social_account,
    update_social_account,
    delete_social_account,
    set_primary_account,
    get_social_account_summary,
)
from app.modules.all_platform.services.supabase_linkedin_account_service import (
    get_linkedin_accounts,
    add_linkedin_account,
    update_linkedin_account,
    delete_linkedin_account,
    get_linkedin_account_password,
)
from app.modules.all_platform.services.platforms_service import (
    get_all_platforms,
)
from app.modules.all_platform.services.supabase_contract_service import (
    list_contracts,
    get_contract,
    create_contract,
    update_contract,
    update_contract_status,
    delete_contract,
    get_contracts_dashboard_stats,
)
from app.modules.all_platform.services.contract_ai_service import (
    generate_contract_draft,
    review_contract_risk,
    refine_contract_draft,
)
from app.modules.all_platform.services.contract_template_service import (
    list_contract_templates,
    get_contract_template,
    create_contract_template,
    delete_contract_template,
)
from app.modules.all_platform.services.crm_permission_service import (
    is_sale_member,
    has_full_crm_access,
    can_write_deal,
)
