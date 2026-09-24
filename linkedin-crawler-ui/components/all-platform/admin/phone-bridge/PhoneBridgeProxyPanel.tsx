"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, RefreshCw, Wifi } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mobileProxyService } from "@/services/mobile-proxy.service";
import type {
  MobileProxyLiveEntry,
  MobileProxyNode,
  MobileProxyRawEndpoint,
  MobileProxySmsMessage,
} from "@/types/mobile-proxy";

interface PhoneBridgeProxyPanelProps {
  /** ADB serial of the device selected on the Phone Bridge page. */
  serial: string;
}

function CopyRow({ label, value }: { label: string; value: string }) {
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

function EndpointFields({ endpoint }: { endpoint: MobileProxyRawEndpoint | null | undefined }) {
  if (!endpoint) {
    return <p className="text-sm text-muted-foreground">Chưa cấu hình.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <CopyRow label="Host / IP" value={endpoint.host ?? ""} />
      <CopyRow label="Port" value={endpoint.port ? String(endpoint.port) : ""} />
      <CopyRow label="Username" value={endpoint.user ?? ""} />
      <CopyRow label="Password" value={endpoint.pass ?? ""} />
    </div>
  );
}

function PhoneNumberEditor({ value, onSave }: { value: string; onSave: (next: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary"
      >
        {value || "Chưa đặt số"}
        <Pencil className="size-3 opacity-0 transition group-hover:opacity-60" />
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSaving(true);
        void onSave(draft).finally(() => {
          setSaving(false);
          setEditing(false);
        });
      }}
    >
      <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="h-7 w-36 text-xs" />
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "..." : "Lưu"}
      </Button>
    </form>
  );
}

export function PhoneBridgeProxyPanel({ serial }: PhoneBridgeProxyPanelProps) {
  const [loading, setLoading] = useState(true);
  const [node, setNode] = useState<MobileProxyNode | null>(null);
  const [live, setLive] = useState<MobileProxyLiveEntry | null>(null);
  const [sms, setSms] = useState<MobileProxySmsMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await mobileProxyService.getStatus();
      const liveEntries = status.live ?? [];
      const matchedLive = liveEntries.find((entry) => entry.data?.adb?.serial === serial) ?? null;
      const matchedNode = matchedLive
        ? (status.nodes ?? []).find((n) => n.id === matchedLive.id) ?? null
        : null;
      setLive(matchedLive);
      setNode(matchedNode);
      setNotFound(!matchedLive);

      if (matchedLive) {
        const inbox = await mobileProxyService.getSms(matchedLive.id);
        setSms(inbox.messages ?? []);
      } else {
        setSms([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [serial]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 25000);
    return () => clearInterval(t);
  }, [refresh]);

  async function handleRotate() {
    if (!live) return;
    setRotating(true);
    try {
      await mobileProxyService.rotate(live.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  }

  async function handleRename(next: string) {
    if (!live) return;
    try {
      await mobileProxyService.setLabel(live.id, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading && !live && !notFound) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Đang tải thông tin proxy...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Chưa cấu hình mobile-proxy cho thiết bị này.</p>
        <p className="mt-1">
          Serial <code className="rounded bg-muted px-1">{serial}</code> chưa khớp node nào. Chạy
          mobile-proxy-console (android-work-bridge) trên PC cắm máy này, mở tunnel về VM, rồi thêm
          node vào backend qua <code className="rounded bg-muted px-1">MOBILE_PROXY_NODES</code> +
          các biến <code className="rounded bg-muted px-1">MOBILE_PROXY_&lt;ID&gt;_*</code> (đặt
          Label = số điện thoại của SIM để dễ quản lý).
        </p>
      </div>
    );
  }

  const status = live?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <PhoneNumberEditor value={node?.label ?? live?.label ?? ""} onSave={handleRename} />
          {live?.error ? <p className="text-xs text-destructive">{live.error}</p> : null}
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">IP mobile (SIM)</p>
          <p className="text-lg font-semibold text-emerald-700">{status?.directMobileIp ?? "—"}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">IP ra qua SOCKS5</p>
          <p className="text-lg font-semibold">{status?.egressIp ?? "—"}</p>
          {status?.proxy?.hint ? (
            <p className="text-xs text-amber-700">{status.proxy.hint}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Wifi className="size-4 text-primary" /> Thông tin proxy
          </p>
          <Button type="button" size="sm" onClick={() => void handleRotate()} disabled={rotating}>
            {rotating ? "Đang xoay..." : "Xoay IP"}
          </Button>
        </div>
        <Tabs defaultValue="vps">
          <TabsList>
            <TabsTrigger value="vps">Dùng mọi nơi</TabsTrigger>
            <TabsTrigger value="office">Wi-Fi văn phòng</TabsTrigger>
            <TabsTrigger value="localPc">PC cắm USB</TabsTrigger>
          </TabsList>
          <TabsContent value="vps">
            <EndpointFields endpoint={node?.proxies?.vps} />
          </TabsContent>
          <TabsContent value="office">
            <EndpointFields endpoint={node?.proxies?.office} />
          </TabsContent>
          <TabsContent value="localPc">
            <EndpointFields endpoint={node?.proxies?.localPc} />
          </TabsContent>
        </Tabs>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">SMS / OTP</p>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {sms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có SMS.</p>
          ) : (
            sms.map((m) => (
              <div key={`${m.id}-${m.receivedAt}`} className="rounded-md border p-2 text-sm">
                <p className="font-medium text-primary">{m.from}</p>
                <p className="text-xs text-muted-foreground">{m.receivedAt}</p>
                <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
