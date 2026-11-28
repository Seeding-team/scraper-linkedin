"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Cpu,
  Edit3,
  Eye,
  FlaskConical,
  History,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { slaAlertsService } from "@/services/slaAlertsService";
import { useZaloAccountOptions } from "@/components/all-platform/zalo/centralized-shared/useZaloAccountOptions";
import {
  alert as uiAlert,
  btn,
  btnSize,
  card,
  input as uiInput,
  label as uiLabel,
  modal as uiModal,
  pill,
  select as uiSelect,
  table,
  textarea as uiTextarea,
} from "@/components/all-platform/zalo/centralized-shared/zaloUi";
import {
  DEFAULT_NEW_MESSAGE_TEMPLATE,
  DEFAULT_SLA_BREACH_TEMPLATE,
  formatDateTimeVn,
  getChannelMeta,
  PRIMARY_SLA_CHANNELS,
  renderAlertTemplatePreview,
  type AlertForwardConfig,
  type AlertForwardConfigCreatePayload,
  type AlertForwardLog,
  type AlertForwardMode,
  type AlertForwardTestResult,
  type JsEngineStatus,
  type ZaloGroupOption,
} from "@/types/sla-alerts";

export interface ZaloGroupAlertConfigTabProps {
  refreshSignal: number;
  onEngineStatus?: (status: JsEngineStatus | null) => void;
}

const TEMPLATE_VARIABLES = [
  "{{channel}}",
  "{{customer_name}}",
  "{{customer_phone}}",
  "{{account_name}}",
  "{{content}}",
  "{{extra_count_text}}",
  "{{time_vn}}",
  "{{sla_minutes}}",
  "{{deadline_vn}}",
  "{{wait_text}}",
  "{{staff_name}}",
  "{{open_url}}",
];

const PREVIEW_SAMPLE: Record<string, string> = {
  channel: "ZALO",
  customer_name: "Nguyễn Minh Anh",
  customer_phone: "0902 355 083",
  account_name: "Zalo Sale 01 · Huyền",
  content: "Shop ơi tư vấn giúp mình gói triển khai doanh nghiệp nhé!",
  extra_count_text: " (+2 tin)",
  time_vn: "09:42",
  sla_minutes: "5",
  deadline_vn: "09:47",
  wait_text: "6p 15s",
  staff_name: "Trần Thu Hà",
  open_url: "https://app.markeeai.com/all-platform/zalo-inbox",
};

