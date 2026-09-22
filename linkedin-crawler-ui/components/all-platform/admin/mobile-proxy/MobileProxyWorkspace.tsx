"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { mobileProxyService } from "@/services/mobile-proxy.service";
import type { MobileProxyConfigResponse, MobileProxySmsMessage } from "@/types/mobile-proxy";

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

export function MobileProxyWorkspace() {
  const [data, setData] = useState<MobileProxyConfigResponse | null>(null);
  const [sms, setSms] = useState<MobileProxySmsMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const status = await mobileProxyService.getStatus();
      setData(status);
      try {
        const inbox = await mobileProxyService.getSms();
        setSms(inbox.messages ?? inbox.cached ?? []);
      } catch (smsErr) {
        setSms([]);
        if (!status.liveError) {
          setError(smsErr instanceof Error ? smsErr.message : String(smsErr));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 25000);
    return () => clearInterval(t);
  }, [refresh]);

  const node = data?.nodes?.[0];
  const live = data?.live;

  async function handleRotate() {
    setRotating(true);
    try {
      await mobileProxyService.rotate();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mobile proxy (SIM)</h1>
        <p className="text-sm text-muted-foreground">
          PC cắm phone chạy console :4320. Tool/scraper copy URL SOCKS bên dưới. Cty sau này chỉ đổi env
          VPS/LAN.
        </p>
      </div>

      {(error || data?.liveError) && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error || data?.liveError}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Trạng thái SIM</CardTitle>
          <CardDescription>
            ADB: {live?.adb?.serial ? `${live.adb.serial} (${live.adb.state})` : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-lg font-semibold text-emerald-700">
            IP mobile: {live?.directMobileIp ?? "—"}
          </p>
          <p className="text-sm text-muted-foreground">
            IP qua SOCKS5: {live?.egressIp ?? "—"}
            {live?.proxy?.hint ? ` · ${live.proxy.hint}` : ""}
          </p>
          <Button type="button" onClick={() => void handleRotate()} disabled={rotating}>
            {rotating ? "Đang xoay IP…" : "Xoay IP (airplane)"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>URL cho tool / nhân viên</CardTitle>
          <CardDescription>{node?.label ?? "SIM-01"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CopyField label="PC cắm USB (máy nhà / RDP host)" value={node?.socksUrlLocalPc ?? ""} />
          <CopyField label="Office LAN (Wi‑Fi phone — sau khi lên cty)" value={node?.socksUrlOffice ?? ""} />
          <CopyField label="VPS (sau tunnel)" value={node?.socksUrlVps ?? ""} />
          <CopyField label="Proxy đang live trên console" value={live?.proxy?.url ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SMS / OTP</CardTitle>
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
