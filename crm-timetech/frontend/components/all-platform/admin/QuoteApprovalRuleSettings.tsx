"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { cn } from "@/lib/utils";
import { seedingQuoteRepository } from "@/modules/quotes";
import type { QuoteApprovalRuleSet, QuoteApprovalRuleType } from "@/modules/quotes";

const inputClass =
  "w-full px-4 py-2 bg-surface-container-low/30 border border-outline-variant rounded-xl text-xs text-on-surface focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all outline-none";
const primaryBtnClass =
  "px-4 py-2 bg-primary hover:bg-on-primary-fixed-variant text-white font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 shadow-sm cursor-pointer whitespace-nowrap";

const RULE_LABELS: Record<QuoteApprovalRuleType, { label: string; description: string; unit: string }> = {
  gross_margin_percent: { label: "Gross margin tối thiểu", description: "Margin = (Giá sau CK − Cost) / Giá sau CK.", unit: "%" },
  gross_profit_amount: { label: "Lợi nhuận gộp tối thiểu", description: "Giá bán sau chiết khấu phải tạo đủ gross profit.", unit: "đ" },
  discount_percent: { label: "Chiết khấu thương mại tối đa", description: "Vượt ngưỡng phải chuyển người có quyền duyệt.", unit: "%" },
  payment_terms_days: { label: "Thời hạn thanh toán tối đa", description: "Điều khoản dài hơn ngưỡng được xem là ngoại lệ.", unit: "ngày" },
};

const DEFAULT_DRAFT: Record<QuoteApprovalRuleType, { thresholdValue: string; isRequired: boolean }> = {
  gross_margin_percent: { thresholdValue: "20", isRequired: true },
  gross_profit_amount: { thresholdValue: "5000000", isRequired: true },
  discount_percent: { thresholdValue: "10", isRequired: true },
  payment_terms_days: { thresholdValue: "45", isRequired: true },
};

/** Admin → Cài đặt báo giá → Quy tắc phê duyệt (migration 091). Tach ra tu
 * modal noi trong QuoteWorkspaceModal.tsx (Buoc 2) thanh 1 trang cai dat rieng
 * - workspace gio chi CON HIEN THI (card doc, khong con nut "Cài đặt"), sua
 * that dieu kien duyet chi lam o day. */
