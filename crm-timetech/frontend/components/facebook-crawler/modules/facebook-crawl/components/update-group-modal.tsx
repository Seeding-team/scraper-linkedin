"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { FaLink, FaUsers, FaTags, FaInfoCircle } from "react-icons/fa";
import { FacebookGroupDTO } from "../types/data-fb.type";
import { useUpdateGroup } from "../hooks/use-update-group";
import { useGetIntents } from "../hooks/use-get-intents";
import { MaterialIcon } from "@/components/ui";
import { GroupTaxonomyFields } from "@/components/features/shared/GroupTaxonomyFields";
import { detectPlatformFromUrl } from "@/lib/group-taxonomy";

// Schema validation
const UpdateGroupSchema = z.object({
  group_name: z.string().min(1, "Tên group không được trống"),
  url: z.string().url("URL không hợp lệ"),
  intent: z.string().optional(),
  members: z.number().optional(),
  status: z.enum(["ACTIVE", "IDLE", "DEAD"]).optional(),
  industry: z.string().optional(),
  tier: z.number().optional(),
  team: z.string().optional(),
  icp: z.string().optional(),
  icp_desc: z.string().optional(),
});

type UpdateGroupFormData = z.infer<typeof UpdateGroupSchema>;

interface UpdateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: FacebookGroupDTO | null;
  onSuccess: () => void;
}

