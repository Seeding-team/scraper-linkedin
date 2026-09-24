import { cn } from "@/lib/utils";

export type MaterialSymbolName =
  | "search"
  | "notifications"
  | "settings"
  | "menu"
  | "radar"
  | "download"
  | "group"
  | "inbox"
  | "forum"
  | "error_outline"
  | "list_alt"
  | "playlist_add"
  | "api"
  | "add"
  | "help"
  | "account_circle"
  | "person"
  | "shield_person"
  | "error"
  | "settings_input_component"
  | "monitoring"
  | "file_download"
  | "code"
  | "refresh"
  | "visibility"
  | "visibility_off"
  | "chevron_left"
  | "chevron_right"
  | "group_add"
  | "person_add"
  | "calendar_month"
  | "assignment"
  | "speed"
  | "database"
  | "analytics"
  | "trending_up"
  | "filter_list"
  | "table_view"
  | "open_in_new"
  | "thumb_up"
  | "favorite"
  | "celebration"
  | "volunteer_activism"
  | "lightbulb"
  | "sentiment_very_satisfied"
  | "comment"
  | "share"
  | "arrow_upward"
  | "check_circle"
  | "info"
  | "tune"
  | "close"
  | "lock"
  | "block"
  | "verified_user"
  | "filter_alt_off"
  | "edit"
  | "delete"
  | "sync"
  | "article"
  | "more_vert"
  | "chat_bubble"
  | "history"
  | "dataset"
  | "category"
  | "dashboard"
  | "verified"
  | "link"
  | "pending"
  | "manage_accounts"
  | "logout"
  | "warning"
  | "pause_circle"
  | "bedtime"
  | "person_search"
  | "lock_reset"
  | "calendar_today"
  | "key"
  | "check_circle"
  | "check"
  | "arrow_forward"
  | "arrow_downward"
  | "folder"
  | "rocket_launch"
  | "travel_explore"
  | "groups"
  | "group_off"
  | "send"
  | "auto_awesome"
  | "support_agent"
  | "drag_indicator"
  | "call"
  | "arrow_back"
  | "mood"
  | "bolt"
  | "image"
  | "attach_file"
  | "videocam"
  | "support"
  | "qr_code_scanner"
  | "description"
  | "chat"
  | "star"
  | "star_border"
  | "login"
  | "push_pin"
  | "arrow_drop_down"
  | "campaign"
  | "done"
  | "done_all"
  | "mail"
  | "content_copy"
  | "cookie"
  | "warning_amber"
  | "navigate_next"
  | "keyboard_arrow_down"
  | "request_quote"
  | "account_balance_wallet"
  | "military_tech"
  | "card_giftcard"
  | "shield"
  | "paid"
  | "track_changes"
  | "domain"
  // Sidebar CRM: "Cơ hội" (Pipeline/Kanban) — thêm mới cho việc đổi nhãn mục
  // /all-platform/crm từ "CRM" sang "Cơ hội" kèm icon phễu, phân biệt với
  // "Leads" (person_add) và các icon còn lại trong nhóm Quản lý CRM.
  | "filter_alt"
  | "bookmark_add"
  | "folder_shared";

export interface MaterialIconProps {
  name: MaterialSymbolName;
  className?: string;
  filled?: boolean;
  "aria-hidden"?: boolean;
}

const OUTLINED_VAR =
  "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" as const;
const FILLED_VAR =
  "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" as const;

export function MaterialIcon({
  name,
  className,
  filled = false,
  "aria-hidden": ariaHidden = true,
}: MaterialIconProps) {
  return (
    <span
      className={cn("material-symbols-outlined", className)}
      style={{ fontVariationSettings: filled ? FILLED_VAR : OUTLINED_VAR }}
      aria-hidden={ariaHidden}
    >
      {name}
    </span>
  );
}
