export interface PublicCrawlConfig {
  id: string;
  enabled: boolean;
  cycle_interval_min: number;
  groups_per_ip_rotate: number;
  max_posts_per_group: number;
  max_scrolls_per_group: number;
  concurrent_sims: number;
  auto_skip_private: boolean;
  headless: boolean;
  updated_at?: string | null;
}

export interface PublicCrawlRuntime {
  is_running: boolean;
  stop_requested: boolean;
  active_run_id: string | null;
  started_at: string | null;
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
  hasSocks: boolean;
  hasConsole: boolean;
  status: "idle" | "crawling" | "rotating" | "error";
  epoch: number;
  groups_in_epoch: number;
  total_groups: number;
  total_rotations: number;
  last_egress_ip: string | null;
  last_rotated_at: string | null;
  last_error: string | null;
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
  consoleUrl: string | null;
  socksUrl: string | null;
  consoleOk: boolean;
  socksOk: boolean;
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
