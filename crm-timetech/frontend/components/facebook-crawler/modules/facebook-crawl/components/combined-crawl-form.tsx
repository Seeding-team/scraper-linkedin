"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RiDeleteBin6Line } from "react-icons/ri";

// LinkedIn imports
import { MaterialIcon } from "@/components/ui";
import {
  normalizeN8nGroupsList,
  type ManagedGroupRow,
} from "@/lib/LinkedIn-n8n-groups-normalize";
import { getAllN8nGroups } from "@/services/linkedinCrawlerService";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";

// Facebook imports
import { CrawlFb_Schemas, CrawlFb_form } from "../schemas/crawl-fb-schemas";
import { useAuthContext } from "../../../shared/components/contexts/AuthContext";
import FullScreenLoading from "../../../shared/components/layout/FullScreenLoading";
import { useCrawlFB } from "../hooks/use-crawl-fb";
import { IntentBatchModal } from "./intent-component";
import { IntentItemDTO } from "../schemas/intent-schemas";
import { useGetIntents } from "../hooks/use-get-intents";
import { SelectPresetGroupsModal } from "./select-preset-groups-modal";
import FacebookPosts from "./process-raw-posts";

// ──────────────────────────────────────────────────────────
// Shared input style (LinkedIn design system)
const INPUT_CLS =
  "border-outline-variant bg-surface focus:border-primary focus:ring-primary rounded-lg border px-md py-sm transition-all outline-none focus:ring-1 w-full";
const LABEL_CLS =
  "text-label-md text-on-surface-variant font-semibold tracking-wide uppercase";
const BTN_PRIMARY =
  "bg-primary text-on-primary hover:bg-primary-container active:scale-[0.98] rounded-lg py-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60";
const BTN_OUTLINE =
  "border-outline-variant bg-surface hover:bg-surface-container-high rounded-lg border px-md py-xs text-xs font-bold uppercase";

type Tab = "linkedin" | "facebook";

