"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformCategoriesService, allPlatformGroupsService, allPlatformUsersService } from "@/services/all-platform.service";
import type { ZaloCrawlerFlowValue } from "@/hooks/useZaloCrawlerFlow";

interface DomainItem {
  id: string;
  name: string;
}

interface GroupItem {
  id: string;
  name: string;
  domain: string;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
}

export interface ZaloEditAccountModalProps {
  open: boolean;
  account: ZaloCrawlerFlowValue["accounts"][number] | null;
  onClose: () => void;
  onSubmit: (data: {
    label: string;
    phone?: string;
    owner_name?: string;
    id_member?: string;
    sim_location: string;
    sim_location_detail?: string;
    domain_ids: string[];
    group_ids: string[];
  }) => Promise<void>;
}

const FALLBACK_DOMAINS: DomainItem[] = [
  { id: "it", name: "Công nghệ thông tin" },
  { id: "re", name: "Bất động sản" },
  { id: "build", name: "Xây dựng" },
  { id: "finance", name: "Tài chính" },
  { id: "education", name: "Giáo dục" },
];

const FALLBACK_GROUPS: GroupItem[] = [
  { id: "g1", name: "Cộng đồng IT Việt Nam", domain: "it" },
  { id: "g2", name: "An ninh mạng & SOC", domain: "it" },
  { id: "g3", name: "Hạ tầng Cloud & DevOps", domain: "it" },
  { id: "g4", name: "Đầu tư bất động sản", domain: "re" },
  { id: "g5", name: "Môi giới căn hộ", domain: "re" },
  { id: "g6", name: "Nhà thầu & Xây dựng", domain: "build" },
  { id: "g7", name: "Vật liệu xây dựng", domain: "build" },
  { id: "g8", name: "Tài chính doanh nghiệp", domain: "finance" },
  { id: "g9", name: "Kế toán & Thuế", domain: "finance" },
  { id: "g10", name: "Cộng đồng EdTech", domain: "education" },
];

