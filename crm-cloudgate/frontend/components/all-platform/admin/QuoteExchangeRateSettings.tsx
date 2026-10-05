"use client";

import { useEffect, useState } from "react";
import { CurrencyInput } from "@/components/CurrencyInput";
import { seedingQuoteRepository } from "@/modules/quotes/repositories/SeedingQuoteRepository";
import type { SystemExchangeRate } from "@/modules/quotes/repositories/QuoteRepository";
import { invalidateSystemUsdVndRate } from "@/modules/service-catalog/useSystemExchangeRate";

function formatWhen(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN");
}

/** Tỷ giá USD → VND mặc định của hệ thống. Luồng chính là TỰ ĐỘNG (tygiausd.org – USD thị trường tự do, giá bán ra; dự phòng ExchangeRate-API);
 * Admin chỉ override thủ công khi cần. Báo giá mới lấy tỷ giá mới nhất, báo giá đã tạo giữ tỷ giá đã chốt. */
export function QuoteExchangeRateSettings() {
  const [current, setCurrent] = useState<SystemExchangeRate | null>(null);
  const [manualRate, setManualRate] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"refresh" | "manual" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    let alive = true;
    seedingQuoteRepository
      .getExchangeRate()
      .then(result => {
        if (!alive) return;
        setCurrent(result);
        setManualRate(result.rate);
        // Không lấy được tự động và chưa có rate → mở sẵn ô nhập tay.
        if (!result.rate) setShowManual(true);
      })
      .catch(err => alive && setMessage({ ok: false, text: err instanceof Error ? err.message : "Không tải được tỷ giá." }));
    return () => {
      alive = false;
    };
  }, []);

  async function refresh() {
    setBusy("refresh");
    setMessage(null);
    try {
      const result = await seedingQuoteRepository.refreshExchangeRate();
      invalidateSystemUsdVndRate();
      setCurrent(result);
      if (result.refreshed) {
        setManualRate(result.rate);
        setMessage({ ok: true, text: `Đã cập nhật tỷ giá từ ${result.source}.` });
      } else if (result.cooldown && !result.error) {
        setMessage({ ok: true, text: "Tỷ giá vừa được cập nhật gần đây — thử lại sau ít phút (nguồn chỉ cho phép gọi thưa)." });
      } else {
        setMessage({
          ok: false,
          text: result.error || "Chưa cập nhật được tỷ giá.",
        });
        if (!result.rate) setShowManual(true);
      }
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Không cập nhật được tỷ giá." });
    } finally {
      setBusy(null);
    }
  }

  async function applyManual() {
    if (!manualRate || manualRate <= 0) {
      setMessage({ ok: false, text: "Nhập tỷ giá lớn hơn 0." });
      return;
    }
    setBusy("manual");
    setMessage(null);
    try {
      const saved = await seedingQuoteRepository.setExchangeRate(manualRate, note.trim() || undefined);
      invalidateSystemUsdVndRate();
      setCurrent(saved);
      setMessage({ ok: true, text: "Đã áp dụng tỷ giá thủ công. Hệ thống sẽ không tự ghi đè cho tới khi bấm “Cập nhật tỷ giá”." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Không lưu được tỷ giá." });
    } finally {
      setBusy(null);
    }
  }

  const hasRate = Boolean(current?.rate);

  return (
    <div className="max-w-2xl space-y-5 rounded-xl border border-outline-variant bg-surface p-6 text-xs">
      <div>
        <h3 className="text-sm font-bold text-on-surface">Tỷ giá USD → VND mặc định</h3>
        <p className="mt-1 text-on-surface-variant">
          Khi chọn USD trong báo giá, hệ thống dùng tỷ giá mới nhất bên dưới và chốt vào báo giá. Báo giá đã tạo luôn giữ tỷ giá đã chốt.
        </p>
      </div>

      <div className="rounded-lg border border-outline-variant p-4 space-y-2">
        {hasRate ? (
          <>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-2xl font-extrabold text-on-surface">1 USD = {current!.rate!.toLocaleString("vi-VN")} VND</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  current!.isManual ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                }`}
              >
                {current!.isManual ? "Thủ công" : "Tự động"}
              </span>
            </div>
            <div className="text-on-surface-variant">
              Nguồn: <strong className="text-on-surface">{current!.source || "—"}</strong> · Cập nhật: <strong className="text-on-surface">{formatWhen(current!.updatedAt)}</strong>
            </div>
            {current!.stale ? (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                {current!.lastError
                  ? `Lần lấy tỷ giá gần nhất thất bại — đang dùng tỷ giá gần nhất. ${current!.lastError}`
                  : "Tỷ giá tự động đã cũ hơn 24 giờ — bấm “Cập nhật tỷ giá”."}
              </div>
            ) : null}
            {current!.isManual ? (
              <div className="text-on-surface-variant">Đang dùng tỷ giá thủ công{current!.note ? ` (${current!.note})` : ""}; hệ thống không tự ghi đè.</div>
            ) : null}
          </>
        ) : (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
            Chưa có tỷ giá và chưa lấy được tự động
            {current?.error ? ` (${current.error})` : ""}. Bấm “Cập nhật tỷ giá” để thử lại hoặc nhập tay bên dưới.
          </div>
        )}

        <div className="text-[12px] text-on-surface-variant">
          Nguồn tự động: <strong className="text-on-surface">Tỷ giá USD thị trường tự do – tygiausd.org</strong> (giá <strong>bán ra</strong>); dự phòng ExchangeRate-API khi nguồn chính lỗi.
        </div>

        <div className="pt-1">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void refresh()}
            className="h-9 rounded-md bg-primary px-4 font-bold text-white disabled:opacity-60 cursor-pointer"
          >
            {busy === "refresh" ? "Đang cập nhật…" : "Cập nhật tỷ giá"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <button type="button" className="font-semibold text-primary hover:underline cursor-pointer" onClick={() => setShowManual(v => !v)}>
          {showManual ? "Ẩn ghi đè thủ công" : "Ghi đè thủ công (khi cần)"}
        </button>
        {showManual ? (
          <div className="space-y-3 rounded-lg border border-outline-variant p-4">
            <label className="block space-y-1">
              <span className="font-semibold">1 USD = ? VND</span>
              <CurrencyInput
                className="h-9 w-full rounded-md border border-outline-variant px-3"
                decimals={2}
                locale="en-US"
                value={manualRate}
                placeholder="Nhập tỷ giá"
                onChange={setManualRate}
              />
            </label>
            <label className="block space-y-1">
              <span className="font-semibold">Lý do / ghi chú (tuỳ chọn)</span>
              <input
                className="h-9 w-full rounded-md border border-outline-variant px-3"
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder="Ví dụ: tỷ giá thoả thuận với khách"
              />
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void applyManual()}
              className="h-9 rounded-md border border-primary px-4 font-bold text-primary disabled:opacity-60 cursor-pointer"
            >
              {busy === "manual" ? "Đang lưu…" : "Áp dụng tỷ giá thủ công"}
            </button>
          </div>
        ) : null}
      </div>

      {message ? <p className={message.ok ? "text-emerald-600" : "text-red-600"}>{message.text}</p> : null}
    </div>
  );
}
