"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Cable,
  Loader2,
  RefreshCw,
  Server,
  Smartphone,
  Wifi,
} from "lucide-react";

import { PhoneBridgeChatPanel } from "./PhoneBridgeChatPanel";
import { PhoneBridgeFacebookPanel } from "./PhoneBridgeFacebookPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { phoneBridgeService } from "@/services/phone-bridge.service";
import type {
  PhoneBridgeConnectionState,
  PhoneBridgeDevice,
  PhoneBridgeEvent,
  PhoneBridgeStatus,
} from "@/types/phone-bridge";

type StatusTone = "online" | "offline" | "unknown";

interface DisplayStatus {
  label: string;
  tone: StatusTone;
}

function toDisplayStatus(
  value: PhoneBridgeConnectionState | string | undefined,
  fallback?: boolean,
): DisplayStatus {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    const online = ["ok", "ready", "online", "connected", "active"].some(
      (item) => normalized.includes(item),
    );
    const offline = ["down", "offline", "disconnected", "error"].some((item) =>
      normalized.includes(item),
    );
    return {
      label: value,
      tone: online ? "online" : offline ? "offline" : "unknown",
    };
  }

  const connected = value?.connected ?? value?.online ?? fallback;
  return {
    label:
      value?.status ??
      value?.message ??
      (connected === true
        ? "Đã kết nối"
        : connected === false
          ? "Mất kết nối"
          : "Chưa rõ"),
    tone:
      connected === true
        ? "online"
        : connected === false
          ? "offline"
          : "unknown",
  };
}

function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Badge
      variant="outline"
      className={
        status.tone === "online"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status.tone === "offline"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
      }
    >
      <span
        className={`size-1.5 rounded-full ${
          status.tone === "online"
            ? "bg-emerald-500"
            : status.tone === "offline"
              ? "bg-red-500"
              : "bg-amber-500"
        }`}
      />
      {status.label}
    </Badge>
  );
}

function eventText(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return "Không thể hiển thị payload";
  }
}

function deviceLabel(device: PhoneBridgeDevice): string {
  return device.name ?? device.model ?? device.serial;
}

function healthConnection(
  health: PhoneBridgeStatus["health"],
): PhoneBridgeConnectionState | string | undefined {
  if (!health) return undefined;
  const value =
    health.tunnel ?? health.tunnelStatus ?? health.tunnel_status;
  return typeof value === "string" ||
    (value !== null && typeof value === "object")
    ? (value as PhoneBridgeConnectionState | string)
    : undefined;
}

