"use client";

import { useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ZaloBotConfig, ZaloBotConfigUpdate, ZaloBotReadiness, ZaloBotScopeMode } from "@/lib/zaloBotClient";
import ZaloBotScopePeople from "./ZaloBotScopePeople";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountLabel: string;
  config: ZaloBotConfig | null;
  loading: boolean;
  loadError: string | null;
  forbidden: boolean;
  onReload: () => void;
  onSave: (body: ZaloBotConfigUpdate) => Promise<{ ok: true } | { ok: false; error: string }>;
};

type FormState = {
  is_enabled: boolean;
  dry_run: boolean;
  chatwoot_account_id: string;
  chatwoot_inbox_id: string;
  auto_pause_on_staff_reply: boolean;
  pause_minutes: string;
  chatwoot_sync: boolean;
  scope_mode: ZaloBotScopeMode;
  batch_wait_seconds: string;
};

const BATCH_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Tắt" },
  { value: 5, label: "5 giây" },
  { value: 10, label: "10 giây" },
  { value: 20, label: "20 giây" },
  { value: 30, label: "30 giây" },
];

const SCOPE_OPTIONS: { value: ZaloBotScopeMode; title: string; hint: string }[] = [
  { value: "all", title: "Tất cả mọi người", hint: "Bot trả lời mọi khách nhắn 1-1, trừ những người bạn tắt bot bên dưới." },
  { value: "selected", title: "Chỉ những người đã chọn", hint: "Bot chỉ trả lời những người bạn bật bot bên dưới. Người khác bot im lặng." },
];

const READINESS_ITEMS: { key: keyof ZaloBotReadiness; label: string; hint: string }[] = [
  { key: "zca_logged_in", label: "Tài khoản Zalo đã đăng nhập", hint: "Chưa đăng nhập Zalo hoặc hết phiên: bot không nhận/gửi được tin." },
  { key: "n8n_incoming_configured", label: "Đã cấu hình n8n nhận tin", hint: "Thiếu địa chỉ webhook n8n nên tin khách chưa được chuyển cho bot." },
  { key: "shared_secret_configured", label: "Đã cấu hình khoá bí mật dùng chung", hint: "Thiếu shared secret giữa hệ thống và n8n/Chatwoot." },
  { key: "chatwoot_sync_configured", label: "Đã cấu hình đồng bộ Chatwoot", hint: "Chỉ cần khi bật “Đồng bộ trạng thái sang Chatwoot”." },
  { key: "bridge_enabled", label: "Cầu nối bot đang bật trên máy chủ", hint: "Tính năng bot đang bị tắt ở phía máy chủ, liên hệ quản trị viên." },
  { key: "config_complete", label: "Cấu hình tài khoản đầy đủ", hint: "Cần điền Chatwoot account ID và inbox ID." },
];

function toForm(c: ZaloBotConfig | null): FormState {
  return {
    is_enabled: c?.is_enabled ?? false,
    dry_run: c?.dry_run ?? true,
    chatwoot_account_id: c?.chatwoot_account_id != null ? String(c.chatwoot_account_id) : "",
    chatwoot_inbox_id: c?.chatwoot_inbox_id != null ? String(c.chatwoot_inbox_id) : "",
    auto_pause_on_staff_reply: c?.auto_pause_on_staff_reply ?? true,
    pause_minutes: String(c?.pause_minutes ?? 30),
    chatwoot_sync: c?.chatwoot_sync ?? false,
    scope_mode: c?.scope_mode ?? "all",
    batch_wait_seconds: String(c?.batch_wait_seconds ?? 10),
  };
}

