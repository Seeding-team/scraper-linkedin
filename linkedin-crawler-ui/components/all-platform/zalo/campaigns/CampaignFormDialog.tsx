"use client";

/** Modal tạo chiến dịch — port nguyên từ CampaignFormModal.tsx + TemplateEditor.tsx
 * (zalo-account-module, InvoiceFlowManager), chỉ đổi màu thương hiệu. Bỏ phần
 * đính kèm ảnh per-template (backend app này chưa hỗ trợ upload ảnh cho
 * campaign — chỉ hỗ trợ message_templates: string[]), giữ nguyên phần còn lại:
 * khung giờ, ngày trong tuần, giãn cách/giới hạn, chu kỳ lặp (giây/phút/giờ/ngày),
 * chèn {{ten}}, AI gợi ý nội dung. Logic/API call giữ nguyên hợp đồng đã có. */

import { useMemo, useState } from "react";
import { AlertTriangle, Calendar, Clock, Loader2, Plus, Save, ShieldAlert, Sparkles, Tag, Trash2, Users, X } from "lucide-react";
import { createZaloCampaign, getZaloConversations, suggestZaloCampaignTemplates } from "@/services/zaloCrawlerService";
import { alert, btn, btnSize, card, input, label, modal, select, textarea } from "../centralized-shared/zaloUi";

interface CampaignFormDialogProps {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}

const DAY_CHIPS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

const NAME_TOKEN = "{{ten}}";

type CycleUnit = "seconds" | "minutes" | "hours" | "days";
const CYCLE_UNIT_SECONDS: Record<CycleUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
const CYCLE_UNIT_OPTIONS: Array<{ value: CycleUnit; label: string }> = [
  { value: "seconds", label: "giây" },
  { value: "minutes", label: "phút" },
  { value: "hours", label: "giờ" },
  { value: "days", label: "ngày" },
];

function parsePhones(text: string): { phone?: string; uid?: string; display_name?: string }[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, ...rest] = line.split(",").map((s) => s.trim());
      const display_name = rest.join(", ") || undefined;
      const digits = value.replace(/\D/g, "");
      // SĐT VN không quá 12 số thuần (kể cả +84/0084) — UID Zalo thật dài
      // hơn nhiều (14-19 số, vd nạp từ "Nạp từ danh sách bạn bè"). Không
      // phân biệt sẽ gọi sai find_zca_user_by_phone cho mọi UID.
      const isPhone = /^[0-9+][0-9+\s]{6,}$/.test(value) && digits.replace(/^00|^84/, "").length <= 11;
      return isPhone ? { phone: value, display_name } : { uid: value, display_name };
    });
}

function countPhones(text: string): number {
  return parsePhones(text).filter((p) => p.phone || p.uid).length;
}