const ALERT_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  new_message: { label: "Tin nhắn mới", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  sla_warning: { label: "Sắp quá hạn", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  sla_breach: { label: "Quá hạn SLA", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  test: { label: "Tin Test", cls: "bg-violet-50 text-violet-700 border-violet-200" },
};

const LOG_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  sent: { label: "Đã gửi", cls: pill.success },
  dry_run: { label: "Dry-run", cls: pill.info },
  failed: { label: "Thất bại", cls: pill.danger },
  skipped: { label: "Đã bỏ qua", cls: pill.neutral },
  rate_limited: { label: "Giới hạn tốc độ", cls: pill.warning },
};

interface ConfigFormState {
  name: string;
  is_enabled: boolean;
  dry_run: boolean;
  notifier_zalo_account_id: string;
  notifier_zalo_account_name: string;
  target_zalo_group_id: string;
  target_zalo_group_name: string;
  channels: string[];
  include_group_chats: boolean;
  alert_mode: AlertForwardMode;
  debounce_seconds: number;
  cooldown_minutes: number;
  notify_new_message: boolean;
  notify_sla_warning: boolean;
  notify_sla_breach: boolean;
  mention_all_on_breach: boolean;
  new_message_template: string;
  sla_breach_template: string;
}

function createInitialForm(
  editing: AlertForwardConfig | null,
  defaultAccountId: string,
  defaultAccountName: string,
): ConfigFormState {
  if (editing) {
    return {
      name: editing.name || "Thông báo tin mới & SLA chung",
      is_enabled: editing.is_enabled ?? true,
      dry_run: Boolean(editing.dry_run),
      notifier_zalo_account_id: editing.notifier_zalo_account_id || defaultAccountId,
      notifier_zalo_account_name: editing.notifier_zalo_account_name || defaultAccountName,
      target_zalo_group_id: editing.target_zalo_group_id || "",
      target_zalo_group_name: editing.target_zalo_group_name || "",
      channels:
        Array.isArray(editing.channels) && editing.channels.length > 0
          ? editing.channels
          : ["zalo"],
      include_group_chats: Boolean(editing.include_group_chats),
      alert_mode: editing.alert_mode || "new_turn_only",
      debounce_seconds: editing.debounce_seconds ?? 8,
      cooldown_minutes: editing.cooldown_minutes ?? 15,
      notify_new_message: editing.notify_new_message ?? true,
      notify_sla_warning: Boolean(editing.notify_sla_warning),
      notify_sla_breach: editing.notify_sla_breach ?? true,
      mention_all_on_breach: Boolean(editing.mention_all_on_breach),
      new_message_template: editing.new_message_template || DEFAULT_NEW_MESSAGE_TEMPLATE,
      sla_breach_template: editing.sla_breach_template || DEFAULT_SLA_BREACH_TEMPLATE,
    };
  }
  return {
    name: "Thông báo tin mới & SLA nhóm CSKH",
    is_enabled: true,
    dry_run: false,
    notifier_zalo_account_id: defaultAccountId,
    notifier_zalo_account_name: defaultAccountName,
    target_zalo_group_id: "",
    target_zalo_group_name: "",
    channels: ["zalo", "messenger", "telegram", "whatsapp"],
    include_group_chats: false,
    alert_mode: "new_turn_only",
    debounce_seconds: 8,
    cooldown_minutes: 15,
    notify_new_message: true,
    notify_sla_warning: true,
    notify_sla_breach: true,
    mention_all_on_breach: false,
    new_message_template: DEFAULT_NEW_MESSAGE_TEMPLATE,
    sla_breach_template: DEFAULT_SLA_BREACH_TEMPLATE,
  };
}

export function ZaloGroupAlertConfigTab({
  refreshSignal,
  onEngineStatus,
}: ZaloGroupAlertConfigTabProps) {
  const { user } = useAppAuth();
  const userEmail = user?.email ?? null;
  const canManage = user?.role === "admin" || user?.role === "leader";
  const { accounts: zaloAccounts, loading: loadingZaloAccounts } = useZaloAccountOptions();

  const [configs, setConfigs] = useState<AlertForwardConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [logs, setLogs] = useState<AlertForwardLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [logFilterConfigId, setLogFilterConfigId] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [lastTestOutput, setLastTestOutput] = useState<{
    configName: string;
    result: AlertForwardTestResult;
  } | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AlertForwardConfig | null>(null);
  const [form, setForm] = useState<ConfigFormState>(() => createInitialForm(null, "", ""));
  const [saving, setSaving] = useState(false);
  const [templateTab, setTemplateTab] = useState<"new_message" | "sla_breach">("new_message");

  // Group selector state inside modal
  const [zaloGroups, setZaloGroups] = useState<ZaloGroupOption[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [manualGroupMode, setManualGroupMode] = useState(false);

  const loadConfigs = useCallback(async () => {
    setLoadingConfigs(true);
    setError(null);
    try {
      const res = await slaAlertsService.listForwardConfigs(userEmail);
      if (res.success && res.data) {
        setConfigs(Array.isArray(res.data.items) ? res.data.items : []);
        if (res.data.engine_status !== undefined) {
          onEngineStatus?.(res.data.engine_status ?? null);
        }
      } else {
        setError(res.message || "Không tải được danh sách cấu hình thông báo nhóm Zalo.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải cấu hình thông báo nhóm.");
    } finally {
      setLoadingConfigs(false);
    }
  }, [userEmail, onEngineStatus]);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await slaAlertsService.listForwardLogs(
        { config_id: logFilterConfigId || undefined, limit: 50 },
        userEmail,
      );
      if (res.success && res.data) {
        setLogs(Array.isArray(res.data.items) ? res.data.items : []);
      }
    } catch {
      // Fail-soft
    } finally {
      setLoadingLogs(false);
    }
  }, [logFilterConfigId, userEmail]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      void loadConfigs();
      void loadLogs();
    });
    return () => {
      alive = false;
    };
  }, [loadConfigs, loadLogs, refreshSignal]);

  // Load Zalo groups when notifier_zalo_account_id changes inside modal
  useEffect(() => {
    if (!modalOpen || !form.notifier_zalo_account_id) {
      return;
    }
    let alive = true;
    void Promise.resolve()
      .then(() => {
        if (alive) setLoadingGroups(true);
        return slaAlertsService.listZaloGroupsForAccount(
          form.notifier_zalo_account_id,
          userEmail,
        );
      })
      .then((res) => {
        if (!alive) return;
        if (res.success && res.data && Array.isArray(res.data.groups)) {
          setZaloGroups(res.data.groups);
        } else {
          setZaloGroups([]);
        }
      })
      .catch(() => {
        if (alive) setZaloGroups([]);
      })
      .finally(() => {
        if (alive) setLoadingGroups(false);
      });
    return () => {
      alive = false;
    };
  }, [modalOpen, form.notifier_zalo_account_id, userEmail]);

  const filteredGroups = useMemo(() => {
    const activeGroups = modalOpen && form.notifier_zalo_account_id ? zaloGroups : [];
    const q = groupSearch.trim().toLowerCase();
    if (!q) return activeGroups;
    return activeGroups.filter(
      (g) =>
        (g.name || "").toLowerCase().includes(q) ||
        (g.group_id || "").toLowerCase().includes(q),
    );
  }, [modalOpen, form.notifier_zalo_account_id, zaloGroups, groupSearch]);

  const openCreateModal = () => {
    const defaultAcc = zaloAccounts[0];
    setEditingConfig(null);
    setForm(
      createInitialForm(
        null,
        defaultAcc?.account_id || "",
        defaultAcc?.label || defaultAcc?.account_id || "",
      ),
    );
    setGroupSearch("");
    setManualGroupMode(false);
    setTemplateTab("new_message");
    setModalOpen(true);
  };

  const openEditModal = (cfg: AlertForwardConfig) => {
    setEditingConfig(cfg);
    setForm(
      createInitialForm(
        cfg,
        cfg.notifier_zalo_account_id,
        cfg.notifier_zalo_account_name || "",
      ),
    );
    setGroupSearch("");
    setManualGroupMode(false);
    setTemplateTab("new_message");
    setModalOpen(true);
  };

  const handleToggleEnabled = async (cfg: AlertForwardConfig) => {
    if (!canManage) return;
    const nextVal = !cfg.is_enabled;
    setConfigs((prev) =>
      prev.map((item) => (item.id === cfg.id ? { ...item, is_enabled: nextVal } : item)),
    );
    try {
      const res = await slaAlertsService.updateForwardConfig(
        cfg.id,
        { is_enabled: nextVal },
        user?.email,
      );
      if (!res.success) {
        throw new Error(res.message || "Không đổi được trạng thái.");
      }
      setNotice(`Đã ${nextVal ? "bật" : "tắt"} cấu hình "${cfg.name}".`);
    } catch (e) {
      setConfigs((prev) =>
        prev.map((item) => (item.id === cfg.id ? { ...item, is_enabled: cfg.is_enabled } : item)),
      );
      setError(e instanceof Error ? e.message : "Không thể cập nhật trạng thái cấu hình.");
    }
  };

  const handleDeleteConfig = async (cfg: AlertForwardConfig) => {
    if (!canManage) return;
    if (!window.confirm(`Xóa cấu hình thông báo "${cfg.name}"? Hành động không thể hoàn tác.`)) {
      return;
    }
    setError(null);
    try {
      const res = await slaAlertsService.deleteForwardConfig(cfg.id, user?.email);
      if (!res.success) {
        throw new Error(res.message || "Xóa cấu hình thất bại.");
      }
      setConfigs((prev) => prev.filter((item) => item.id !== cfg.id));
      setNotice(`Đã xóa cấu hình "${cfg.name}".`);
      void loadLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi xóa cấu hình.");
    }
  };

  const handleTestConfig = async (cfg: AlertForwardConfig) => {
    setTestingId(cfg.id);
    setError(null);
    setNotice(null);
    setLastTestOutput(null);
    try {
      const res = await slaAlertsService.testForwardConfig(cfg.id, user?.email);
      if (res.success && res.data) {
        setLastTestOutput({ configName: cfg.name, result: res.data });
        if (res.data.error) {
          setError(`Gửi test "${cfg.name}" gặp lỗi: ${res.data.error}`);
        } else if (res.data.dry_run) {
          setNotice(
            `[Dry-run] Đã mô phỏng gửi test qua ${res.data.via || "js_engine"} (${res.data.latency_ms ?? 0}ms).`,
          );
        } else if (res.data.sent) {
          setNotice(
            `Đã gửi tin test thành công vào nhóm "${cfg.target_zalo_group_name || cfg.target_zalo_group_id}" qua ${res.data.via || "js_engine"} (${res.data.latency_ms ?? 0}ms)!`,
          );
        }
        void loadLogs();
      } else {
        setError(res.message || "Không gửi được tin test.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi gửi tin test.");
    } finally {
      setTestingId(null);
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!form.notifier_zalo_account_id.trim()) {
      setError("Vui lòng chọn Tài khoản Zalo gửi thông báo.");
      return;
    }
    if (!form.target_zalo_group_id.trim()) {
      setError("Vui lòng chọn hoặc nhập ID của Zalo Group đích chung.");
      return;
    }
    if (form.channels.length === 0) {
      setError("Vui lòng chọn ít nhất 1 kênh nguồn để theo dõi.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const matchedAcc = zaloAccounts.find(
      (a) => a.account_id === form.notifier_zalo_account_id,
    );

    const payload: AlertForwardConfigCreatePayload = {
      name: form.name.trim() || "Thông báo tin mới & SLA chung",
      is_enabled: form.is_enabled,
      dry_run: form.dry_run,
      notifier_zalo_account_id: form.notifier_zalo_account_id.trim(),
      notifier_zalo_account_name:
        matchedAcc?.label || form.notifier_zalo_account_name || null,
      target_zalo_group_id: form.target_zalo_group_id.trim(),
      target_zalo_group_name: form.target_zalo_group_name.trim() || null,
      channels: form.channels,
      include_group_chats: form.include_group_chats,
      alert_mode: form.alert_mode,
      debounce_seconds: Math.min(60, Math.max(0, Number(form.debounce_seconds) || 0)),
      cooldown_minutes: Math.min(1440, Math.max(0, Number(form.cooldown_minutes) || 0)),
      notify_new_message: form.notify_new_message,
      notify_sla_warning: form.notify_sla_warning,
      notify_sla_breach: form.notify_sla_breach,
      mention_all_on_breach: form.mention_all_on_breach,
      new_message_template: form.new_message_template.trim() || null,
      sla_breach_template: form.sla_breach_template.trim() || null,
    };

    try {
      const res = editingConfig
        ? await slaAlertsService.updateForwardConfig(editingConfig.id, payload, user?.email)
        : await slaAlertsService.createForwardConfig(payload, user?.email);

      if (!res.success) {
        throw new Error(res.message || "Không thể lưu cấu hình.");
      }

      setModalOpen(false);
      setNotice(
        editingConfig
          ? `Đã cập nhật cấu hình "${payload.name}".`
          : `Đã tạo cấu hình thông báo "${payload.name}".`,
      );
      await loadConfigs();
      void loadLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu cấu hình thông báo.");
    } finally {
      setSaving(false);
    }
  };

  const toggleFormChannel = (chId: string) => {
    setForm((prev) => {
      const has = prev.channels.includes(chId);
      const next = has ? prev.channels.filter((c) => c !== chId) : [...prev.channels, chId];
      return { ...prev, channels: next };
    });
  };

  const insertVariable = (token: string) => {
    setForm((prev) => {
      if (templateTab === "new_message") {
        return { ...prev, new_message_template: `${prev.new_message_template}${token}` };
      }
      return { ...prev, sla_breach_template: `${prev.sla_breach_template}${token}` };
    });
  };

  const livePreviewText = useMemo(() => {
    if (templateTab === "new_message") {
      return renderAlertTemplatePreview(
        form.new_message_template,
        DEFAULT_NEW_MESSAGE_TEMPLATE,
        PREVIEW_SAMPLE,
      );
    }
    const breachRendered = renderAlertTemplatePreview(
      form.sla_breach_template,
      DEFAULT_SLA_BREACH_TEMPLATE,
      PREVIEW_SAMPLE,
    );
    return form.mention_all_on_breach ? `@All\n${breachRendered}` : breachRendered;
  }, [templateTab, form.new_message_template, form.sla_breach_template, form.mention_all_on_breach]);

  return (
    <div className="space-y-6">
      {notice && (
        <div className={uiAlert.success}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}
      {error && (
        <div className={uiAlert.error}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Test Output Preview Banner */}
      {lastTestOutput && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-violet-900">
              <FlaskConical className="h-4 w-4 text-violet-600" />
              Kết quả gửi test · {lastTestOutput.configName}
              {lastTestOutput.result.dry_run && (
                <span className="rounded-full bg-violet-200 px-2 py-0.5 text-[10px] uppercase">
                  Dry-run
                </span>
              )}
              {lastTestOutput.result.via && (
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-600">
                  {lastTestOutput.result.via} · {lastTestOutput.result.latency_ms ?? 0}ms
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLastTestOutput(null)}
              className="text-xs font-semibold text-violet-700 hover:underline cursor-pointer"
            >
              Đóng
            </button>
          </div>
          {lastTestOutput.result.rendered_text && (
            <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-violet-200/70 bg-white p-3 font-sans text-xs leading-relaxed text-slate-800">
              {lastTestOutput.result.rendered_text}
            </pre>
          )}
        </div>
      )}

      {/* ── Forward Configs Section ────────────────────────────────────────── */}
      <section className={`${card} overflow-hidden shadow-2xs`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
              <Bell className="h-4.5 w-4.5 text-brand" />
              Cấu hình bắn thông báo về Zalo Group chung
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Tự động gom tin nhắn mới (Debounce) &amp; báo động sắp hạn / quá hạn SLA vào nhóm Zalo CSKH qua JS Engine tốc độ cao.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className={`${btn.primary} ${btnSize.sm} cursor-pointer`}
            >
              <Plus className="h-4 w-4" />
              Thêm cấu hình nhóm
            </button>
          )}
        </div>

        {loadingConfigs ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            Đang tải danh sách cấu hình...
          </div>
        ) : configs.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Users className="mx-auto h-10 w-10 text-slate-300" />
            <h4 className="mt-3 text-sm font-bold text-slate-800">
              Chưa có cấu hình thông báo nhóm Zalo nào
            </h4>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              Tạo cấu hình đầu tiên để mỗi khi có khách nhắn từ Zalo/Messenger/Telegram/WhatsApp hoặc khi sắp quá hạn SLA, bot sẽ bắn thông báo ngay vào nhóm Zalo chung của team.
            </p>
            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className={`mt-4 ${btn.primary} ${btnSize.sm} cursor-pointer`}
              >
                <Plus className="h-4 w-4" />
                Tạo cấu hình đầu tiên
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {configs.map((cfg) => (
              <div
                key={cfg.id}
                className="flex flex-col gap-3 px-5 py-4 transition hover:bg-slate-50/70 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {/* Quick Toggle */}
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => void handleToggleEnabled(cfg)}
                    title={cfg.is_enabled ? "Đang bật — bấm để tắt" : "Đang tắt — bấm để bật"}
                    className={cn(
                      "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition cursor-pointer disabled:opacity-50",
                      cfg.is_enabled ? "bg-brand" : "bg-slate-300",
                    )}
                    aria-pressed={cfg.is_enabled}
                  >
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full bg-white shadow transition",
                        cfg.is_enabled ? "translate-x-4" : "translate-x-0.5",
                      )}
                    />
                  </button>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{cfg.name}</span>
                      {cfg.dry_run && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10.5px] font-bold text-violet-700">
                          <FlaskConical className="h-3 w-3" />
                          Dry-run
                        </span>
                      )}
                      {cfg.mention_all_on_breach && (
                        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10.5px] font-bold text-rose-700">
                          @All khi quá hạn
                        </span>
                      )}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">
                        {cfg.alert_mode === "every_batch"
                          ? "Mọi đợt tin (Debounce)"
                          : "Chỉ lượt hỏi mới (Chống spam)"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>
                        TK gửi:{" "}
                        <strong className="text-slate-800">
                          {cfg.notifier_zalo_account_name || cfg.notifier_zalo_account_id}
                        </strong>
                      </span>
                      <span>
                        → Nhóm đích:{" "}
                        <strong className="text-[#0068FF]">
                          {cfg.target_zalo_group_name || cfg.target_zalo_group_id}
                        </strong>
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        Debounce {cfg.debounce_seconds}s · Cooldown {cfg.cooldown_minutes}p
                      </span>
                    </div>

                    {/* Channels + Trigger Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {(cfg.channels || []).map((ch) => {
                        const meta = getChannelMeta(ch);
                        return (
                          <span
                            key={ch}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold",
                              meta.badgeClass,
                            )}
                          >
                            {meta.label}
                          </span>
                        );
                      })}
                      <span className="mx-1 text-slate-300">|</span>
                      {cfg.notify_new_message && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-700">
                          ✓ Tin mới
                        </span>
                      )}
                      {cfg.notify_sla_warning && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
                          ✓ Sắp hạn
                        </span>
                      )}
                      {cfg.notify_sla_breach && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700">
                          ✓ Quá hạn SLA
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                {canManage && (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 lg:pl-0">
                    <button
                      type="button"
                      disabled={testingId === cfg.id}
                      onClick={() => void handleTestConfig(cfg)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#10a39c]/40 bg-[#10a39c]/10 px-3 py-1.5 text-xs font-bold text-[#0d7f79] transition hover:bg-[#10a39c] hover:text-white cursor-pointer disabled:opacity-50"
                    >
                      {testingId === cfg.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Gửi tin test ngay
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(cfg)}
                      className={`${btn.outline} h-8 px-3 text-xs cursor-pointer`}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteConfig(cfg)}
                      className={`${btn.danger} h-8 px-3 text-xs cursor-pointer`}
                      title="Xóa cấu hình"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Realtime Delivery Logs ─────────────────────────────────────────── */}
      <section className={`${card} overflow-hidden shadow-2xs`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <History className="h-4 w-4 text-[#10a39c]" />
              Nhật ký gửi thông báo (Realtime Logs)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Theo dõi 50 lần bắn thông báo gần nhất, đường truyền JS Engine / Python Fallback và độ trễ (ms)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={logFilterConfigId}
              onChange={(e) => setLogFilterConfigId(e.target.value)}
              className={`${uiSelect} h-8 text-xs`}
              aria-label="Lọc nhật ký theo cấu hình"
            >
              <option value="">Tất cả cấu hình</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadLogs()}
              disabled={loadingLogs}
              className={`${btn.outline} h-8 px-3 text-xs cursor-pointer`}
            >
              {loadingLogs ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Tải lại log
            </button>
          </div>
        </div>

        {loadingLogs && logs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
            Đang tải nhật ký gửi thông báo...
          </div>
        ) : logs.length === 0 ? (
          <div className="px-6 py-12 text-center text-xs text-slate-500">
            Chưa có nhật ký gửi thông báo nào. Hãy bấm <strong>&ldquo;Gửi tin test ngay&rdquo;</strong> trên một cấu hình để kiểm thử!
          </div>
        ) : (
          <div className={table.wrapper}>
            <table className={table.root}>
              <thead className="border-b border-slate-100 bg-slate-50/80">
                <tr>
                  <th className={`${table.head} pl-5`}>Thời gian</th>
                  <th className={table.head}>Loại alert</th>
                  <th className={table.head}>Kênh</th>
                  <th className={table.head}>Nhóm đích</th>
                  <th className={table.head}>Đường truyền</th>
                  <th className={`${table.head} text-right`}>Độ trễ</th>
                  <th className={table.head}>Trạng thái</th>
                  <th className={`${table.head} pr-5`}>Nội dung / Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const typeMeta = ALERT_TYPE_LABELS[log.alert_type] || {
                    label: log.alert_type,
                    cls: "bg-slate-100 text-slate-700 border-slate-200",
                  };
                  const statusMeta = LOG_STATUS_LABELS[log.status] || {
                    label: log.status,
                    cls: pill.neutral,
                  };
                  const chMeta = getChannelMeta(log.channel);
                  const isJs = (log.via || "js_engine") === "js_engine";

                  return (
                    <tr key={String(log.id)} className={table.row}>
                      <td className={`${table.cell} pl-5 whitespace-nowrap text-xs text-slate-600 tabular-nums`}>
                        {formatDateTimeVn(log.created_at)}
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`}>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold",
                            typeMeta.cls,
                          )}
                        >
                          {typeMeta.label}
                        </span>
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`}>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold",
                            chMeta.badgeClass,
                          )}
                        >
                          {chMeta.label}
                        </span>
                      </td>
                      <td
                        className={`${table.cell} max-w-[140px] truncate font-mono text-[11px] text-slate-600`}
                        title={log.target_zalo_group_id || ""}
                      >
                        {log.target_zalo_group_id || "—"}
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`}>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                            isJs
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700",
                          )}
                        >
                          <Cpu className="h-3 w-3" />
                          {isJs ? "js_engine" : log.via || "python_fallback"}
                        </span>
                      </td>
                      <td className={`${table.cell} whitespace-nowrap text-right text-xs font-semibold text-slate-700 tabular-nums`}>
                        {log.latency_ms != null ? `${log.latency_ms}ms` : "—"}
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`}>
                        <span className={statusMeta.cls}>{statusMeta.label}</span>
                      </td>
                      <td className={`${table.cell} max-w-[280px] pr-5 text-xs`}>
                        {log.rendered_text && (
                          <div
                            className="line-clamp-2 text-slate-700"
                            title={log.rendered_text}
                          >
                            {log.rendered_text}
                          </div>
                        )}
                        {log.error && (
                          <div
                            className="mt-0.5 truncate text-[11px] font-semibold text-rose-600"
                            title={log.error}
                          >
                            ⚠ {log.error}
                          </div>
                        )}
                        {!log.rendered_text && !log.error && (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Create / Edit Modal ────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          className={`${uiModal.overlay} flex items-center justify-center overflow-y-auto`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="forward-config-modal-title"
        >
          <form
            onSubmit={handleSaveModal}
            className={`${uiModal.panel} my-auto flex max-h-[92vh] max-w-4xl flex-col overflow-hidden`}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white">
                  <Bell className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h3 id="forward-config-modal-title" className="text-base font-bold text-slate-900">
                    {editingConfig ? "Chỉnh sửa cấu hình thông báo nhóm Zalo" : "Tạo cấu hình thông báo nhóm Zalo"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Đẩy tin nhắn mới &amp; cảnh báo quá hạn SLA về nhóm Zalo CSKH chung theo thời gian thực
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Row 1: Name + Notifier Zalo Account */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={uiLabel} htmlFor="cfg-name">
                    Tên cấu hình
                  </label>
                  <input
                    id="cfg-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="VD: Thông báo CSKH nhóm Sale tổng"
                    className={uiInput}
                  />
                </div>

                <div>
                  <label className={uiLabel} htmlFor="cfg-notifier-acc">
                    Tài khoản Zalo gửi thông báo
                  </label>
                  {loadingZaloAccounts ? (
                    <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                  ) : (
                    <select
                      id="cfg-notifier-acc"
                      required
                      value={form.notifier_zalo_account_id}
                      onChange={(e) => {
                        const accId = e.target.value;
                        const found = zaloAccounts.find((a) => a.account_id === accId);
                        setForm((prev) => ({
                          ...prev,
                          notifier_zalo_account_id: accId,
                          notifier_zalo_account_name: found?.label || "",
                          target_zalo_group_id:
                            prev.notifier_zalo_account_id === accId ? prev.target_zalo_group_id : "",
                          target_zalo_group_name:
                            prev.notifier_zalo_account_id === accId ? prev.target_zalo_group_name : "",
                        }));
                      }}
                      className={`${uiInput} cursor-pointer`}
                    >
                      <option value="">-- Chọn tài khoản Zalo đã đăng nhập --</option>
                      {zaloAccounts.map((acc) => (
                        <option key={acc.account_id} value={acc.account_id}>
                          {acc.label || acc.account_id}
                          {acc.phone ? ` · ${acc.phone}` : ""}
                        </option>
                      ))}
                      {form.notifier_zalo_account_id &&
                        !zaloAccounts.some((a) => a.account_id === form.notifier_zalo_account_id) && (
                          <option value={form.notifier_zalo_account_id}>
                            {form.notifier_zalo_account_name || form.notifier_zalo_account_id}
                          </option>
                        )}
                    </select>
                  )}
                </div>
              </div>

              {/* Row 2: Target Zalo Group Picker + Search + Manual ID fallback */}
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Zalo Group đích chung (Nhóm nhận thông báo)
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Chọn từ danh sách nhóm của tài khoản Zalo gửi, hoặc nhập trực tiếp Group ID.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManualGroupMode((v) => !v)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    {manualGroupMode ? "Chọn từ danh sách nhóm" : "Nhập tay Group ID"}
                  </button>
                </div>

                {form.target_zalo_group_id && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-[#0068FF]/25 bg-blue-50/70 px-3 py-2 text-xs">
                    <div className="min-w-0 truncate">
                      <span className="font-semibold text-slate-600">Đã chọn: </span>
                      <strong className="text-[#0068FF]">
                        {form.target_zalo_group_name || form.target_zalo_group_id}
                      </strong>
                      <span className="ml-2 font-mono text-[11px] text-slate-500">
                        ({form.target_zalo_group_id})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          target_zalo_group_id: "",
                          target_zalo_group_name: "",
                        }))
                      }
                      className="text-slate-400 hover:text-rose-600 cursor-pointer"
                      aria-label="Bỏ chọn nhóm"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {manualGroupMode ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Zalo Group ID *
                      </label>
                      <input
                        type="text"
                        required
                        value={form.target_zalo_group_id}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, target_zalo_group_id: e.target.value }))
                        }
                        placeholder="VD: 84291049102948102"
                        className={`${uiInput} font-mono text-xs`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        Tên gợi nhớ nhóm (tùy chọn)
                      </label>
                      <input
                        type="text"
                        value={form.target_zalo_group_name}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, target_zalo_group_name: e.target.value }))
                        }
                        placeholder="VD: Nhóm CSKH Markee"
                        className={`${uiInput} text-xs`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder="Tìm kiếm tên nhóm Zalo hoặc Group ID..."
                        className={`${uiInput} h-9 pl-8 text-xs`}
                      />
                    </div>

                    <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                      {!form.notifier_zalo_account_id ? (
                        <div className="p-4 text-center text-xs text-slate-400">
                          Hãy chọn tài khoản Zalo gửi ở trên để tải danh sách nhóm.
                        </div>
                      ) : loadingGroups ? (
                        <div className="flex items-center justify-center gap-2 p-4 text-xs text-slate-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                          Đang tải danh sách nhóm Zalo...
                        </div>
                      ) : filteredGroups.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500">
                          Không tìm thấy nhóm Zalo nào. Bấm <strong>&ldquo;Nhập tay Group ID&rdquo;</strong> ở góc trên nếu nhóm chưa được đồng bộ.
                        </div>
                      ) : (
                        filteredGroups.map((grp) => {
                          const selected = form.target_zalo_group_id === grp.group_id;
                          return (
                            <button
                              key={grp.group_id}
                              type="button"
                              onClick={() =>
                                setForm((prev) => ({
                                  ...prev,
                                  target_zalo_group_id: grp.group_id,
                                  target_zalo_group_name: grp.name,
                                }))
                              }
                              className={cn(
                                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition cursor-pointer",
                                selected
                                  ? "bg-brand-subtle/70 font-bold text-brand"
                                  : "hover:bg-slate-50 text-slate-800",
                              )}
                            >
                              <span className="truncate font-semibold">{grp.name || grp.group_id}</span>
                              <span className="shrink-0 font-mono text-[10.5px] text-slate-400">
                                {grp.group_id}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Row 3: Source Channels */}
              <div>
                <label className={uiLabel}>Kênh nguồn cần theo dõi</label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {PRIMARY_SLA_CHANNELS.map((ch) => {
                    const checked = form.channels.includes(ch.id);
                    return (
                      <label
                        key={ch.id}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition",
                          checked
                            ? "border-brand bg-brand-subtle text-brand shadow-2xs"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFormChannel(ch.id)}
                          className="h-3.5 w-3.5 accent-[#ba244a]"
                        />
                        <span>{ch.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Row 4: Alert Mode + Debounce + Cooldown */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-6">
                  <label className={uiLabel}>Chế độ báo tin mới</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, alert_mode: "new_turn_only" }))}
                      className={cn(
                        "rounded-xl border p-3 text-left transition cursor-pointer",
                        form.alert_mode === "new_turn_only"
                          ? "border-brand bg-brand-subtle/60"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                      )}
                    >
                      <div className="text-xs font-bold text-slate-900">
                        Chỉ lượt hỏi mới (Chống spam)
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Chỉ báo khi mở lượt mới hoặc hết cooldown
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, alert_mode: "every_batch" }))}
                      className={cn(
                        "rounded-xl border p-3 text-left transition cursor-pointer",
                        form.alert_mode === "every_batch"
                          ? "border-brand bg-brand-subtle/60"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                      )}
                    >
                      <div className="text-xs font-bold text-slate-900">
                        Mọi đợt tin sau Debounce
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Gom mỗi cụm tin khách gửi rồi báo ngay
                      </div>
                    </button>
                  </div>
                </div>

                <div className="md:col-span-3">
                  <label className={uiLabel} htmlFor="cfg-debounce">
                    Debounce gom tin (giây)
                  </label>
                  <input
                    id="cfg-debounce"
                    type="number"
                    min={0}
                    max={60}
                    value={form.debounce_seconds}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        debounce_seconds: Math.min(60, Math.max(0, Number(e.target.value) || 0)),
                      }))
                    }
                    className={`${uiInput} font-bold tabular-nums`}
                  />
                  <p className="mt-1 text-[10.5px] text-slate-500">Mặc định 8s (0–60s)</p>
                </div>

                <div className="md:col-span-3">
                  <label className={uiLabel} htmlFor="cfg-cooldown">
                    Cooldown chống spam (phút)
                  </label>
                  <input
                    id="cfg-cooldown"
                    type="number"
                    min={0}
                    max={1440}
                    value={form.cooldown_minutes}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        cooldown_minutes: Math.min(1440, Math.max(0, Number(e.target.value) || 0)),
                      }))
                    }
                    className={`${uiInput} font-bold tabular-nums`}
                  />
                  <p className="mt-1 text-[10.5px] text-slate-500">Mặc định 15p (0–1440p)</p>
                </div>
              </div>

              {/* Row 5: Feature Toggles */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  {
                    key: "notify_new_message" as const,
                    title: "Báo tin nhắn mới",
                    desc: "Thông báo ngay khi khách nhắn tin",
                    accent: "bg-blue-600",
                  },
                  {
                    key: "notify_sla_warning" as const,
                    title: "Báo sắp quá hạn SLA (vàng)",
                    desc: "Nhắc khi sắp chạm ngưỡng SLA",
                    accent: "bg-amber-500",
                  },
                  {
                    key: "notify_sla_breach" as const,
                    title: "Báo quá hạn SLA (đỏ)",
                    desc: "Báo động ngay khi vượt mục tiêu SLA",
                    accent: "bg-brand",
                  },
                  {
                    key: "mention_all_on_breach" as const,
                    title: "Tag @All khi quá hạn SLA",
                    desc: "Gắn mention @All trong nhóm Zalo đích",
                    accent: "bg-rose-600",
                  },
                  {
                    key: "dry_run" as const,
                    title: "Chế độ thử nghiệm (Dry-Run)",
                    desc: "Chỉ ghi log, KHÔNG gửi tin thật vào nhóm",
                    accent: "bg-violet-600",
                  },
                  {
                    key: "include_group_chats" as const,
                    title: "Bao gồm tin từ nhóm chat",
                    desc: "Mặc định tắt (chỉ báo khách inbox 1-1)",
                    accent: "bg-[#10a39c]",
                  },
                ].map((item) => {
                  const val = form[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                      className={cn(
                        "flex items-start justify-between gap-2 rounded-xl border p-3 text-left transition cursor-pointer",
                        val
                          ? "border-slate-300 bg-white shadow-2xs"
                          : "border-slate-200/70 bg-slate-50/50 hover:bg-white",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900">{item.title}</div>
                        <div className="mt-0.5 text-[10.5px] text-slate-500">{item.desc}</div>
                      </div>
                      <span
                        className={cn(
                          "mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition",
                          val ? item.accent : "bg-slate-300",
                        )}
                      >
                        <span
                          className={cn(
                            "h-4 w-4 rounded-full bg-white shadow transition",
                            val ? "translate-x-4" : "translate-x-0.5",
                          )}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Row 6: Template Editor + Live Preview */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="space-y-2 lg:col-span-7">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                      <MessageSquareText className="h-4 w-4 text-brand" />
                      Tùy chỉnh mẫu tin nhắn
                    </div>
                    <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setTemplateTab("new_message")}
                        className={cn(
                          "rounded-full px-2.5 py-0.5 font-bold transition cursor-pointer",
                          templateTab === "new_message"
                            ? "bg-brand text-white"
                            : "text-slate-600 hover:text-slate-900",
                        )}
                      >
                        Tin mới
                      </button>
                      <button
                        type="button"
                        onClick={() => setTemplateTab("sla_breach")}
                        className={cn(
                          "rounded-full px-2.5 py-0.5 font-bold transition cursor-pointer",
                          templateTab === "sla_breach"
                            ? "bg-brand text-white"
                            : "text-slate-600 hover:text-slate-900",
                        )}
                      >
                        Quá hạn SLA
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={6}
                    value={
                      templateTab === "new_message"
                        ? form.new_message_template
                        : form.sla_breach_template
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((prev) =>
                        templateTab === "new_message"
                          ? { ...prev, new_message_template: val }
                          : { ...prev, sla_breach_template: val },
                      );
                    }}
                    className={`${uiTextarea} font-mono text-xs leading-relaxed`}
                  />

                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[10.5px] font-semibold text-slate-500">
                      Chèn biến:
                    </span>
                    {TEMPLATE_VARIABLES.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVariable(v)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 hover:border-brand/40 hover:bg-brand-subtle hover:text-brand cursor-pointer"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live Preview Bubble */}
                <div className="flex flex-col lg:col-span-5">
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-900">
                    <span className="inline-flex items-center gap-1.5">
                      <Eye className="h-4 w-4 text-[#10a39c]" />
                      Live Preview (Zalo Group)
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500">
                      <Sparkles className="h-3 w-3 text-amber-500" />
                      Dữ liệu mẫu
                    </span>
                  </div>
                  <div className="flex-1 rounded-2xl border border-blue-200/80 bg-[#e5effd] p-3.5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-[#0052cc]">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0068FF] text-[9px] font-black text-white">
                        Z
                      </span>
                      <span className="truncate">
                        {form.target_zalo_group_name || "Nhóm CSKH chung"}
                      </span>
                    </div>
                    <div className="rounded-2xl rounded-tl-xs border border-slate-200/80 bg-white p-3 shadow-2xs">
                      <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-slate-800">
                        {livePreviewText}
                      </pre>
                      <div className="mt-1.5 text-right text-[10px] text-slate-400">09:42</div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[10.5px] text-slate-600">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[#10a39c]" />
                      Anti-Loop Guard tự động chặn vòng lặp nếu nhóm đích cũng thuộc kênh Zalo.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-3.5">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className={`${btn.outline} ${btnSize.sm} cursor-pointer`}
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`${btn.primary} ${btnSize.md} cursor-pointer`}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingConfig ? "Lưu thay đổi" : "Tạo cấu hình"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