export function UpdateGroupModal({
  isOpen,
  onClose,
  group,
  onSuccess,
}: UpdateGroupModalProps) {
  const { intents } = useGetIntents();

  const {
    updateGroup,
    isUpdating,
    error: updateError,
    reset,
  } = useUpdateGroup();
  const [successMessage, setSuccessMessage] = useState("");

  const {
    register,
    handleSubmit,
    reset: formReset,
    formState: { errors },
    setValue,
    watch,
  } = useForm<UpdateGroupFormData>({
    resolver: zodResolver(UpdateGroupSchema),
  });

  // Set form values khi group thay đổi
  useEffect(() => {
    if (group && isOpen) {
      setValue("group_name", group.group_name || "");
      setValue("url", group.url || "");
      setValue("intent", group.intent || "");
      setValue("members", group.members || undefined);
      setValue("status", group.status || "ACTIVE");
      setValue("industry", group.industry || "");
      const tierNum =
        typeof group.tier === "number" && group.tier >= 1 && group.tier <= 3
          ? group.tier
          : undefined;
      if (tierNum != null) setValue("tier", tierNum);
      else setValue("tier", undefined);
      const teamStr = Array.isArray(group.team)
        ? group.team.join(", ")
        : typeof group.team === "string"
          ? group.team
          : "";
      const icpStr = Array.isArray(group.icp)
        ? group.icp.join(", ")
        : typeof group.icp === "string"
          ? group.icp
          : "";
      setValue("team", teamStr);
      setValue("icp", icpStr);
      setValue("icp_desc", group.icp_desc || "");
      setSuccessMessage("");
    }
  }, [group, isOpen, setValue]);

  const onSubmit = async (data: UpdateGroupFormData) => {
    if (!group) return;

    updateGroup(
      {
        group_url: group.url,
        _originalGroup: group,
        ...data,
      },
      {
        onSuccess: () => {
          setSuccessMessage("✅ Cập nhật group thành công!");
          setTimeout(() => {
            formReset();
            onClose();
            onSuccess();
          }, 1500);
        },
      },
    );
  };

  if (!isOpen || !group) return null;

  const isLinkedIn =
    group.platform === "linkedin" ||
    detectPlatformFromUrl(group.url) === "linkedin";
  const industry = watch("industry") ?? "";
  const tier = watch("tier") ?? "";
  const team = watch("team") ?? "";
  const icp = watch("icp") ?? "";
  const icp_desc = watch("icp_desc") ?? "";

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[1px] flex items-center justify-center z-50 p-md overflow-y-auto">
      <div
        className="bg-surface border border-outline-variant rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col my-auto relative"
        role="dialog"
        aria-modal="true"
      >
        {/* Nút đóng */}
        <button
          type="button"
          onClick={() => {
            formReset();
            onClose();
            reset();
          }}
          className="absolute top-lg right-lg text-on-surface-variant hover:text-error rounded p-1 transition-colors z-10"
          aria-label="Đóng"
        >
          <MaterialIcon name="close" className="text-[22px]" />
        </button>

        {/* Header */}
        <div className="p-lg border-b border-outline-variant bg-surface-container-low shrink-0 pr-10">
          <h3 className="text-h3 text-on-surface font-semibold">
            Cập nhật Group
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Chỉnh sửa thông tin nhóm {isLinkedIn ? "LinkedIn" : "Facebook"}
          </p>
        </div>

        {/* Form Body - Scrollable */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="p-lg space-y-md overflow-y-auto flex-1">
            {/* Success Message */}
            {successMessage && (
              <div className="p-sm bg-secondary-container/20 border border-secondary-container text-on-secondary-container rounded-lg text-sm font-medium">
                {successMessage}
              </div>
            )}

            {/* Error Message */}
            {updateError && (
              <div className="p-sm bg-error-container/40 border border-error-container text-error rounded-lg text-sm font-medium">
                ❌ {updateError.message}
              </div>
            )}

            <div className="grid md:grid-cols-3 gap-lg">
              {/* CỘT TRÁI: THÔNG TIN CHÍNH */}
              <div className="md:col-span-2 flex flex-col gap-base">
                {/* Nền tảng (Platform) */}
                <div>
                  <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                    Nền tảng (Platform)
                  </label>
                  <input
                    type="text"
                    value={isLinkedIn ? "LinkedIn" : "Facebook"}
                    className="w-full mt-1 px-md py-sm bg-surface-container-low border border-outline-variant text-on-surface-variant rounded-lg text-sm outline-none cursor-not-allowed"
                    readOnly
                    disabled
                  />
                </div>

                {/* URL Group */}
                <div>
                  <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                    URL <span className="text-error">*</span>
                  </label>
                  <div className="relative mt-1">
                    <div className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                      <FaLink className="text-base" />
                    </div>
                    <input
                      type="url"
                      {...register("url")}
                      className="w-full pl-9 pr-md py-sm bg-surface-container-low border border-outline-variant text-on-surface-variant rounded-lg text-sm outline-none cursor-not-allowed"
                      placeholder="https://..."
                      readOnly
                      title="Không thể sửa URL"
                    />
                  </div>
                  {errors.url && (
                    <p className="text-xs text-error font-medium mt-1">
                      {errors.url.message}
                    </p>
                  )}
                </div>

                {/* Tên Group */}
                <div>
                  <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                    Tên Group <span className="text-error">*</span>
                  </label>
                  <div className="relative mt-1">
                    <div className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                      <FaUsers className="text-base" />
                    </div>
                    <input
                      type="text"
                      {...register("group_name")}
                      className="w-full pl-9 pr-md py-sm bg-surface border border-outline-variant text-on-surface rounded-lg text-sm outline-none focus:border-primary transition-colors"
                      placeholder="Nhập tên group"
                    />
                  </div>
                  {errors.group_name && (
                    <p className="text-xs text-error font-medium mt-1">
                      {errors.group_name.message}
                    </p>
                  )}
                </div>

                {/* Intent & Status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
                  <div>
                    <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                      Mục đích (Intent)
                    </label>
                    <div className="relative mt-1">
                      <div className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                        <FaTags className="text-base" />
                      </div>
                      <select
                        {...register("intent")}
                        className="w-full pl-9 pr-md py-sm bg-surface border border-outline-variant text-on-surface rounded-lg text-sm outline-none focus:border-primary transition-colors appearance-none cursor-pointer"
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

                  {!isLinkedIn ? (
                    <div>
                      <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                        Trạng thái
                      </label>
                      <select
                        {...register("status")}
                        className="w-full mt-1 px-md py-sm bg-surface border border-outline-variant text-on-surface rounded-lg text-sm outline-none focus:border-primary cursor-pointer transition-colors"
                      >
                        <option value="ACTIVE">Sống</option>
                        <option value="IDLE">Ít HĐ</option>
                        <option value="DEAD">Chết</option>
                      </select>
                    </div>
                  ) : null}
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
                    disabled={isUpdating}
                  />
                </div>
              </div>

              {/* CỘT PHẢI: THIẾT LẬP PHỤ */}
              <div>
                <div className="bg-surface-container-low p-md rounded-xl border border-outline-variant">
                  <h4 className="text-label-md text-on-surface font-bold uppercase flex items-center gap-2 mb-md">
                    <FaInfoCircle className="text-primary text-base" />
                    Chỉ số & Thống kê
                  </h4>

                  <div className="flex flex-col gap-base">
                    <div>
                      <label className="text-label-md text-on-surface-variant font-semibold uppercase">
                        Số thành viên
                      </label>
                      <input
                        type="number"
                        {...register("members", { valueAsNumber: true })}
                        className="mt-1 w-full px-md py-sm bg-surface border border-outline-variant text-on-surface rounded-lg text-sm outline-none focus:border-primary transition-colors"
                        placeholder="VD: 5000"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-lg pt-md border-t border-outline-variant bg-surface-container-low flex flex-col sm:flex-row justify-between items-center gap-md p-lg">
            <p className="text-body-sm text-on-surface-variant">
              Vui lòng điền đầy đủ các thông tin bắt buộc (*) trước khi lưu.
            </p>

            <div className="flex gap-sm w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  formReset();
                  onClose();
                  reset();
                }}
                className="flex-1 sm:flex-none rounded-lg px-md py-sm text-sm font-bold uppercase text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="flex-1 sm:flex-none bg-primary text-on-primary hover:bg-primary/90 rounded-lg px-lg py-sm text-sm font-bold uppercase transition-colors disabled:opacity-50"
              >
                {isUpdating ? "Đang xử lý…" : "Cập nhật"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
