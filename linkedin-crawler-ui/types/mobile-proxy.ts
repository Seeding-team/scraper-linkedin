export interface MobileProxyNode {
  id: string;
  label: string;
  socksUrlOffice?: string | null;
  socksUrlVps?: string | null;
  socksUrlLocalPc?: string | null;
  consoleUrl?: string | null;
  port?: number;
}

export interface MobileProxyConfigResponse {
  enabled: boolean;
  consoleConfigured?: boolean;
  nodes: MobileProxyNode[];
  live?: MobileProxyLiveStatus | null;
  liveError?: string | null;
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

export interface MobileProxySmsMessage {
  id: string;
  from: string;
  body: string;
  receivedAt?: string;
}

export interface MobileProxySmsResponse {
  messages?: MobileProxySmsMessage[];
  cached?: MobileProxySmsMessage[];
  error?: string;
}

export interface MobileProxyRotateResponse {
  ok: boolean;
  directMobileIp?: string;
  egressIp?: string;
  error?: string;
  steps?: string[];
}
