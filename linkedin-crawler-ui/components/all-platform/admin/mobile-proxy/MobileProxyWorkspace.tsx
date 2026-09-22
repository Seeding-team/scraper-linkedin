"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { mobileProxyService } from "@/services/mobile-proxy.service";
import type {
  MobileProxyConfigResponse,
  MobileProxyLiveEntry,
  MobileProxyNode,
  MobileProxySmsMessage,
} from "@/types/mobile-proxy";

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <code className="flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
          {value || "—"}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!value}
          onClick={() => navigator.clipboard.writeText(value)}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  live,
  onRotate,
  rotating,
}: {
  node: MobileProxyNode;
  live?: MobileProxyLiveEntry;
  onRotate: () => void;
  rotating: boolean;
}) {
  const status = live?.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{node.label}</CardTitle>
        <CardDescription>
          ADB: {status?.adb?.serial ? `${status.adb.serial} (${status.adb.state})` : "—"}
          {live?.error ? ` · ${live.error}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-lg font-semibold text-emerald-700">
          IP mobile: {status?.directMobileIp ?? "—"}
        </p>
        <p className="text-sm text-muted-foreground">
          IP qua SOCKS5: {status?.egressIp ?? "—"}
          {status?.proxy?.hint ? ` · ${status.proxy.hint}` : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-1">
          <CopyField label="PC cắm USB (máy đang cắm phone)" value={node.socksUrlLocalPc ?? ""} />
          <CopyField label="Office LAN (Wi‑Fi phone)" value={node.socksUrlOffice ?? ""} />
          <CopyField label="VPS (sau tunnel — dùng cho tool công ty)" value={node.socksUrlVps ?? ""} />
          <CopyField label="Proxy đang live trên console" value={status?.proxy?.url ?? ""} />
        </div>
        <Button type="button" onClick={onRotate} disabled={rotating}>
          {rotating ? "Đang xoay IP…" : "Xoay IP (airplane)"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function MobileProxyWorkspace() {
  const [data, setData] = useState<MobileProxyConfigResponse | null>(null);
  const [sms, setSms] = useState<MobileProxySmsMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const status = await mobileProxyService.getStatus();
      setData(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    try {
      const inbox = await mobileProxyService.getSms();
      setSms(inbox.messages ?? []);
    } catch {
      setSms([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 25000);
    return () => clearInterval(t);
  }, [refresh]);

  async function handleRotate(nodeId: string) {
    setRotatingId(nodeId);
    try {
      await mobileProxyService.rotate(nodeId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRotatingId(null);
    }
  }

  const nodes = data?.nodes ?? [];
  const liveById = new Map((data?.live ?? []).map((entry) => [entry.id, entry]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mobile proxy (SIM)</h1>
        <p className="text-sm text-muted-foreground">
          Mỗi phone/SIM chạy 1 mobile-proxy-console trên PC cắm USB. Thêm phone mới: cấu hình
          MOBILE_PROXY_NODES trên backend — không cần đổi code.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {data?.liveError && (
        <p className="rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data.liveError}
        </p>
      )}

      {nodes.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Chưa có node nào. Set MOBILE_PROXY_CONSOLE_URL (và các biến MOBILE_PROXY_SOCKS_*) trên
            backend.
          </CardContent>
        </Card>
      ) : (
        nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            live={liveById.get(node.id)}
            onRotate={() => void handleRotate(node.id)}
            rotating={rotatingId === node.id}
          />
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle>SMS / OTP (mọi SIM)</CardTitle>
        </CardHeader>
        <CardContent className="max-h-80 space-y-2 overflow-y-auto">
          {sms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có SMS hoặc chưa đọc được inbox.</p>
          ) : (
            sms.map((m) => (
              <div key={`${m.id}-${m.receivedAt}`} className="rounded-md border p-2 text-sm">
                <p className="font-medium text-primary">{m.from}</p>
                <p className="text-xs text-muted-foreground">{m.receivedAt}</p>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
