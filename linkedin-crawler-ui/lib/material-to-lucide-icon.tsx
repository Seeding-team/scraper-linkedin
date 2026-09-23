import {
  LayoutDashboard,
  Users,
  CircleUserRound,
  UserCog,
  Folder,
  Tag,
  FileText,
  Radar,
  Send,
  Headset,
  Inbox,
  Globe,
  MessageCircle,
  UsersRound,
  Database,
  Activity,
  Settings,
  ShieldCheck,
  ClipboardList,
  Cable,
  Receipt,
  LayoutTemplate,
  Megaphone,
  Building2,
  FileSearch,
  History,
  FileSignature,
  Funnel,
  UserPlus,
  Antenna,
  type LucideIcon,
} from "lucide-react";
import type { MaterialSymbolName } from "@/components/ui";

// Chuyen doi ten icon Material Symbols (dung trong buildEntries() cua
// AllPlatformSidebar.tsx) sang icon lucide-react tuong ung, de tai su dung
// dung 1 nguon cau hinh menu (buildEntries) cho ca 2 kieu hien thi sidebar
// (ban Material cu + ban shadcn moi lay mau tu app.markeeai.com).
const MAP: Partial<Record<MaterialSymbolName, LucideIcon>> = {
  dashboard: LayoutDashboard,
  groups: Users,
  account_circle: CircleUserRound,
  manage_accounts: UserCog,
  folder: Folder,
  category: Tag,
  article: FileText,
  radar: Radar,
  send: Send,
  support_agent: Headset,
  inbox: Inbox,
  travel_explore: Globe,
  chat: MessageCircle,
  group: UsersRound,
  database: Database,
  monitoring: Activity,
  settings: Settings,
  verified_user: ShieldCheck,
  assignment: ClipboardList,
  settings_input_component: Cable,
  request_quote: Receipt,
  star: LayoutTemplate,
  campaign: Megaphone,
  domain: Building2,
  person_search: FileSearch,
  description: FileSignature,
  history: History,
  // Leads/Cơ hội (2026-08-29) — "filter_alt"/"person_add" mới thêm vào
  // MaterialSymbolName union chưa có map ở đây thì rơi về FileText mặc định,
  // đụng luôn icon "article" (Sản xuất nội dung) — đúng kiểu bug "history"
  // ghi trong docstring trên. Ánh xạ tường minh, không icon nào khác trong
  // MAP này đang dùng Funnel/UserPlus.
  filter_alt: Funnel,
  person_add: UserPlus,
  cell_tower: Antenna,
};

export function materialToLucideIcon(name: MaterialSymbolName): LucideIcon {
  return MAP[name] ?? FileText;
}
