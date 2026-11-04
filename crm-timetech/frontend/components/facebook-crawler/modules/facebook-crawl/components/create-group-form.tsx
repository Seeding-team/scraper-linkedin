"use client";

import React, { useEffect, useState } from "react";
import {
  FaFacebook,
  FaLinkedin,
  FaLink,
  FaUsers,
  FaTags,
  FaInfoCircle,
} from "react-icons/fa";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  CreateGroupSchema,
  CreateGroupPayload,
  initialCreateGroupData,
} from "../schemas/create_groups_shemas";
import { useCreateGroup } from "../hooks/use-create-groups";
import { useGetIntents } from "../hooks/use-get-intents";
import FullScreenLoading from "../../../shared/components/layout/FullScreenLoading";
import { MaterialIcon } from "@/components/ui";
import { GroupTaxonomyFields } from "@/components/features/shared/GroupTaxonomyFields";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { detectPlatformFromUrl } from "@/lib/group-taxonomy";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";

// 1. Định nghĩa Props để nhận tín hiệu từ component cha
interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateGroupModal({
  isOpen,
  onClose,
}: CreateGroupModalProps) {
  // Hooks
  const { intents, fetchIntents } = useGetIntents();
  const { isLoading, submitGroupData } = useCreateGroup();
  const d = useDashboard();
  const { platform: appPlatform } = useAppPlatform();

  const [intentOption, setIntentOption] = useState("");
  const [intentCustom, setIntentCustom] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(CreateGroupSchema),
    defaultValues: initialCreateGroupData,
  });

  const currentUrl = watch("link_group");
  const selectedPlatform = watch("platform");

  // Tự động detect platform từ URL khi paste vào
  useEffect(() => {
    if (currentUrl) {
      const detected = detectPlatformFromUrl(currentUrl);
      if (detected === "linkedin" || detected === "facebook") {
        setValue("platform", detected);
      }
    }
  }, [currentUrl, setValue]);

  // Fetch dữ liệu Intents khi load trang và reset states
  useEffect(() => {
    if (isOpen) {
      fetchIntents();
      setValue(
        "platform",
        appPlatform === "linkedin" ? "linkedin" : "facebook",
      );
      setIntentOption("");
      setIntentCustom("");
    }
  }, [isOpen, fetchIntents, appPlatform, setValue]);

  // Đồng bộ giá trị intent khi option hoặc custom text thay đổi
  useEffect(() => {
    if (intentOption === "Khác") {
      setValue("intent", intentCustom.trim());
    } else {
      setValue("intent", intentOption);
    }
  }, [intentOption, intentCustom, setValue]);

  // Xử lý logic submit
  const handleOnSubmit = async (data: CreateGroupPayload) => {
    const finalIntent =
      intentOption === "Khác" ? intentCustom.trim() : intentOption;
    const responseData = await submitGroupData({
      ...data,
      intent: finalIntent,
    });

    // Nếu API trả về dữ liệu thành công -> Reset form và đóng Modal
    if (responseData) {
      reset();
      setIntentOption("");
      setIntentCustom("");
      onClose();
    }
  };

  // Hàm lấy lỗi đầu tiên
  const getFirstErrorMessage = (errorsObj: any): string | null => {
    if (!errorsObj) return null;
    if (errorsObj.message && typeof errorsObj.message === "string") {
      return errorsObj.message;
    }
    for (const key in errorsObj) {
      const found = getFirstErrorMessage(errorsObj[key]);
      if (found) return found;
    }
    return null;
  };

  const firstErrorMsg = getFirstErrorMessage(errors);
  const isLinkedIn = selectedPlatform === "linkedin";
  const platform = isLinkedIn ? "LinkedIn" : "Facebook";
  const industry = watch("industry") ?? "";
  const tier = watch("tier") ?? "";
  const team = watch("team") ?? "";
  const icp = watch("icp") ?? "";
  const icp_desc = watch("icp_desc") ?? "";

  // 2. Nếu cha truyền isOpen = false thì không render gì cả
  if (!isOpen) return null;

  return (
    <>
      {isLoading && (
        <FullScreenLoading
          title="Tiến trình đang chạy"
          content="Đang khởi tạo nhóm, vui lòng chờ..."
          onCancel={onClose}
        />
      )}

      {/* Overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px] p-md overflow-y-auto">
        {/* Dialog container — khớp style LinkedIn modals */}
        <div
          className="border-outline-variant bg-surface relative z-10 w-full max-w-4xl mx-auto rounded-xl border p-lg shadow-xl my-auto overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-group-modal-title"
        >
          {/* Nút đóng */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-lg right-lg text-on-surface-variant hover:text-error rounded p-1 transition-colors z-10"
            aria-label="Đóng"
          >
            <MaterialIcon name="close" className="text-[22px]" />
          </button>

          {/* Header */}
          <div className="mb-lg border-b border-outline-variant pb-md pr-10">
            <h3
              id="create-group-modal-title"
              className="text-h3 text-on-surface font-semibold"
            >
              Thêm Group Mới
            </h3>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              Đăng ký các nhóm Facebook hoặc LinkedIn vào hệ thống
            </p>
          </div>

          <form onSubmit={handleSubmit(handleOnSubmit)}>
            <div className="space-y-base max-h-[60vh] overflow-y-auto py-base">
              <div className="grid md:grid-cols-3 gap-lg">
                {/* CỘT TRÁI: THÔNG TIN CHÍNH */}
                <div className="md:col-span-2 flex flex-col gap-base">
                  {/* Nền tảng (Platform) */}
                  <div>
                    <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                      Nền tảng (Platform) <span className="text-error">*</span>
                    </label>
                    <div className="relative mt-1">
                      <select
                        className="w-full px-md py-sm bg-surface border border-outline-variant text-on-surface rounded-lg text-sm outline-none focus:border-primary transition-colors appearance-none cursor-pointer"
                        {...register("platform")}
                      >
                        <option value="facebook">Facebook</option>
                        <option value="linkedin">LinkedIn</option>
                      </select>
                    </div>
                  </div>

                  {/* URL Group */}
                  <div>
                    <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                      Link URL Group <span className="text-error">*</span>
                    </label>
                    <div className="relative mt-1">
                      <div className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                        {currentUrl ? (
                          platform === "LinkedIn" ? (
                            <FaLinkedin className="text-blue-700 text-base" />
                          ) : (
                            <FaFacebook className="text-blue-600 text-base" />
                          )
                        ) : (
                          <FaLink className="text-base" />
                        )}
                      </div>
                      <input
                        placeholder={
                          isLinkedIn
                            ? "https://www.linkedin.com/groups/..."
                            : "https://www.facebook.com/groups/..."
                        }
                        className={`w-full pl-9 pr-md py-sm bg-surface border rounded-lg text-sm outline-none transition-colors ${
                          errors.link_group
                            ? "border-error text-error focus:border-error"
                            : "border-outline-variant text-on-surface focus:border-primary"
                        }`}
                        {...register("link_group")}
                      />
                    </div>
                  </div>

                  {/* Tên Group */}
                  <div>
                    <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                      Tên hiển thị Group <span className="text-error">*</span>
                    </label>
                    <div className="relative mt-1">
                      <div className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                        <FaUsers className="text-base" />
                      </div>
                      <input
                        placeholder="Ví dụ: Cộng đồng Frontend Việt Nam"
                        className={`w-full pl-9 pr-md py-sm bg-surface border rounded-lg text-sm outline-none transition-colors ${
                          errors.group_name
                            ? "border-error text-error focus:border-error"
                            : "border-outline-variant text-on-surface focus:border-primary"
                        }`}
                        {...register("group_name")}
                      />
                    </div>
                  </div>

                  {/* Intent & Thành viên */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
                    <div>
                      <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                        Mục đích (Intent) <span className="text-error">*</span>
                      </label>
                      <div className="relative mt-1">
                        <div className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                          <FaTags className="text-base" />
                        </div>
                        <select
                          className={`w-full pl-9 pr-md py-sm bg-surface border rounded-lg text-sm outline-none transition-colors appearance-none cursor-pointer ${
                            errors.intent
                              ? "border-error text-error focus:border-error"
                              : "border-outline-variant text-on-surface focus:border-primary"
                          }`}
                          value={intentOption}
                          onChange={(e) => setIntentOption(e.target.value)}
                        >
                          <option value="">-- Chọn kịch bản --</option>
                          {intents?.map(
                            (
                              item: { value: string; name: string },
                              index: number,
                            ) => (
                              <option key={index} value={item.value}>
                                {item.name}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                        Số lượng thành viên
                      </label>
                      <input
                        type="number"
                        placeholder="Vd: 5000"
                        className="mt-1 w-full px-md py-sm bg-surface border border-outline-variant text-on-surface rounded-lg text-sm outline-none transition-colors focus:border-primary"
                        {...register("members")}
                      />
                    </div>
                  </div>

                  <div className="border-outline-variant mt-xs border-t pt-base">
                    <GroupTaxonomyFields
                      industry={industry}
                      tier={typeof tier === "number" ? tier : ""}
                      team={team}
                      icp={icp}
                      icp_desc={icp_desc}
                      onIndustryChange={(v) => setValue("industry", v)}
                      onTierChange={(v) =>
                        setValue("tier", v === "" ? undefined : v)
                      }
                      onTeamChange={(v) => setValue("team", v)}
                      onIcpChange={(v) => setValue("icp", v)}
                      onIcpDescChange={(v) => setValue("icp_desc", v)}
                      disabled={isLoading}
                    />
                    {isLinkedIn && !d.email.trim() ? (
                      <p className="text-error mt-sm text-xs" role="alert">
                        Cần email LinkedIn (Crawler trực tiếp) để lưu nhóm.
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* CỘT PHẢI: THIẾT LẬP PHỤ */}
                <div>
                  <div className="bg-surface-container-low p-md rounded-xl border border-outline-variant">
                    <h4 className="text-label-md text-on-surface font-bold uppercase flex items-center gap-2 mb-md">
                      <FaInfoCircle className="text-primary text-base" />
                      Cấu hình bổ sung
                    </h4>

                    <div className="flex flex-col gap-base">
                      <div className="flex items-center justify-between">
                        <span className="text-body-sm text-on-surface font-semibold">
                          Quét liên tục 24h
                        </span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            {...register("chay_24h")}
                          />
                          <div className="w-11 h-6 bg-surface-container peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-outline-variant after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-lg pt-md border-t border-outline-variant flex flex-col sm:flex-row justify-between items-center gap-md">
              <p
                className={`text-body-sm transition-colors ${firstErrorMsg ? "text-error font-medium" : "text-on-surface-variant"}`}
              >
                {firstErrorMsg ||
                  "Vui lòng điền đầy đủ các thông tin bắt buộc (*) trước khi lưu."}
              </p>

              <div className="flex gap-sm w-full sm:w-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-none rounded-lg px-md py-sm text-sm font-bold uppercase text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="flex-1 sm:flex-none bg-primary text-on-primary hover:bg-primary/90 rounded-lg px-lg py-sm text-sm font-bold uppercase transition-colors disabled:opacity-50"
                >
                  {isLoading ? "Đang lưu…" : "Lưu Group"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