function parseId(v: string): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export default function ZaloBotSettingsDrawer({
  open,
  onOpenChange,
  accountId,
  accountLabel,
  config,
  loading,
  loadError,
  forbidden,
  onReload,
  onSave,
}: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(config));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  // Mỗi lần mở (hoặc cấu hình được tải lại) nạp lại form từ cấu hình hiện tại.
  // Điều chỉnh state ngay lúc render (mẫu "derive state from props") thay vì setState trong effect.
  const [synced, setSynced] = useState<{ open: boolean; config: ZaloBotConfig | null }>({ open: false, config: null });
  if (open !== synced.open || (open && config !== synced.config)) {
    setSynced({ open, config });
    if (open) {
      setForm(toForm(config));
      setSaveError(null);
    }
  }

  const readOnly = forbidden;
  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(config)), [form, config]);
  const goingLive = form.is_enabled && !form.dry_run && !(config?.is_enabled && !config.dry_run);

  const validate = (): string | null => {
    const cwAccount = parseId(form.chatwoot_account_id);
    const cwInbox = parseId(form.chatwoot_inbox_id);
    if (form.chatwoot_account_id.trim() && cwAccount == null) return "Chatwoot account ID phải là số nguyên dương.";
    if (form.chatwoot_inbox_id.trim() && cwInbox == null) return "Chatwoot inbox ID phải là số nguyên dương.";
    if (form.is_enabled && (cwAccount == null || cwInbox == null)) return "Cần nhập Chatwoot account ID và inbox ID để bật bot.";
    const wait = Number(form.batch_wait_seconds);
    if (form.batch_wait_seconds.trim() === "" || !Number.isInteger(wait) || wait < 0 || wait > 120) {
      return "Thời gian chờ gom tin phải là số nguyên từ 0 đến 120 giây (0 = tắt).";
    }
    const mins = Number(form.pause_minutes);
    if (form.pause_minutes.trim() === "" || !Number.isInteger(mins) || mins < 0 || mins > 1440) {
      return "Số phút tạm dừng phải là số nguyên từ 0 đến 1440.";
    }
    return null;
  };

  const doSave = async () => {
    setConfirmLive(false);
    setSaving(true);
    setSaveError(null);
    const res = await onSave({
      is_enabled: form.is_enabled,
      dry_run: form.dry_run,
      chatwoot_account_id: parseId(form.chatwoot_account_id),
      chatwoot_inbox_id: parseId(form.chatwoot_inbox_id),
      auto_pause_on_staff_reply: form.auto_pause_on_staff_reply,
      pause_minutes: Number(form.pause_minutes),
      chatwoot_sync: form.chatwoot_sync,
      scope_mode: form.scope_mode,
      batch_wait_seconds: Number(form.batch_wait_seconds),
    });
    setSaving(false);
    if (res.ok) toast.success("Đã lưu cài đặt Bot AI");
    else setSaveError(res.error);
  };

  const handleSave = () => {
    const err = validate();
    if (err) {
      setSaveError(err);
      return;
    }
    if (goingLive) setConfirmLive(true);
    else void doSave();
  };

  const readiness = config?.readiness;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="z-[100001] w-full overflow-y-auto sm:max-w-[28rem] border-border" overlayClassName="z-[100000]">
          <SheetHeader>
            <SheetTitle>Cài đặt Bot AI</SheetTitle>
            <SheetDescription className="truncate">Tài khoản Zalo: {accountLabel || "—"}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 px-4 pb-4">
            {forbidden && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Bạn không có quyền chỉnh sửa Bot AI của tài khoản này. Đang ở chế độ chỉ xem.
              </div>
            )}
            {loadError && !config && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                <span>{loadError}</span>
                {!forbidden && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReload}>
                    Thử lại
                  </Button>
                )}
              </div>
            )}

            {loading && !config ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang tải cấu hình...
              </div>
            ) : (
              config && (
                <>
                  <section className="space-y-4">
                    <SwitchRow
                      id="bot-enabled"
                      label="Bật bot"
                      description="Bot AI tự trả lời khách nhắn 1-1 cho tài khoản này."
                      checked={form.is_enabled}
                      disabled={readOnly || saving}
                      onChange={(v) => patch({ is_enabled: v })}
                    />
                    <SwitchRow
                      id="bot-dry-run"
                      label="Chạy thử (không gửi tin thật)"
                      description="Bot soạn câu trả lời và ghi nhật ký nhưng không nhắn cho khách."
                      checked={form.dry_run}
                      disabled={readOnly || saving}
                      onChange={(v) => patch({ dry_run: v })}
                    />
                    {form.is_enabled && !form.dry_run && (
                      <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                        Chế độ chạy thật: bot sẽ nhắn tin thật cho khách.
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">Phạm vi trả lời</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Bot được phép trả lời những ai (chỉ chat 1-1).</p>
                    </div>
                    <div role="radiogroup" aria-label="Phạm vi trả lời" className="grid gap-2">
                      {SCOPE_OPTIONS.map((opt) => {
                        const active = form.scope_mode === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={readOnly || saving}
                            onClick={() => patch({ scope_mode: opt.value })}
                            className={cn(
                              "flex items-start gap-2.5 rounded-lg border p-3 text-left transition disabled:opacity-60 border-border",
                              active ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50",
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border",
                                active ? "border-primary" : "border-muted-foreground/40",
                              )}
                            >
                              {active && <span className="size-2 rounded-full bg-primary" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{opt.title}</span>
                              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {form.scope_mode === "selected" && (config?.scope?.on_count ?? 0) === 0 && (
                      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        Chưa chọn người nào nên bot sẽ không trả lời ai. Hãy tick người bên dưới rồi bấm “Bật bot”.
                      </p>
                    )}
                    <ZaloBotScopePeople
                      accountId={accountId}
                      scopeMode={form.scope_mode}
                      summary={config?.scope}
                      readOnly={readOnly}
                      onChanged={onReload}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Bật/tắt theo người có hiệu lực ngay. Riêng chế độ phạm vi cần bấm “Lưu”. Cũng có thể bật/tắt từng người ngay trong khung chat.
                    </p>
                  </section>

                  <section className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="bot-cw-account" className="text-xs">
                        Chatwoot account ID{form.is_enabled && <span className="text-red-600"> *</span>}
                      </Label>
                      <Input
                        id="bot-cw-account"
                        inputMode="numeric"
                        value={form.chatwoot_account_id}
                        disabled={readOnly || saving}
                        onChange={(e) => patch({ chatwoot_account_id: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bot-cw-inbox" className="text-xs">
                        Chatwoot inbox ID{form.is_enabled && <span className="text-red-600"> *</span>}
                      </Label>
                      <Input
                        id="bot-cw-inbox"
                        inputMode="numeric"
                        value={form.chatwoot_inbox_id}
                        disabled={readOnly || saving}
                        onChange={(e) => patch({ chatwoot_inbox_id: e.target.value })}
                      />
                    </div>
                  </section>

                  <section className="space-y-2.5">
                    <div>
                      <h3 className="text-sm font-semibold">Gom tin nhắn liên tiếp</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Khách hay nhắn nhiều tin ngắn liền nhau. Bot chờ khách im lặng đủ số giây dưới đây rồi gộp thành một câu hỏi và trả lời một lần,
                        thay vì trả lời từng tin. Bot sẽ trả lời chậm hơn đúng bằng thời gian chờ này (0 = tắt, trả lời từng tin).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {BATCH_PRESETS.map((preset) => {
                        const active = form.batch_wait_seconds.trim() === String(preset.value);
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            disabled={readOnly || saving}
                            onClick={() => patch({ batch_wait_seconds: String(preset.value) })}
                            className={cn(
                              "h-7 rounded-full border px-2.5 text-xs font-medium transition disabled:opacity-60 border-border",
                              active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/60",
                            )}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                      <span className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
                        hoặc
                        <Input
                          id="bot-batch-wait"
                          type="number"
                          min={0}
                          max={120}
                          className="h-7 w-16 px-2 text-xs"
                          value={form.batch_wait_seconds}
                          disabled={readOnly || saving}
                          onChange={(e) => patch({ batch_wait_seconds: e.target.value })}
                        />
                        giây
                      </span>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <SwitchRow
                      id="bot-auto-pause"
                      label="Tự tạm dừng bot khi nhân viên nhắn tay"
                      checked={form.auto_pause_on_staff_reply}
                      disabled={readOnly || saving}
                      onChange={(v) => patch({ auto_pause_on_staff_reply: v })}
                    />
                    {form.auto_pause_on_staff_reply && (
                      <div className="space-y-1.5">
                        <Label htmlFor="bot-pause-min" className="text-xs">
                          Số phút tạm dừng (0 = đến khi bấm bật lại bot)
                        </Label>
                        <Input
                          id="bot-pause-min"
                          type="number"
                          min={0}
                          max={1440}
                          className="w-32"
                          value={form.pause_minutes}
                          disabled={readOnly || saving}
                          onChange={(e) => patch({ pause_minutes: e.target.value })}
                        />
                      </div>
                    )}
                    <SwitchRow
                      id="bot-cw-sync"
                      label="Đồng bộ trạng thái sang Chatwoot"
                      description="Cập nhật trạng thái hội thoại bên Chatwoot khi nhân viên tiếp quản/bật lại bot."
                      checked={form.chatwoot_sync}
                      disabled={readOnly || saving}
                      onChange={(v) => patch({ chatwoot_sync: v })}
                    />
                  </section>

                  {readiness && (
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold">Điều kiện sẵn sàng</h3>
                      <ul className="space-y-2">
                        {READINESS_ITEMS.map((item) => {
                          const ok = readiness[item.key];
                          return (
                            <li key={item.key} className="flex items-start gap-2 text-xs">
                              <span
                                className={cn(
                                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                                  ok
                                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                                    : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                                )}
                              >
                                {ok ? <Check className="size-3" /> : <X className="size-3" />}
                              </span>
                              <span className="min-w-0">
                                <span className="font-medium">{item.label}</span>
                                {!ok && <span className="block text-muted-foreground">{item.hint}</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  )}

                  <a
                    href="https://chat.markeeai.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" /> Mở đào tạo bot (Markee Chat)
                  </a>

                  {saveError && (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                      {saveError}
                    </p>
                  )}
                </>
              )
            )}
          </div>

          <div className="flex justify-end gap-2 border-t px-4 py-3 border-border">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Đóng
            </Button>
            <Button onClick={handleSave} disabled={readOnly || saving || !config || !dirty}>
              {saving && <Loader2 className="animate-spin" />}
              Lưu
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmLive} onOpenChange={setConfirmLive}>
        <DialogContent className="z-[100003] sm:max-w-[32rem]" overlayClassName="z-[100002]">
          <DialogHeader>
            <DialogTitle>Chuyển sang chạy thật?</DialogTitle>
            <DialogDescription>
              Bot sẽ nhắn tin thật cho khách của tài khoản {accountLabel || "này"}. Hãy chắc chắn bot đã được đào tạo và đã chạy thử ổn.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLive(false)}>
              Quay lại
            </Button>
            <Button variant="destructive" onClick={() => void doSave()}>
              Xác nhận chạy thật
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