export function ZaloEditAccountModal({ open, account, onClose, onSubmit }: ZaloEditAccountModalProps) {
  const { user } = useAppAuth();

  // Form states
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [simLocation, setSimLocation] = useState("owner");
  const [simLocationDetail, setSimLocationDetail] = useState("");

  // Scope states
  const [domains, setDomains] = useState<DomainItem[]>(FALLBACK_DOMAINS);
  const [groups, setGroups] = useState<GroupItem[]>(FALLBACK_GROUPS);
  const [selectedDomainIds, setSelectedDomainIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Dropdown UI states
  const [isDomainOpen, setIsDomainOpen] = useState(false);
  const [isGroupOpen, setIsGroupOpen] = useState(false);
  const [domainSearch, setDomainSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Staff list
  const [staffList, setStaffList] = useState<UserOption[]>([]);

  const domainPickerRef = useRef<HTMLDivElement>(null);
  const groupPickerRef = useRef<HTMLDivElement>(null);

  // Pre-fill account data whenever account changes or modal opens
  useEffect(() => {
    if (!open || !account) return;

    const accAny = account as any;
    setName(account.label || "");
    setPhone(account.phone || "");
    setOwnerId(accAny.id_member || account.owner_id || user?.id || "");
    setOwnerName(accAny.owner_name || "");
    setSimLocation(accAny.sim_location || "owner");
    setSimLocationDetail(accAny.sim_location_detail || "");
    setSelectedDomainIds(new Set(accAny.assigned_domains || []));
    setSelectedGroupIds(new Set(accAny.assigned_groups || []));
    setWarningMsg(null);
    setStatusMsg(null);
  }, [open, account, user]);

  // Load staff & categories & groups
  useEffect(() => {
    if (!open) return;

    allPlatformUsersService
      .getAllProfiles()
      .then((res: any) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const list = res.data.map((u: any) => ({
            id: u.id || u.user_id || u.email,
            name: u.name || u.display_name || u.email,
            email: u.email || "",
          }));
          setStaffList(list);
        } else {
          setStaffList([
            { id: user?.id || "u1", name: user?.name || "Nguyễn Minh Anh", email: user?.email || "minhanh@markeeai.com" },
            { id: "u2", name: "Trần Hoàng Nam", email: "namth@markeeai.com" },
            { id: "u3", name: "Lê Thu Hà", email: "halt@markeeai.com" },
          ]);
        }
      })
      .catch(() => {
        setStaffList([
          { id: user?.id || "u1", name: user?.name || "Nguyễn Minh Anh", email: user?.email || "minhanh@markeeai.com" },
          { id: "u2", name: "Trần Hoàng Nam", email: "namth@markeeai.com" },
          { id: "u3", name: "Lê Thu Hà", email: "halt@markeeai.com" },
        ]);
      });

    allPlatformCategoriesService
      .getAll()
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const liveDomains = res.data.map((c) => ({
            id: c.id,
            name: c.name || c.code,
          }));
          setDomains(liveDomains);
        }
      })
      .catch(() => {});

    allPlatformGroupsService
      .getAll("facebook")
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const liveGroups = res.data.slice(0, 50).map((g) => ({
            id: g.id,
            name: (g as any).group_name || (g as any).name || "Nhóm",
            domain: (g as any).category_id || (g as any).intent || "it",
          }));
          setGroups((prev) => [...liveGroups, ...prev.filter((p) => !liveGroups.some((l) => l.id === p.id))]);
        }
      })
      .catch(() => {});
  }, [open, user]);

  // Click outside to close pickers
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (domainPickerRef.current && !domainPickerRef.current.contains(e.target as Node)) {
        setIsDomainOpen(false);
      }
      if (groupPickerRef.current && !groupPickerRef.current.contains(e.target as Node)) {
        setIsGroupOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredDomains = useMemo(() => {
    const q = domainSearch.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.name.toLowerCase().includes(q));
  }, [domains, domainSearch]);

  const eligibleGroups = useMemo(() => {
    if (selectedDomainIds.size === 0) return [];
    return groups.filter((g) => selectedDomainIds.has(g.domain));
  }, [groups, selectedDomainIds]);

  const filteredEligibleGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return eligibleGroups;
    return eligibleGroups.filter((g) => g.name.toLowerCase().includes(q));
  }, [eligibleGroups, groupSearch]);

  const handleToggleDomain = (domainId: string) => {
    const nextDomains = new Set(selectedDomainIds);
    if (nextDomains.has(domainId)) {
      nextDomains.delete(domainId);
    } else {
      nextDomains.add(domainId);
    }
    setSelectedDomainIds(nextDomains);

    const nextGroups = new Set<string>();
    let prunedCount = 0;
    selectedGroupIds.forEach((gid) => {
      const g = groups.find((item) => item.id === gid);
      if (g && nextDomains.has(g.domain)) {
        nextGroups.add(gid);
      } else {
        prunedCount++;
      }
    });

    setSelectedGroupIds(nextGroups);
    if (prunedCount > 0) {
      setWarningMsg(`Đã bỏ ${prunedCount} Group không còn thuộc lĩnh vực được chọn.`);
    } else {
      setWarningMsg(null);
    }
  };

  const handleToggleGroup = (groupId: string) => {
    const nextGroups = new Set(selectedGroupIds);
    if (nextGroups.has(groupId)) {
      nextGroups.delete(groupId);
    } else {
      nextGroups.add(groupId);
    }
    setSelectedGroupIds(nextGroups);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setStatusMsg({ text: "Vui lòng nhập tên tài khoản Zalo.", isError: true });
      return;
    }

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      await onSubmit({
        label: name.trim(),
        phone: phone.trim() || undefined,
        owner_name: ownerName || undefined,
        id_member: ownerId || undefined,
        sim_location: simLocation,
        sim_location_detail: simLocation === "other" ? simLocationDetail.trim() : undefined,
        domain_ids: Array.from(selectedDomainIds),
        group_ids: Array.from(selectedGroupIds),
      });
      onClose();
    } catch (err: any) {
      setStatusMsg({
        text: err?.message || "Không thể cập nhật tài khoản. Vui lòng thử lại.",
        isError: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open || !account) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-surface border border-outline-variant rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-50 to-red-100/70 border border-red-200 flex items-center justify-center text-primary shadow-xs">
              <span className="material-symbols-outlined text-[20px]">edit</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-on-surface">Chỉnh sửa tài khoản Zalo</h3>
              <p className="text-xs text-on-surface-variant">Cập nhật nhận diện, nhân sự quản lý, vị trí SIM và phạm vi nhóm</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface h-8 w-8 rounded-lg hover:bg-surface-container-low transition flex items-center justify-center cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* Status Message */}
          {statusMsg && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 ${
                statusMsg.isError
                  ? "bg-red-50 border-red-200 text-red-700 font-medium"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium"
              }`}
            >
              <span className="material-symbols-outlined text-[18px] shrink-0">
                {statusMsg.isError ? "error" : "check_circle"}
              </span>
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Warning Message */}
          {warningMsg && (
            <div className="p-3 rounded-xl border bg-amber-50 border-amber-200 text-amber-800 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-600 shrink-0">warning</span>
              <span>{warningMsg}</span>
            </div>
          )}

          {/* Account ID badge */}
          <div className="bg-surface-container-low rounded-xl p-3 border border-outline-variant/60 flex items-center justify-between text-xs">
            <span className="text-on-surface-variant font-medium">Mã tài khoản hệ thống:</span>
            <span className="font-mono font-bold text-primary bg-surface px-2.5 py-1 rounded-md border border-outline-variant">
              {account.account_id}
            </span>
          </div>

          {/* SECTION 1: Nhận diện cơ bản */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-1.5 font-bold text-[13px] text-on-surface border-b border-outline-variant/50 pb-1.5">
              <span className="material-symbols-outlined text-primary text-[16px]">badge</span>
              <span>Nhận diện cơ bản</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-on-surface mb-1">
                  Tên tài khoản <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vd: Markee, Chăm Sóc KH 01..."
                  className="w-full h-9 px-3 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">
                  Số điện thoại Zalo
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Vd: 0912 345 678"
                  className="w-full h-9 px-3 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Phân công nhân sự & Vị trí SIM */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-1.5 font-bold text-[13px] text-on-surface border-b border-outline-variant/50 pb-1.5">
              <span className="material-symbols-outlined text-primary text-[16px]">person</span>
              <span>Phân công nhân sự & Thiết bị</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-on-surface mb-1">
                  Nhân sự phụ trách
                </label>
                <select
                  value={ownerId}
                  onChange={(e) => {
                    const selId = e.target.value;
                    setOwnerId(selId);
                    const found = staffList.find((s) => s.id === selId);
                    setOwnerName(found?.name || "");
                  }}
                  className="w-full h-9 px-3 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="">-- Chưa gán nhân sự --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-on-surface mb-1">
                  Vị trí giữ SIM vật lý
                </label>
                <select
                  value={simLocation}
                  onChange={(e) => setSimLocation(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="owner">Máy người phụ trách</option>
                  <option value="office">Máy công ty tại văn phòng</option>
                  <option value="other">Vị trí khác...</option>
                </select>
              </div>
            </div>

            {simLocation === "other" && (
              <div>
                <label className="block font-semibold text-on-surface mb-1">
                  Mô tả vị trí SIM chi tiết
                </label>
                <input
                  type="text"
                  value={simLocationDetail}
                  onChange={(e) => setSimLocationDetail(e.target.value)}
                  placeholder="Vd: Tủ SIM tầng 3, Server box..."
                  className="w-full h-9 px-3 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none transition-all"
                />
              </div>
            )}
          </div>

          {/* SECTION 3: Phạm vi phụ trách (Lĩnh vực & Nhóm) */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-1.5 font-bold text-[13px] text-on-surface border-b border-outline-variant/50 pb-1.5">
              <span className="material-symbols-outlined text-primary text-[16px]">hub</span>
              <span>Phạm vi phụ trách (Lĩnh vực & Nhóm)</span>
            </div>

            {/* Domain Picker */}
            <div className="relative" ref={domainPickerRef}>
              <label className="block font-semibold text-on-surface mb-1">
                Lĩnh vực phụ trách ({selectedDomainIds.size})
              </label>
              <div
                onClick={() => setIsDomainOpen(!isDomainOpen)}
                className="min-h-9 px-3 py-1.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs flex items-center justify-between gap-2 cursor-pointer hover:border-primary/50 transition-all"
              >
                <div className="flex flex-wrap gap-1 items-center flex-1">
                  {selectedDomainIds.size === 0 ? (
                    <span className="text-on-surface-variant">Chọn lĩnh vực phụ trách...</span>
                  ) : (
                    Array.from(selectedDomainIds).map((id) => {
                      const d = domains.find((item) => item.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-primary border border-red-200 text-[11px] font-semibold"
                        >
                          {d?.name || id}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleDomain(id);
                            }}
                            className="hover:text-red-700 cursor-pointer inline-flex items-center"
                          >
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
                  {isDomainOpen ? "expand_less" : "expand_more"}
                </span>
              </div>

              {/* Domain Dropdown */}
              {isDomainOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-outline-variant rounded-xl shadow-xl z-30 p-2 space-y-1 max-h-48 overflow-y-auto">
                  <input
                    type="text"
                    value={domainSearch}
                    onChange={(e) => setDomainSearch(e.target.value)}
                    placeholder="Tìm kiếm lĩnh vực..."
                    className="w-full h-8 px-2.5 rounded-lg border border-outline-variant bg-surface-container-low text-xs mb-1 focus:outline-none focus:border-primary"
                  />
                  {filteredDomains.map((d) => (
                    <div
                      key={d.id}
                      onClick={() => handleToggleDomain(d.id)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container-low cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDomainIds.has(d.id)}
                        onChange={() => {}}
                        className="rounded border-outline-variant text-primary focus:ring-primary"
                      />
                      <span className="text-xs text-on-surface">{d.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Group Picker */}
            <div className="relative" ref={groupPickerRef}>
              <label className="block font-semibold text-on-surface mb-1">
                Nhóm khách hàng phụ trách ({selectedGroupIds.size})
              </label>
              <div
                onClick={() => {
                  if (selectedDomainIds.size === 0) {
                    setWarningMsg("Vui lòng chọn ít nhất 1 Lĩnh vực trước khi chọn Nhóm.");
                    return;
                  }
                  setIsGroupOpen(!isGroupOpen);
                }}
                className={`min-h-9 px-3 py-1.5 rounded-xl border border-outline-variant bg-surface text-on-surface text-xs flex items-center justify-between gap-2 cursor-pointer transition-all ${
                  selectedDomainIds.size === 0 ? "opacity-60 cursor-not-allowed bg-surface-container-low" : "hover:border-primary/50"
                }`}
              >
                <div className="flex flex-wrap gap-1 items-center flex-1">
                  {selectedDomainIds.size === 0 ? (
                    <span className="text-on-surface-variant italic">Chọn lĩnh vực trước để mở khóa danh sách nhóm</span>
                  ) : selectedGroupIds.size === 0 ? (
                    <span className="text-on-surface-variant">Chọn các nhóm cần phụ trách...</span>
                  ) : (
                    Array.from(selectedGroupIds).map((id) => {
                      const g = groups.find((item) => item.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold"
                        >
                          {g?.name || id}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleGroup(id);
                            }}
                            className="hover:text-blue-900 cursor-pointer inline-flex items-center"
                          >
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        </span>
                      );
                    })
                  )}
                </div>
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
                  {isGroupOpen ? "expand_less" : "expand_more"}
                </span>
              </div>

              {/* Group Dropdown */}
              {isGroupOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-surface border border-outline-variant rounded-xl shadow-xl z-30 p-2 space-y-1 max-h-48 overflow-y-auto">
                  <input
                    type="text"
                    value={groupSearch}
                    onChange={(e) => setGroupSearch(e.target.value)}
                    placeholder="Tìm kiếm nhóm..."
                    className="w-full h-8 px-2.5 rounded-lg border border-outline-variant bg-surface-container-low text-xs mb-1 focus:outline-none focus:border-primary"
                  />
                  {filteredEligibleGroups.length === 0 ? (
                    <div className="p-2 text-center text-on-surface-variant text-[11px] italic">
                      Không có nhóm nào thuộc các lĩnh vực đã chọn.
                    </div>
                  ) : (
                    filteredEligibleGroups.map((g) => (
                      <div
                        key={g.id}
                        onClick={() => handleToggleGroup(g.id)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container-low cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroupIds.has(g.id)}
                          onChange={() => {}}
                          className="rounded border-outline-variant text-primary focus:ring-primary"
                        />
                        <span className="text-xs text-on-surface">{g.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-outline-variant sticky bottom-0 bg-surface">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-9 px-4 rounded-xl border border-outline-variant bg-surface text-on-surface font-semibold hover:bg-surface-container-low transition cursor-pointer text-xs"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="h-9 px-5 rounded-xl bg-primary hover:bg-red-700 text-white font-bold transition shadow-sm shadow-red-500/20 disabled:opacity-50 cursor-pointer text-xs inline-flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">save</span>
                  <span>Lưu thay đổi</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
