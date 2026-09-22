export interface MobileProxyNode {
  id: string;
  label: string;
  socksUrlOffice?: string | null;
  socksUrlVps?: string | null;
  socksUrlLocalPc?: string | null;
  consoleUrl?: string | null;
  port?: number;
}

export interface MobileProxyLiveStatus {
  directMobileIp?: string | null;
  egressIp?: string | null;
  adb?: { serial?: string; state?: string };
  proxy?: {
    host?: string | null;
    port?: number;
    username?: string;
    password?: string;
    url?: string | null;
    socksReady?: boolean;
    hint?: string | null;
  };
}

export interface MobileProxyLiveEntry {
  id: string;
  label: string;
  data: MobileProxyLiveStatus | null;
  error: string | null;
}

export interface MobileProxyConfigResponse {
  enabled: boolean;
  consoleConfigured?: boolean;
  nodes: MobileProxyNode[];
  live?: MobileProxyLiveEntry[];
  liveError?: string | null;
}

export interface MobileProxySmsMessage {
  id: string;
  from: string;
  body: string;
  receivedAt?: string;
}

export interface MobileProxySmsResponse {
  messages: MobileProxySmsMessage[];
  byNode?: { id: string; label: string; data: unknown; error: string | null }[];
  error?: string;
}

export interface MobileProxyRotateNodeResult {
  id: string;
  label: string;
  data: { ok?: boolean; directMobileIp?: string; egressIp?: string; steps?: string[] } | null;
  error: string | null;
}

export interface MobileProxyRotateResponse {
  ok: boolean;
  results: MobileProxyRotateNodeResult[];
  error?: string;
}