function TemplateEditorItem({
  index,
  text,
  canRemove,
  campaignName,
  onChange,
  onRemove,
}: {
  index: number;
  text: string;
  canRemove: boolean;
  campaignName: string;
  onChange: (text: string) => void;
  onRemove: () => void;
}) {
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

  async function handleAiSuggest() {
    const brief = aiBrief.trim() || campaignName;
    if (!brief) {
      setAiError("Nhập chủ đề, hoặc điền tên chiến dịch trước.");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiSuggestions([]);
    try {
      const res = await suggestZaloCampaignTemplates(brief);
      setAiSuggestions(res.templates || []);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Không tạo được gợi ý nội dung.");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className={`${card} p-4`}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nội dung #{index + 1}</span>
        {canRemove ? (
          <button type="button" onClick={onRemove} className="rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600" title="Xoá nội dung này">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Nội dung tin nhắn... vd: Chào {{ten}}, bên em đang có ưu đãi dành riêng cho anh/chị..."
        className={textarea}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(`${text}${NAME_TOKEN}`)}
          className="inline-flex items-center gap-1 rounded-full border border-brand-border bg-brand-subtle px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
          title="Chèn biến tên khách vào cuối nội dung"
        >
          <Tag className="h-3 w-3" />
          Chèn tên khách: {NAME_TOKEN}
        </button>
        <button type="button" onClick={() => setShowAiPanel((v) => !v)} className={`${btn.outline} ${btnSize.sm}`} title="Nhờ AI gợi ý nội dung tin nhắn">
          <Sparkles className="h-3.5 w-3.5" />
          AI gợi ý nội dung
        </button>
      </div>

      {showAiPanel ? (
        <div className="mt-3 rounded-lg border border-brand-border bg-brand-subtle/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={aiBrief}
              onChange={(e) => setAiBrief(e.target.value)}
              placeholder='Chủ đề mong muốn, vd: "khuyến mãi giảm 20% cuối tuần"... (để trống dùng tên chiến dịch)'
              className={`${input} min-w-[220px] flex-1`}
            />
            <button type="button" onClick={() => void handleAiSuggest()} disabled={aiLoading} className={`${btn.primary} ${btnSize.sm}`}>
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Tạo gợi ý
            </button>
          </div>
          {aiError ? <div className={`${alert.error} mt-2`}>{aiError}</div> : null}
          {aiSuggestions.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {aiSuggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(s);
                    setShowAiPanel(false);
                    setAiSuggestions([]);
                  }}
                  className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:border-brand hover:bg-brand-subtle"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CampaignFormDialog({ accountId, onClose, onCreated }: CampaignFormDialogProps) {
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [intervalMin, setIntervalMin] = useState(30);
  const [intervalMax, setIntervalMax] = useState(90);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [repeatCycleValue, setRepeatCycleValue] = useState(1);
  const [repeatCycleUnit, setRepeatCycleUnit] = useState<CycleUnit>("days");
  const [templates, setTemplates] = useState<string[]>([""]);
  const [phonesText, setPhonesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);

  const phoneCount = useMemo(() => countPhones(phonesText), [phonesText]);

  // "Zalo có 1000 bạn, mỗi tháng cần nhắn lại cho danh sách bạn bè" (yêu cầu
  // 2026-09-17) — chiến dịch lặp lịch là nơi hợp lý nhất cho nhu cầu "nhắn
  // lại hàng tháng", nạp thẳng từ toàn bộ bạn bè, khỏi tự gõ/copy tay.
  const handleLoadFromFriendsList = async () => {
    if (!accountId) return;
    setIsLoadingFriends(true);
    setError(null);
    try {
      const res = await getZaloConversations(accountId);
      const friends = (res.conversations || []).filter((c) => c.thread_type === "user" || c.is_friend);
      if (friends.length === 0) {
        setError('Không tìm thấy bạn bè nào — hãy bấm "Đồng bộ" ở trang Quản lý tài khoản trước.');
        return;
      }
      const lines = friends.map((f) =>
        f.conversation_name ? `${f.conversation_id}, ${f.conversation_name}` : f.conversation_id,
      );
      setPhonesText(lines.join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải danh sách bạn bè.");
    } finally {
      setIsLoadingFriends(false);
    }
  };

  function toggleDay(d: number) {
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Vui lòng nhập tên chiến dịch.");
      return;
    }
    if (daysOfWeek.length === 0) {
      setError("Chọn ít nhất 1 ngày trong tuần để chiến dịch chạy.");
      return;
    }
    if (intervalMax < intervalMin) {
      setError("Giãn cách tối đa phải lớn hơn hoặc bằng giãn cách tối thiểu.");
      return;
    }
    const cleanTemplates = templates.map((t) => t.trim()).filter(Boolean);
    if (cleanTemplates.length === 0) {
      setError("Cần ít nhất 1 nội dung tin nhắn.");
      return;
    }
    setSaving(true);
    try {
      await createZaloCampaign({
        account_id: accountId,
        name: name.trim(),
        is_enabled: true,
        start_time: startTime,
        end_time: endTime,
        days_of_week: daysOfWeek,
        interval_seconds_min: intervalMin,
        interval_seconds_max: intervalMax,
        daily_limit: dailyLimit,
        repeat_cycle_seconds: Math.max(60, Math.round(repeatCycleValue * CYCLE_UNIT_SECONDS[repeatCycleUnit])),
        message_templates: cleanTemplates,
        recipients: parsePhones(phonesText),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được chiến dịch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${modal.overlay} flex items-center justify-center`}>
      <div className={`${modal.panel} flex max-h-[90vh] w-full max-w-3xl flex-col p-0`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-900">Tạo chiến dịch tự động</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {error ? (
            <div className={`${alert.error} justify-between`}>
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </span>
              <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Tên chiến dịch</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Chăm sóc khách cũ hàng ngày" className={input} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Lịch chạy
            </div>
            <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
              <div>
                <label className={label}>Giờ bắt đầu</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Giờ kết thúc</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={input} />
              </div>
            </div>
            <div className="mt-3">
              <label className={label}>
                <Calendar className="mr-1 inline h-3 w-3" />
                Ngày hoạt động trong tuần
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DAY_CHIPS.map((d) => {
                  const active = daysOfWeek.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={`h-8 w-12 rounded-md border text-xs font-semibold transition-colors ${
                        active ? "border-brand bg-brand text-white shadow-sm" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <ShieldAlert className="h-3.5 w-3.5" />
              Giãn cách &amp; giới hạn
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className={label}>Giãn cách tối thiểu (giây)</label>
                <input type="number" min={1} value={intervalMin} onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value) || 0))} className={input} />
              </div>
              <div>
                <label className={label}>Giãn cách tối đa (giây)</label>
                <input type="number" min={1} value={intervalMax} onChange={(e) => setIntervalMax(Math.max(1, Number(e.target.value) || 0))} className={input} />
              </div>
              <div>
                <label className={label}>Giới hạn tin/ngày</label>
                <input type="number" min={1} value={dailyLimit} onChange={(e) => setDailyLimit(Math.max(1, Number(e.target.value) || 0))} className={input} />
              </div>
            </div>

            <div className="mt-3">
              <label className={label}>Lặp lại gửi cho toàn bộ danh sách mỗi</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={repeatCycleValue} onChange={(e) => setRepeatCycleValue(Math.max(1, Number(e.target.value) || 1))} className={`${input} w-28`} />
                <select value={repeatCycleUnit} onChange={(e) => setRepeatCycleUnit(e.target.value as CycleUnit)} className={select}>
                  {CYCLE_UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Hết chu kỳ này, chiến dịch tự động gửi lại từ đầu cho toàn bộ người nhận (xoay vòng nội dung).
              </p>
            </div>

            <div className={`${alert.info} mt-2.5`}>
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Giãn cách quá ngắn hoặc giới hạn/ngày quá cao dễ khiến tài khoản Zalo bị đánh dấu spam hoặc khoá. Mặc định
                30–90 giây/tin là mức khuyến nghị.
              </span>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nội dung tin nhắn (xoay vòng)</span>
              <button type="button" onClick={() => setTemplates((prev) => [...prev, ""])} className={`${btn.outline} ${btnSize.sm}`}>
                <Plus className="h-3.5 w-3.5" />
                Thêm nội dung
              </button>
            </div>
            <div className="space-y-3">
              {templates.map((t, i) => (
                <TemplateEditorItem
                  key={i}
                  index={i}
                  text={t}
                  canRemove={templates.length > 1}
                  campaignName={name}
                  onChange={(next) => setTemplates((prev) => prev.map((x, idx) => (idx === i ? next : x)))}
                  onRemove={() => setTemplates((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)))}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label className={label}>Người nhận (SĐT/UID, mỗi dòng 1 người — có thể thêm sau)</label>
              <button
                type="button"
                onClick={() => void handleLoadFromFriendsList()}
                disabled={isLoadingFriends}
                className={`${btn.outline} ${btnSize.sm} shrink-0 flex items-center gap-1`}
                title="Nạp toàn bộ bạn bè của tài khoản này vào danh sách người nhận"
              >
                {isLoadingFriends ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                Nạp từ danh sách bạn bè
              </button>
            </div>
            <textarea
              value={phonesText}
              onChange={(e) => setPhonesText(e.target.value)}
              rows={5}
              placeholder={"Dán danh sách số điện thoại hoặc UID, mỗi dòng 1 người\nvd: 0912345678, Chị Lan"}
              className={`${textarea} font-mono placeholder:font-sans`}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Nhận diện được <strong className="text-slate-700">{phoneCount}</strong> người nhận.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className={`${btn.outline} ${btnSize.sm}`}>
            Hủy
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving} className={`${btn.primary} ${btnSize.sm}`}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Tạo chiến dịch
          </button>
        </div>
      </div>
    </div>
  );
}