export function QuoteApprovalRuleSettings() {
  const { user } = useAppAuth();
  // Mirror can_manage_quote_approval_rules() o backend (crm_permission_service.py)
  // - CHI Admin (khong con Leader) duoc cau hinh quy tac phe duyet.
  const canManage = user?.role === "admin";

  const [ruleSet, setRuleSet] = useState<QuoteApprovalRuleSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  // Da luu roi thi khoa lai (chi doc), bam "Chinh sua" moi mo khoa de sua tiep.
  const [locked, setLocked] = useState(false);

  function applyRuleSetToDraft(result: QuoteApprovalRuleSet | null) {
    if (!result) return;
    const next = { ...DEFAULT_DRAFT };
    for (const rule of result.rules) {
      next[rule.ruleType] = { thresholdValue: String(rule.thresholdValue), isRequired: rule.isRequired };
    }
    setDraft(next);
    setAutoApprove(result.autoApproveEnabled);
  }

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    seedingQuoteRepository
      .getActiveQuoteApprovalRuleSet()
      .then(result => {
        if (cancelled) return;
        setRuleSet(result);
        applyRuleSetToDraft(result);
        setLocked(Boolean(result));
        setIdempotencyKey(`rule-set-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Không tải được quy tắc phê duyệt.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  if (!canManage) {
    return (
      <div className="rounded-xl border border-red-100 bg-surface p-6 text-xs font-medium text-red-600">
        Bạn không có quyền truy cập trang này. Chỉ Admin mới được cấu hình quy tắc phê duyệt báo giá.
      </div>
    );
  }

  if (loading) {
    return <div className="rounded-xl border border-outline-variant bg-surface p-6 text-xs text-on-surface-variant">Đang tải…</div>;
  }
  if (loadError) {
    return <div className="rounded-xl border border-red-100 bg-surface p-6 text-xs font-medium text-red-600">{loadError}</div>;
  }

  async function handleSave() {
    setError(null);
    const rows: { ruleType: QuoteApprovalRuleType; thresholdValue: number; isRequired: boolean }[] = [];
    for (const ruleType of Object.keys(draft) as QuoteApprovalRuleType[]) {
      const raw = draft[ruleType].thresholdValue;
      const value = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(value)) {
        setError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" phải là số.`);
        return;
      }
      if ((ruleType === "gross_margin_percent" || ruleType === "discount_percent") && (value < 0 || value > 100)) {
        setError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" phải trong khoảng 0-100.`);
        return;
      }
      if (ruleType === "gross_profit_amount" && value < 0) {
        setError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" không được âm.`);
        return;
      }
      if (ruleType === "payment_terms_days" && value <= 0) {
        setError(`Ngưỡng của "${RULE_LABELS[ruleType].label}" phải lớn hơn 0.`);
        return;
      }
      rows.push({ ruleType, thresholdValue: value, isRequired: draft[ruleType].isRequired });
    }
    setBusy(true);
    try {
      const saved = await seedingQuoteRepository.saveQuoteApprovalRuleSet({ rules: rows, autoApproveEnabled: autoApprove, idempotencyKey });
      setRuleSet(saved);
      setNotice("Đã lưu quy tắc phê duyệt.");
      setIdempotencyKey(`rule-set-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      setLocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được quy tắc phê duyệt.");
    } finally {
      setBusy(false);
    }
  }

  function handleCancelEdit() {
    setError(null);
    applyRuleSetToDraft(ruleSet);
    setLocked(true);
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <h2 className="text-sm font-bold text-on-surface">Quy tắc phê duyệt</h2>
        <p className="text-xs text-on-surface-variant mt-1">
          {ruleSet ? `${ruleSet.name} · V${ruleSet.version}` : "Chưa cấu hình quy tắc"} — các quy tắc được đánh giá khi hoàn tất phần giá bán.
        </p>
      </div>

      {notice ? (
        <div className="rounded-xl border px-4 py-3 text-xs font-medium bg-green-50 text-green-800 border-green-200">{notice}</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border px-4 py-3 text-xs font-medium bg-primary-container/10 text-primary-container border-primary-container/20">{error}</div>
      ) : null}

      <div className="rounded-xl border border-outline-variant bg-surface p-6 space-y-5 shadow-sm">
        {(Object.keys(RULE_LABELS) as QuoteApprovalRuleType[]).map(ruleType => {
          const meta = RULE_LABELS[ruleType];
          const row = draft[ruleType];
          return (
            <label key={ruleType} className="flex items-start gap-3 border-b border-outline-variant/60 pb-4 last:border-0 last:pb-0">
              <input
                type="checkbox"
                checked={row.isRequired}
                disabled={locked}
                onChange={e => setDraft(prev => ({ ...prev, [ruleType]: { ...prev[ruleType], isRequired: e.target.checked } }))}
                className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="flex-1 min-w-0">
                <strong className="text-xs font-bold text-on-surface">{meta.label}</strong>
                <p className="text-[11px] text-on-surface-variant mt-0.5">{meta.description}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <input
                  type="number"
                  className={cn(inputClass, "w-28", locked && "opacity-60 cursor-not-allowed bg-surface-container-low/60")}
                  value={row.thresholdValue}
                  disabled={locked}
                  onChange={e => setDraft(prev => ({ ...prev, [ruleType]: { ...prev[ruleType], thresholdValue: e.target.value } }))}
                />
                <span className="text-xs text-on-surface-variant">{meta.unit}</span>
              </div>
            </label>
          );
        })}

        <label className={cn("flex items-start gap-3 pt-1", locked ? "cursor-not-allowed" : "cursor-pointer")}>
          <input
            type="checkbox"
            checked={autoApprove}
            disabled={locked}
            onChange={e => setAutoApprove(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div>
            <strong className="text-xs font-bold text-on-surface">Tự động duyệt khi đạt tất cả quy tắc</strong>
            <p className="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">
              Tắt: đạt đủ quy tắc → chuyển "Chờ duyệt", người có quyền bấm duyệt. Bật: đạt đủ quy tắc bắt buộc → hệ thống tự
              duyệt (không tự phát hành, không tự gửi khách hàng). Có 1 quy tắc không đạt hoặc thiếu dữ liệu → không tự duyệt.
            </p>
          </div>
        </label>

        <div className="flex items-center gap-3 pt-1">
          {locked ? (
            <button type="button" className={primaryBtnClass} onClick={() => setLocked(false)}>
              <span className="inline-flex items-center gap-1.5">
                <MaterialIcon name="lock_reset" className="text-sm" />
                Chỉnh sửa
              </span>
            </button>
          ) : (
            <>
              <button type="button" className={primaryBtnClass} onClick={() => void handleSave()} disabled={busy}>
                {busy ? "Đang lưu…" : "Lưu quy tắc"}
              </button>
              {ruleSet ? (
                <button
                  type="button"
                  className="px-4 py-2 bg-surface-container-low/40 hover:bg-surface-container-low/70 text-on-surface font-bold text-xs rounded-xl active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 cursor-pointer whitespace-nowrap"
                  onClick={handleCancelEdit}
                  disabled={busy}
                >
                  Hủy
                </button>
              ) : null}
            </>
          )}
          {locked ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant">
              <MaterialIcon name="lock" className="text-sm" />
              Đã lưu — bấm "Chỉnh sửa" để thay đổi.
            </span>
          ) : ruleSet ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant">
              <MaterialIcon name="info" className="text-sm" />
              Áp dụng cho mọi báo giá đang ở Bước 2 (Hoàn thiện giá bán).
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
