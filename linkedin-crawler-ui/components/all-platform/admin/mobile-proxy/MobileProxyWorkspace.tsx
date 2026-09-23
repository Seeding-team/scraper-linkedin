"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, RefreshCw, Smartphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mobileProxyService } from "@/services/mobile-proxy.service";
import type {
  MobileProxyConfigResponse,
  MobileProxyLiveEntry,
  MobileProxyNode,
  MobileProxyRawEndpoint,
  MobileProxySmsMessage,
} from "@/types/mobile-proxy";

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <code
          className={`flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 text-sm ${mono ? "font-mono" : ""}`}
        >
          {value || "—"}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!value}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check className="size-3.5" /> : "Copy"}
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
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <CopyField label="Host / IP" value={endpoint.host ?? ""} />
        <CopyField label="Port" value={endpoint.port ? String(endpoint.port) : ""} />
        <CopyField label="Username" value={endpoint.user ?? ""} />
        <CopyField label="Password" value={endpoint.pass ?? ""} />
      </div>
      <CopyField label="Chuỗi kết nối đầy đủ" value={endpoint.url} />
    </div>
  );
}

function PhoneNumberEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-center gap-1.5 text-lg font-semibold text-foreground hover:text-primary"
        title="Sửa số điện thoại"
      >
        {value || "Chưa đặt số"}
        <Pencil className="size-3.5 opacity-0 transition group-hover:opacity-60" />
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
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Nhập số điện thoại SIM"
        className="h-8 w-44 text-sm"
      />
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? "..." : "Lưu"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Huỷ
      </Button>
    </form>
  );
}

export function MobileProxyWorkspace() {
  const [data, setData] = useState<MobileProxyConfigResponse | null>(null);
  const [sms, setSms] = useState<MobileProxySmsMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const status = await mobileProxyService.getStatus();
      setData(status);
      setSelectedId((current) => {
        if (current && status.nodes.some((n) => n.id === current)) return current;
        return status.nodes[0]?.id ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 25000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setSms([]);
      return;
    }
    let cancelled = false;
    mobileProxyService
      .getSms(selectedId)
      .then((inbox) => {
        if (!cancelled) setSms(inbox.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setSms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, data]);

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

  async function handleRenameNode(nodeId: string, label: string) {
    try {
      const next = await mobileProxyService.setLabel(nodeId, label || nodeId);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const nodes = data?.nodes ?? [];
  const liveById = useMemo(
    () => new Map((data?.live ?? []).map((entry) => [entry.id, entry])),
    [data],
  );
  const selectedNode: MobileProxyNode | undefined = nodes.find((n) => n.id === selectedId);
  const selectedLive: MobileProxyLiveEntry | undefined = liveById.get(selectedId);
  const status = selectedLive?.data;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Proxy SIM</h1>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          Làm mới
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {data?.liveError ? (
        <p className="rounded-md border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data.liveError}
        </p>
      ) : null}

      {/* Khu vực 1: danh sách SIM / số điện thoại */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Danh sách SIM</CardTitle>
        </CardHeader>
        <CardContent>
          {nodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Chưa có SIM nào. Cấu hình MOBILE_PROXY_CONSOLE_URL trên backend để thêm.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {nodes.map((node) => {
                const live = liveById.get(node.id);
                const online = Boolean(live?.data?.directMobileIp);
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedId(node.id)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                      selectedId === node.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <Smartphone className="size-4 text-primary" />
                    <span className="text-sm font-medium">{node.label}</span>
                    <span className={`size-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedNode ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Khu vực 2: quản lý proxy */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <PhoneNumberEditor
                  value={selectedNode.label}
                  onSave={(next) => handleRenameNode(selectedNode.id, next)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  IP mobile: <span className="font-medium text-emerald-700">{status?.directMobileIp ?? "—"}</span>
                  {" · "}IP proxy: <span className="font-medium">{status?.egressIp ?? "—"}</span>
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRotate(selectedNode.id)}
                disabled={rotatingId === selectedNode.id}
              >
                {rotatingId === selectedNode.id ? "Đang xoay..." : "Xoay IP"}
              </Button>
            </CardHeader>
            <CardContent>
              {status?.proxy?.hint ? (
                <p className="mb-3 rounded-md border border-amber-400/40 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                  {status.proxy.hint}
                </p>
              ) : null}
              <Tabs defaultValue="vps">
                <TabsList>
                  <TabsTrigger value="vps">Dùng mọi nơi</TabsTrigger>
                  <TabsTrigger value="office">Wi-Fi văn phòng</TabsTrigger>
                  <TabsTrigger value="localPc">PC cắm USB</TabsTrigger>
                </TabsList>
                <TabsContent value="vps">
                  <EndpointFields endpoint={selectedNode.proxies?.vps} />
                </TabsContent>
                <TabsContent value="office">
                  <EndpointFields endpoint={selectedNode.proxies?.office} />
                </TabsContent>
                <TabsContent value="localPc">
                  <EndpointFields endpoint={selectedNode.proxies?.localPc} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Khu vực 3: tin nhắn theo số SIM đang chọn */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm">
                Tin nhắn · <span className="text-primary">{selectedNode.label}</span>
              </CardTitle>
              <Badge variant="outline">{sms.length}</Badge>
            </CardHeader>
            <CardContent className="max-h-[26rem] space-y-2 overflow-y-auto">
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
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