// ──────────────────────────────────────────────────────────
// LinkedIn sub-form
function LinkedInForm({ onSuccess }: { onSuccess?: () => void }) {
  const PICKER_PAGE_SIZE = 8;
  const d = useDashboard();

  useEffect(() => {
    if (d.crawlSuccessModalOpen) {
      toast.success(d.crawlSuccessModalMessage || "Thành công");
      d.closeCrawlSuccessModal();
      d.refreshDashboardData();
      onSuccess?.();
    }
  }, [d.crawlSuccessModalOpen, d.closeCrawlSuccessModal, d.refreshDashboardData, onSuccess, d.crawlSuccessModalMessage]);

  useEffect(() => {
    if (d.role === "member") {
      d.fetchMyKpi();
      d.handleGetAllPosts();
    }
  }, [d.email, d.role]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerRows, setPickerRows] = useState<ManagedGroupRow[]>([]);
  const [pickedUrls, setPickedUrls] = useState<Set<string>>(new Set());
  const [pickerPage, setPickerPage] = useState(1);
  const [selectedType, setSelectedType] = useState<string>("all");

  const selectedPreview = useMemo(
    () =>
      d.groupUrls
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    [d.groupUrls],
  );

  const pickerTypeOptions = useMemo(() => {
    const types = pickerRows
      .map((r) => r.type?.trim())
      .filter((t): t is string => Boolean(t));
    return Array.from(new Set(types));
  }, [pickerRows]);

  const filteredPickerRows = useMemo(
    () =>
      selectedType === "all"
        ? pickerRows
        : pickerRows.filter((r) => r.type === selectedType),
    [pickerRows, selectedType],
  );

  const pickerTotalPages = Math.max(
    1,
    Math.ceil(filteredPickerRows.length / PICKER_PAGE_SIZE),
  );
  const pickerSafePage = Math.min(pickerPage, pickerTotalPages);
  const pickerPageStart = (pickerSafePage - 1) * PICKER_PAGE_SIZE;
  const pickerPageRows = filteredPickerRows.slice(
    pickerPageStart,
    pickerPageStart + PICKER_PAGE_SIZE,
  );

  const openGroupPicker = async () => {
    if (!d.email.trim()) {
      setPickerError("Nhập Email (LinkedIn) trước khi chọn danh sách nhóm.");
      return;
    }
    setPickerOpen(true);
    setPickerBusy(true);
    setPickerPage(1);
    setPickerError(null);
    setSelectedType("all");
    try {
      const res = await getAllN8nGroups({ email: d.email.trim() });
      if (!res.success)
        throw new Error(res.message || "Không tải được danh sách nhóm.");
      const rows = normalizeN8nGroupsList(res.data?.groups ?? res.data?.parsed);
      setPickerRows(rows);
      setPickedUrls(new Set(selectedPreview));
    } catch (e) {
      setPickerRows([]);
      setPickerError(
        e instanceof Error ? e.message : "Lỗi tải danh sách nhóm.",
      );
    } finally {
      setPickerBusy(false);
    }
  };

  const togglePick = (url: string) => {
    setPickedUrls((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  };

  const applyPickedGroups = () => {
    d.setGroupUrls(
      pickerRows
        .filter((r) => pickedUrls.has(r.url_group))
        .map((r) => r.url_group)
        .join("\n"),
    );
    setPickerOpen(false);
  };

  const togglePickAll = () => {
    if (!filteredPickerRows.length) return;
    const allSelected = filteredPickerRows.every((r) =>
      pickedUrls.has(r.url_group),
    );
    setPickedUrls((prev) => {
      const next = new Set(prev);
      filteredPickerRows.forEach((r) =>
        allSelected ? next.delete(r.url_group) : next.add(r.url_group),
      );
      return next;
    });
  };

  return (
    <>
      {d.isCrawling && (
        <FullScreenLoading
          title="Đang thu thập dữ liệu LinkedIn"
          content={d.feedbackMessage || d.errorMessage || "Vui lòng giữ nguyên trang, tiến trình cào dữ liệu đang diễn ra..."}
        />
      )}
      <div className="grid grid-cols-1 gap-md">
        {/* Email */}
        <div className="flex flex-col gap-base">
          <label htmlFor={d.emailId} className={LABEL_CLS}>
            Email (LinkedIn)
          </label>
          <input
            id={d.emailId}
            className={INPUT_CLS}
            placeholder="example@congty.com"
            type="email"
            value={d.email}
            onChange={(e) => d.setEmail(e.target.value)}
            autoComplete="username"
            disabled={d.isCrawling}
          />
        </div>
        {/* Password */}
        <div className="flex flex-col gap-base">
          <label htmlFor={d.passwordId} className={LABEL_CLS}>
            Mật khẩu
          </label>
          <input
            id={d.passwordId}
            className={INPUT_CLS}
            placeholder="••••••••••••"
            type="password"
            value={d.password}
            onChange={(e) => d.setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={d.isCrawling}
          />
        </div>
        {/* Max posts + Target date */}
        <div className="grid grid-cols-2 gap-md">
          <div className="flex flex-col gap-base">
            <label htmlFor={d.maxPostsId} className={LABEL_CLS}>
              Tối đa bài viết
            </label>
            <input
              id={d.maxPostsId}
              className={INPUT_CLS}
              type="number"
              min={1}
              value={d.maxPosts}
              onChange={(e) =>
                d.setMaxPosts(Number.parseInt(e.target.value, 10) || 0)
              }
              disabled={d.isCrawling}
            />
          </div>
          <div className="flex flex-col gap-base">
            <label htmlFor={d.targetDateId} className={LABEL_CLS}>
              Ngày mục tiêu
            </label>
            <input
              id={d.targetDateId}
              className={INPUT_CLS}
              type="date"
              value={d.targetDate}
              onChange={(e) => d.setTargetDate(e.target.value)}
              disabled={d.isCrawling}
            />
          </div>
        </div>
        {/* Mode + Delay */}
        <div className="grid grid-cols-2 gap-md">
          <div className="flex flex-col gap-base">
            <label htmlFor={d.modeId} className={LABEL_CLS}>
              Chế độ
            </label>
            <select
              id={d.modeId}
              className={INPUT_CLS}
              value={d.mode}
              onChange={(e) => d.setMode(e.target.value as "Detailed" | "Fast")}
              disabled={d.isCrawling}
            >
              <option value="Detailed">Chi tiết</option>
              <option value="Fast">Nhanh</option>
            </select>
          </div>
          <div className="flex flex-col gap-base">
            <label htmlFor={d.delayId} className={LABEL_CLS}>
              Độ trễ (giây)
            </label>
            <input
              id={d.delayId}
              className={INPUT_CLS}
              type="number"
              min={0}
              value={d.delaySec}
              onChange={(e) =>
                d.setDelaySec(Number.parseInt(e.target.value, 10) || 0)
              }
              disabled={d.isCrawling}
            />
          </div>
        </div>
        {/* Group URLs */}
        <div className="flex flex-col gap-base">
          <label className={LABEL_CLS}>Nhóm LinkedIn cần cào</label>

          {selectedPreview.length === 0 ? (
            <div className="border border-dashed border-outline-variant rounded-xl p-lg text-center bg-surface-container-low/30">
              <p className="text-sm text-on-surface-variant">
                Chưa có nhóm LinkedIn nào được chọn.
              </p>
              <p className="text-[11px] text-on-surface-variant mt-1 opacity-70">
                Vui lòng nhấp vào nút "Chọn nhóm từ danh sách" bên dưới để thêm
                nhóm cần cào.
              </p>
            </div>
          ) : (
            <div className="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest max-h-[300px] overflow-y-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
                  <tr>
                    <th className="px-md py-sm font-semibold text-on-surface-variant">
                      Tên Group
                    </th>
                    <th className="px-md py-sm font-semibold text-on-surface-variant">
                      URL
                    </th>
                    <th className="px-md py-sm w-[60px] text-center font-semibold text-on-surface-variant">
                      Xóa
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {pickerRows
                    .filter((r) => pickedUrls.has(r.url_group))
                    .map((group, idx) => (
                      <tr
                        key={`${group.url_group}-${idx}`}
                        className="hover:bg-surface-container-low/40 transition-colors"
                      >
                        <td className="px-md py-sm font-medium text-on-surface">
                          {group.name_group || "—"}
                        </td>
                        <td
                          className="px-md py-sm text-xs text-on-surface-variant truncate max-w-[280px]"
                          title={group.url_group}
                        >
                          {group.url_group}
                        </td>
                        <td className="px-md py-sm text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const newUrls = new Set(pickedUrls);
                              newUrls.delete(group.url_group);
                              setPickedUrls(newUrls);
                              const updatedList = pickerRows
                                .filter((r) => newUrls.has(r.url_group))
                                .map((r) => r.url_group)
                                .join("\n");
                              d.setGroupUrls(updatedList);
                            }}
                            className="text-red-500 hover:text-red-700 transition duration-150 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                          >
                            <RiDeleteBin6Line className="text-base" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-md mt-md">
            <p className="text-body-sm text-on-surface-variant">
              Đã chọn{" "}
              <span className="font-semibold text-on-surface">
                {selectedPreview.length}
              </span>{" "}
              nhóm.
            </p>
            <button
              type="button"
              className={BTN_OUTLINE}
              onClick={() => void openGroupPicker()}
              disabled={d.isCrawling || pickerBusy}
            >
              {pickerBusy ? "Đang tải nhóm..." : "Chọn nhóm từ danh sách"}
            </button>
          </div>
        </div>
      </div>

      {/* Feedback */}
      {(d.feedbackMessage || d.errorMessage) && (
        <div
          className={`rounded-lg border px-md py-sm text-body-sm mt-md ${
            d.errorMessage
              ? "border-error-container bg-error-container/40 text-error"
              : "border-secondary-container bg-secondary-container/20 text-on-secondary-container"
          }`}
          role={d.errorMessage ? "alert" : "status"}
        >
          {d.errorMessage ?? d.feedbackMessage}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-md flex flex-col items-center gap-md sm:flex-row">
        <button
          type="button"
          className={`${BTN_PRIMARY} w-full sm:flex-1`}
          onClick={d.handleStartCrawl}
          disabled={d.isCrawling}
        >
          {d.isCrawling ? "Đang crawl..." : "Bắt đầu Crawl"}
        </button>
        <button
          type="button"
          className="border-primary text-primary hover:bg-primary/5 w-full rounded-lg border bg-transparent py-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
          onClick={d.handleValidateLinks}
          disabled={d.isCrawling}
        >
          Kiểm tra URL
        </button>
      </div>
      <button
        type="button"
        className="text-on-surface-variant hover:text-on-surface text-label-md py-xs w-full text-center font-semibold tracking-wide uppercase transition-colors"
        onClick={d.handleResetForm}
        disabled={d.isCrawling}
      >
        Đặt lại biểu mẫu
      </button>

      {/* Group Picker Modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-md sm:items-center"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            aria-label="Đóng"
            onClick={() => !pickerBusy && setPickerOpen(false)}
          />
          <div
            className="border-outline-variant bg-surface relative z-10 w-[min(94vw,920px)] rounded-xl border p-lg shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-picker-title"
          >
            <h3
              id="group-picker-title"
              className="text-h3 text-on-surface font-semibold"
            >
              LỰA CHỌN NHÓM CÀO
            </h3>
            <div className="mt-sm flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-xs">
                <label className={LABEL_CLS}>Lọc theo loại nhóm</label>
                <select
                  className="border-outline-variant bg-surface focus:border-primary focus:ring-primary min-w-[220px] rounded-lg border px-md py-xs text-sm transition-all outline-none focus:ring-1"
                  value={selectedType}
                  onChange={(e) => {
                    setSelectedType(e.target.value);
                    setPickerPage(1);
                  }}
                  disabled={pickerBusy || !pickerRows.length}
                >
                  <option value="all">Tất cả loại nhóm</option>
                  {pickerTypeOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={`${BTN_OUTLINE} disabled:cursor-not-allowed disabled:opacity-60`}
                onClick={togglePickAll}
                disabled={pickerBusy || !filteredPickerRows.length}
              >
                {filteredPickerRows.length > 0 &&
                filteredPickerRows.every((r) => pickedUrls.has(r.url_group))
                  ? "Bỏ chọn tất cả"
                  : "Chọn tất cả"}
              </button>
            </div>

            {pickerError && (
              <div className="border-error-container bg-error-container/40 text-error mt-md rounded-lg border px-md py-sm text-body-sm">
                {pickerError}
              </div>
            )}

            <div className="mt-md max-h-[52vh] overflow-auto rounded-lg border border-outline-variant">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="bg-surface-container-low border-outline-variant border-b">
                  <tr>
                    <th className="px-md py-sm">Chọn</th>
                    <th className="px-md py-sm">URL nhóm</th>
                    <th className="px-md py-sm">Tên nhóm</th>
                    <th className="px-md py-sm">Loại</th>
                    <th className="px-md py-sm text-right">Thành viên</th>
                  </tr>
                </thead>
                <tbody className="divide-outline-variant divide-y">
                  {pickerPageRows.map((row, idx) => (
                    <tr
                      key={`${row.url_group}-${idx}`}
                      className="hover:bg-surface-container/40"
                    >
                      <td className="px-md py-sm">
                        <input
                          type="checkbox"
                          className="accent-primary size-4"
                          checked={pickedUrls.has(row.url_group)}
                          onChange={() => togglePick(row.url_group)}
                        />
                      </td>
                      <td className="px-md py-sm break-all">{row.url_group}</td>
                      <td className="px-md py-sm">{row.name_group || "—"}</td>
                      <td className="px-md py-sm">{row.type || "—"}</td>
                      <td className="px-md py-sm text-right tabular-nums">
                        {row.member.toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                  {!pickerBusy && !filteredPickerRows.length && (
                    <tr>
                      <td
                        className="text-on-surface-variant px-md py-lg text-center"
                        colSpan={5}
                      >
                        {!pickerRows.length
                          ? "Không có nhóm nào từ API get-group."
                          : "Không có nhóm nào phù hợp với bộ lọc."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {pickerRows.length > 0 && (
              <div className="text-body-sm text-on-surface-variant mt-md flex items-center justify-between gap-md">
                <span>
                  Hiển thị {pickerPageStart + 1}–
                  {Math.min(
                    pickerPageStart + PICKER_PAGE_SIZE,
                    filteredPickerRows.length,
                  )}{" "}
                  / {filteredPickerRows.length} nhóm
                </span>
                <div className="flex items-center gap-sm">
                  <button
                    type="button"
                    className="hover:bg-surface-container-high rounded p-2 transition-colors disabled:opacity-30"
                    onClick={() => setPickerPage((p) => Math.max(1, p - 1))}
                    disabled={pickerSafePage <= 1}
                    aria-label="Trang trước"
                  >
                    <MaterialIcon name="chevron_left" />
                  </button>
                  <span className="text-on-surface px-md font-bold">
                    {pickerSafePage}/{pickerTotalPages}
                  </span>
                  <button
                    type="button"
                    className="hover:bg-surface-container-high rounded p-2 transition-colors disabled:opacity-30"
                    onClick={() =>
                      setPickerPage((p) => Math.min(pickerTotalPages, p + 1))
                    }
                    disabled={pickerSafePage >= pickerTotalPages}
                    aria-label="Trang sau"
                  >
                    <MaterialIcon name="chevron_right" />
                  </button>
                </div>
              </div>
            )}

            <div className="mt-lg flex items-center justify-between gap-sm">
              <span className="text-body-sm text-on-surface-variant">
                Đã chọn {pickedUrls.size}/{pickerRows.length} nhóm
              </span>
              <div className="flex items-center gap-sm">
                <button
                  type="button"
                  className="rounded-lg px-md py-sm text-sm font-bold uppercase text-on-surface-variant"
                  onClick={() => setPickerOpen(false)}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="bg-primary text-on-primary rounded-lg px-lg py-sm text-sm font-bold uppercase"
                  onClick={applyPickedGroups}
                >
                  Áp dụng nhóm đã chọn
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Facebook sub-form
function FacebookForm({ onSuccess }: { onSuccess?: () => void }) {
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<
    { name: string; url: string; Intent: string }[]
  >([]);
  const { user } = useAuthContext();
  const { isLoading, loadingMsg, submitCrawlData, result, cancelCrawl } =
    useCrawlFB(onSuccess);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(CrawlFb_Schemas),
    defaultValues: {
      isDefaultAccount: true,
      userName: user?.email || "",
      password: "",
      rows: [] as any[],
    },
  });

  const getFirstErrorMessage = (obj: any): string | null => {
    if (!obj) return null;
    if (obj.message && typeof obj.message === "string") return obj.message;
    for (const key in obj) {
      const f = getFirstErrorMessage(obj[key]);
      if (f) return f;
    }
    return null;
  };
  const firstErrorMsg = getFirstErrorMessage(errors);

  const handleSelectPresetGroups = (
    groups: { name: string; url: string; intent: string }[],
  ) => {
    const formatted = groups.map((g) => ({
      name: g.name,
      url: g.url,
      Intent: g.intent || "default",
    }));
    setSelectedGroups(formatted);
    setValue("rows", formatted, { shouldValidate: true });
  };

  const handleRemoveGroup = (idx: number) => {
    const next = selectedGroups.filter((_, i) => i !== idx);
    setSelectedGroups(next);
    setValue("rows", next, { shouldValidate: true });
  };

  const HandleOnsubmit = async (data: CrawlFb_form) => {
    if (selectedGroups.length === 0) {
      toast.error("Vui lòng chọn ít nhất một nhóm để cào dữ liệu.");
      return;
    }
    submitCrawlData(data);
  };

  return (
    <>
      {isLoading && (
        <FullScreenLoading
          title="Tiến trình đang chạy"
          content={loadingMsg}
          onCancel={cancelCrawl}
        />
      )}

      <form
        onSubmit={handleSubmit(HandleOnsubmit)}
        className="flex flex-col gap-md"
      >
        {/* Account setup section */}
        <div className="border border-outline-variant bg-surface-container-lowest rounded-xl p-md flex flex-col gap-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-sm">
            <h4 className="text-sm font-bold text-on-surface flex items-center gap-xs">
              <MaterialIcon
                name="settings"
                className="text-primary text-[18px]"
              />
              Cấu hình tài khoản cào Facebook
            </h4>
            <label className="flex items-center gap-xs cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={watch("isDefaultAccount")}
                {...register("isDefaultAccount")}
              />
              <span className="text-xs font-semibold text-on-surface-variant">
                Sử dụng tài khoản mặc định
              </span>
            </label>
          </div>

          {watch("isDefaultAccount") ? (
            <div className="bg-primary/5 border border-primary/30 rounded-lg p-md flex items-start gap-sm animate-fadeIn">
              <MaterialIcon
                name="check_circle"
                className="text-primary text-[20px] flex-shrink-0 mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-semibold text-primary">
                  Đang sử dụng tài khoản mặc định
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  Hệ thống sẽ tự động sử dụng phiên làm việc được lưu từ trước.
                  Không cần nhập tài khoản.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-md animate-fadeIn">
              <div className="flex flex-col gap-xs">
                <label htmlFor="fb-username" className={LABEL_CLS}>
                  Email / SĐT Facebook
                </label>
                <input
                  id="fb-username"
                  placeholder="Nhập email hoặc SĐT đăng nhập"
                  className={INPUT_CLS}
                  {...register("userName")}
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label htmlFor="fb-password" className={LABEL_CLS}>
                  Mật khẩu Facebook
                </label>
                <input
                  id="fb-password"
                  type="password"
                  placeholder="Nhập mật khẩu Facebook"
                  className={INPUT_CLS}
                  {...register("password")}
                />
              </div>
            </div>
          )}
        </div>

        {/* Selected Groups Section */}
        <div className="flex flex-col gap-xs">
          <label className={LABEL_CLS}>Nhóm Facebook cần cào</label>

          {selectedGroups.length === 0 ? (
            <div className="border border-dashed border-outline-variant rounded-xl p-lg text-center bg-surface-container-low/30">
              <p className="text-sm text-on-surface-variant">
                Chưa có nhóm Facebook nào được chọn.
              </p>
              <p className="text-[11px] text-on-surface-variant mt-1 opacity-70">
                Vui lòng nhấp vào nút "Chọn nhóm Facebook" bên dưới để thêm nhóm
                cần cào.
              </p>
            </div>
          ) : (
            <div className="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest max-h-[300px] overflow-y-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead className="bg-surface-container-low border-b border-outline-variant sticky top-0 z-10">
                  <tr>
                    <th className="px-md py-sm font-semibold text-on-surface-variant">
                      Tên Group
                    </th>
                    <th className="px-md py-sm font-semibold text-on-surface-variant">
                      URL
                    </th>
                    <th className="px-md py-sm w-[60px] text-center font-semibold text-on-surface-variant">
                      Xóa
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {selectedGroups.map((g, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-surface-container-low/40 transition-colors"
                    >
                      <td className="px-md py-sm font-medium text-on-surface">
                        {g.name}
                      </td>
                      <td
                        className="px-md py-sm text-xs text-on-surface-variant truncate max-w-[280px]"
                        title={g.url}
                      >
                        {g.url}
                      </td>
                      <td className="px-md py-sm text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveGroup(idx)}
                          className="text-red-500 hover:text-red-700 transition duration-150 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                          <RiDeleteBin6Line className="text-base" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-md">
          <button
            type="button"
            className={`${BTN_OUTLINE} px-md py-sm flex items-center gap-1`}
            onClick={() => setIsPresetModalOpen(true)}
          >
            <MaterialIcon name="playlist_add" className="text-[16px]" />
            Chọn nhóm Facebook
          </button>
        </div>

        {/* Error + submit */}
        <div className="flex items-center justify-between gap-md border-t border-outline-variant pt-md mt-sm">
          <p
            className={`text-body-sm ${firstErrorMsg ? "text-error font-medium" : "text-on-surface-variant"}`}
          >
            {firstErrorMsg ||
              "Vui lòng chọn nhóm và điền đầy đủ thông tin trước khi xử lý."}
          </p>
          <button type="submit" className={`${BTN_PRIMARY} px-lg`}>
            Xử lý dữ liệu
          </button>
        </div>
      </form>

      {result && <FacebookPosts mockPosts={result} />}

      <SelectPresetGroupsModal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        onSelectGroups={handleSelectPresetGroups}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────
// Combined component (exported – replaces CrawlFB_Form in page.tsx)
export default function CombinedCrawlForm({ onSuccess }: { onSuccess?: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("facebook");

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "facebook", label: "Facebook", icon: "groups" },
    { key: "linkedin", label: "LinkedIn", icon: "business_center" },
  ];

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-lg">
      <div className="mb-sm">
        <h1 className="text-h1 text-on-surface font-semibold">
          Crawl dữ liệu từ mạng xã hội
        </h1>
        <p className="text-body-md text-on-surface-variant mt-1">
          Thêm và quản lý groups cần crawl. Hệ thống tự động chạy theo lịch.
        </p>
      </div>

      <div className="border-outline-variant bg-surface flex flex-col gap-md overflow-hidden rounded-xl border shadow-sm">
        <div className="border-outline-variant bg-surface-container-low/60 flex items-center gap-sm border-b px-lg py-md">
          <span className="bg-primary text-on-primary flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
            2
          </span>
          <h2 className="text-label-md text-on-surface font-bold">
            Chọn nền tảng
          </h2>
          <span className="text-on-surface-variant text-body-sm ml-auto">
            Facebook hoặc LinkedIn
          </span>
        </div>

        <div className="px-lg pb-md pt-sm">
          <div className="flex w-fit items-center gap-xs rounded-lg border border-outline-variant bg-surface-container-low p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-xs rounded-md px-md py-xs text-sm font-bold transition-all ${
                  activeTab === tab.key
                    ? "bg-primary text-on-primary shadow-sm"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <MaterialIcon name={tab.icon} className="text-[18px]" />
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-md border-t border-outline-variant pt-md">
            <p className="text-label-md text-on-surface-variant mb-md font-bold uppercase">
              Cấu hình crawl
            </p>
            {activeTab === "linkedin" ? <LinkedInForm onSuccess={onSuccess} /> : <FacebookForm onSuccess={onSuccess} />}
          </div>
        </div>
      </div>
    </section>
  );
}
