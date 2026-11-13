export interface PublicCrawlConfig {
  id: string;
  enabled: boolean;
  cycle_interval_min: number;
  groups_per_ip_rotate: number;
  max_posts_per_group: number;
  max_scrolls_per_group: number;
  concurrent_sims: number;
  max_allowed_concurrent_sims?: number;
  auto_skip_private: boolean;
  headless: boolean;
  updated_at?: string | null;
  proxies_configured?: number;
  proxies_masked?: string[];
  proxy_urls?: string[] | string;
  auto_pause_reason?: string | null;
  proxy_expired_error?: string | null;
  alternating_threads_enabled?: boolean;
  threads_keyword_target?: number;
  threads_max_posts_per_keyword?: number;
  threads_max_age_days?: number;
  last_completed_platform?: "facebook" | "threads" | null;
}

export interface ThreadsKeywordStatItem {
  keyword: string;
  times_used: number;
  total_posts_found: number;
  high_score_posts: number;
}

export interface PublicCrawlRuntime {
  is_running: boolean;
  stop_requested: boolean;
  active_run_id: string | null;
  started_at: string | null;
  loop_round?: number;
  last_round_finished_at?: string | null;
  new_groups_detected?: number;
  auto_pause_reason?: string | null;
  proxy_expired_error?: string | null;
  continuous_waiting?: boolean;
  current_platform?: "facebook" | "threads" | "both";
  next_platform?: "facebook" | "threads";
  last_completed_platform?: "facebook" | "threads" | null;
  parallel_mode?: boolean;
  facebook?: {
    is_running: boolean;
    active_run_id?: string | null;
    loop_round?: number;
    waiting?: boolean;
    total_groups?: number;
    completed_groups?: number;
    posts_saved?: number;
  };
  threads?: {
    is_running: boolean;
    active_run_id?: string | null;
    loop_round?: number;
    waiting?: boolean;
    total_groups?: number;
    completed_groups?: number;
    posts_saved?: number;
    active_threads_keywords?: ThreadsKeywordStatItem[];
  };
  active_threads_keywords?: ThreadsKeywordStatItem[];
  threads_keyword_meta?: {
    total_active?: number;
    selected_count?: number;
    newly_generated?: number;
    deactivated?: string[];
    ai_powered?: boolean;
  };
  total_groups: number;
  completed_groups: number;
  groups_ok: number;
  groups_failed: number;
  groups_private: number;
  posts_saved: number;
  ip_rotations: number;
  avg_ms_per_group: number;
}

export interface PublicSimNodeRuntime {
  id: string;
  label: string;
  platform?: "facebook" | "threads" | string | null;
  hasSocks: boolean;
  hasConsole?: boolean;
  autoRotating?: boolean;
  proxyMode?: string;
  maskedUrl?: string;
  socksHost?: string | null;
  socksPort?: number | null;
  scheme?: string;
  status: "idle" | "crawling" | "rotating" | "error" | "expired";
  epoch: number;
  groups_in_epoch: number;
  total_groups: number;
  total_rotations: number;
  consecutive_proxy_failures?: number;
  last_egress_ip: string | null;
  last_rotated_at: string | null;
  last_error: string | null;
  last_latency_ms?: number | null;
  last_fb_status?: number | null;
}

export interface PublicCrawlLogEntry {
  ts: string;
  level: "info" | "success" | "warn" | "error" | string;
  sim_id: string;
  message: string;
}

export interface PublicCrawlRunRecord {
  id: string;
  trigger_source: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  total_groups: number;
  groups_ok: number;
  groups_failed: number;
  groups_private: number;
  posts_saved: number;
  ip_rotations: number;
  avg_ms_per_group: number;
  sim_nodes?: string[];
  error_summary?: string | null;
}

export interface PublicCrawlGroupItem {
  id: string;
  group_name: string | null;
  group_url: string;
  members?: number | null;
  visibility: "public" | "private";
  public_crawl_enabled: boolean;
  public_crawl_interval_min: number;
  last_public_crawled_at?: string | null;
  last_public_crawl_status?: string | null;
  last_public_crawl_error?: string | null;
  last_public_posts_count: number;
  chay_24h?: boolean;
  crawl_time?: string | null;
}

export interface PublicCrawlStatusResponse {
  success: boolean;
  config: PublicCrawlConfig;
  runtime: PublicCrawlRuntime;
  sims: PublicSimNodeRuntime[];
  recent_runs: PublicCrawlRunRecord[];
  logs: PublicCrawlLogEntry[];
}

export interface PublicCrawlActionResponse {
  success: boolean;
  started?: boolean;
  stopped?: boolean;
  reason?: string;
  message?: string;
  run_id?: string;
  total_groups?: number;
  sim_nodes?: string[];
  active_run_id?: string | null;
}

export interface ProxyTestResultItem {
  id: string;
  label: string;
  maskedUrl?: string | null;
  consoleUrl?: string | null;
  socksUrl?: string | null;
  consoleOk?: boolean;
  socksOk: boolean;
  fbOk?: boolean;
  fbStatus?: number | null;
  autoRotating?: boolean;
  egressIpBefore: string | null;
  egressIpAfter: string | null;
  ipChanged?: boolean;
  latencyMs: number | null;
  rotated: boolean;
  error: string | null;
}

export interface ProxyTestResponse {
  success: boolean;
  ok: boolean;
  results: ProxyTestResultItem[];
  error?: string;
}

export type CrawledPostAiStatus =
  | "pending"
  | "kept"
  | "deleted_competitor"
  | "deleted_low_score"
  | "unconfigured"
  | "error"
  | string;

export interface CrawledPostAuditItem {
  id?: string;
  platform: string;
  crawl_source: "public_4g" | "vps_queue" | "extension" | "historical" | string;
  run_id?: string | null;
  proxy_node?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  group_url?: string | null;
  post_id?: string | null;
  post_url: string;
  author_name?: string | null;
  content: string;
  post_time?: string | null;
  reactions: number;
  comments: number;
  shares: number;
  ai_status: CrawledPostAiStatus;
  lead_score?: number | null;
  is_competitor?: boolean | null;
  is_buyer?: boolean | null;
  lead_need_category?: string | null;
  lead_score_reason?: string | null;
  contact_phone?: string | null;
  auto_seeding_created?: boolean;
  zalo_triggered?: boolean;
  crawled_at?: string | null;
  ai_checked_at?: string | null;
}

export interface CrawledPostsSummary {
  total_4g_posts: number;
  today_4g_posts: number;
  pending_ai_count: number;
  ai_checked_total: number;
  ai_lead_high_count: number;
  ai_kept_mid_count: number;
  ai_deleted_count: number;
  auto_seeding_count: number;
}

export interface CrawledPostsOverviewResponse {
  success: boolean;
  summary: CrawledPostsSummary;
  public_4g_posts: CrawledPostAuditItem[];
  ai_checked_posts: CrawledPostAuditItem[];
}