export function PhoneBridgeWorkspace() {
  const [status, setStatus] = useState<PhoneBridgeStatus | null>(null);
  const [devices, setDevices] = useState<PhoneBridgeDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<PhoneBridgeEvent[]>([]);
  const [streamState, setStreamState] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResult, devicesResult] = await Promise.allSettled([
        phoneBridgeService.getStatus(),
        phoneBridgeService.getDevices(),
      ]);

      if (statusResult.status === "fulfilled") {
        setStatus(statusResult.value);
      }
      const nextDevices =
        devicesResult.status === "fulfilled"
          ? devicesResult.value.devices ?? []
          : [];
      setDevices(nextDevices);
      setSelectedSerial((current) => {
        if (current && nextDevices.some((device) => device.serial === current)) {
          return current;
        }
        return nextDevices[0]?.serial ?? "";
      });

      const failures = [statusResult, devicesResult]
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) =>
          result.reason instanceof Error
            ? result.reason.message
            : "Không thể tải một phần trạng thái Phone Bridge.",
        );
      if (failures.length > 0) setError(failures.join(" "));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không thể tải trạng thái Phone Bridge.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshOverview(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshOverview]);

  useEffect(() => {
    const source = new EventSource(phoneBridgeService.eventsUrl, {
      withCredentials: true,
    });

    source.onopen = () => setStreamState("connected");
    source.onerror = () => setStreamState("reconnecting");
    const handleEvent = (event: MessageEvent<string>) => {
      let data: unknown = event.data;
      try {
        data = JSON.parse(event.data);
      } catch {
        // Plain-text events are valid SSE payloads.
      }
      const envelope =
        data && typeof data === "object"
          ? (data as {
              eventId?: unknown;
              payload?: { type?: unknown };
              type?: unknown;
            })
          : null;
      const typedData =
        envelope?.payload?.type ?? envelope?.type ?? "message";
      setEvents((current) =>
        [
          {
            id:
              event.lastEventId ||
              (typeof envelope?.eventId === "string"
                ? envelope.eventId
                : "") ||
              `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            receivedAt: new Date().toISOString(),
            type: String(typedData),
            data,
          },
          ...current,
        ].slice(0, 30),
      );
    };
    source.onmessage = handleEvent;
    source.addEventListener("bridge-event", handleEvent);

    return () => {
      source.removeEventListener("bridge-event", handleEvent);
      source.close();
    };
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === selectedSerial),
    [devices, selectedSerial],
  );
  const bridgeStatus = toDisplayStatus(
    status?.bridge,
    status?.connected ?? status?.online,
  );
  const tunnelStatus = toDisplayStatus(
    status?.tunnel ?? healthConnection(status?.health),
    status?.online,
  );
  const currentDeviceStatus = toDisplayStatus(
    selectedDevice?.status ?? selectedDevice?.state,
    selectedDevice?.connected ?? selectedDevice?.online,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Admin Phone Bridge
            </h1>
            <Badge variant="secondary">Trial</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Điều khiển Messenger, Zalo và Facebook qua thiết bị đã kết nối.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void refreshOverview()}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Làm mới trạng thái
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="gap-3 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 py-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="size-4 text-primary" />
              Bridge
            </CardTitle>
            {loading && !status ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <StatusBadge status={bridgeStatus} />
            )}
          </CardHeader>
        </Card>
        <Card className="gap-3 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 py-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cable className="size-4 text-primary" />
              Tunnel
            </CardTitle>
            {loading && !status ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <StatusBadge status={tunnelStatus} />
            )}
          </CardHeader>
        </Card>
        <Card className="gap-3 py-4">
          <CardHeader className="flex-row items-center justify-between px-4 py-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Smartphone className="size-4 text-primary" />
              Thiết bị
            </CardTitle>
            <StatusBadge status={currentDeviceStatus} />
          </CardHeader>
        </Card>
      </div>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4 py-0">
          <CardTitle className="text-sm">Chọn thiết bị</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {devices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              {loading ? "Đang tìm thiết bị..." : "Không có thiết bị khả dụng."}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {devices.map((device) => (
                <button
                  key={device.serial}
                  type="button"
                  onClick={() => setSelectedSerial(device.serial)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    selectedSerial === device.serial
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <span className="block font-medium">{deviceLabel(device)}</span>
                  <span className="block font-mono text-xs opacity-70">
                    {device.serial}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSerial ? (
        <Tabs defaultValue="messenger" className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit">
            <TabsTrigger value="messenger">Messenger</TabsTrigger>
            <TabsTrigger value="zalo">Zalo</TabsTrigger>
            <TabsTrigger value="facebook">Facebook</TabsTrigger>
          </TabsList>
          <TabsContent value="messenger">
            <PhoneBridgeChatPanel
              key={`${selectedSerial}-messenger`}
              serial={selectedSerial}
              platform="messenger"
            />
          </TabsContent>
          <TabsContent value="zalo">
            <PhoneBridgeChatPanel
              key={`${selectedSerial}-zalo`}
              serial={selectedSerial}
              platform="zalo"
            />
          </TabsContent>
          <TabsContent value="facebook">
            <PhoneBridgeFacebookPanel
              key={`${selectedSerial}-facebook`}
              serial={selectedSerial}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Chọn một thiết bị để bắt đầu.
        </div>
      )}

      <Card className="gap-3 py-4">
        <CardHeader className="flex-row items-center justify-between px-4 py-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="size-4 text-primary" />
            Sự kiện realtime
          </CardTitle>
          <Badge
            variant="outline"
            className={
              streamState === "connected"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            <Wifi className="size-3" />
            {streamState === "connected"
              ? "Đang nhận"
              : streamState === "connecting"
                ? "Đang kết nối"
                : "Đang kết nối lại"}
          </Badge>
        </CardHeader>
        <CardContent className="px-4">
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-slate-950 p-3 font-mono text-xs text-slate-200">
            {events.length === 0 ? (
              <p className="text-slate-500">Chưa nhận được sự kiện.</p>
            ) : (
              <div className="space-y-2">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-1 border-b border-slate-800 pb-2 sm:grid-cols-[7rem_8rem_minmax(0,1fr)]"
                  >
                    <span className="text-slate-500">
                      {new Date(event.receivedAt).toLocaleTimeString("vi-VN")}
                    </span>
                    <span className="text-sky-400">{event.type}</span>
                    <span className="break-all">{eventText(event.data)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
