"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { allPlatformCategoriesService, allPlatformGroupsService, allPlatformUsersService } from "@/services/all-platform.service";

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

interface ZaloAddAccountModalProps {
  open: boolean;
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

export function ZaloAddAccountModal({ open, onClose, onSubmit }: ZaloAddAccountModalProps) {
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

  // Load staff & categories & groups
  useEffect(() => {
    if (!open) return;

    // Load staff
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

    // Default owner to current logged-in user
    if (user?.id) {
      setOwnerId(user.id);
      setOwnerName(user.name || user.email || "");
    }

    // Load categories
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

    // Load live groups
    allPlatformGroupsService
      .getAll("facebook")
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const liveGroups = res.data.slice(0, 30).map((g) => ({
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

  // Filtered domains
  const filteredDomains = useMemo(() => {
    const q = domainSearch.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.name.toLowerCase().includes(q));
  }, [domains, domainSearch]);

  // Eligible groups for selected domains
  const eligibleGroups = useMemo(() => {
    if (selectedDomainIds.size === 0) return [];
    return groups.filter((g) => selectedDomainIds.has(g.domain));
  }, [groups, selectedDomainIds]);

  // Filtered eligible groups
  const filteredEligibleGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return eligibleGroups;
    return eligibleGroups.filter((g) => g.name.toLowerCase().includes(q));
  }, [eligibleGroups, groupSearch]);

  // Handle toggle domain with cascading cleanup
  const handleToggleDomain = (domainId: string) => {
    const nextDomains = new Set(selectedDomainIds);
    if (nextDomains.has(domainId)) {
      nextDomains.delete(domainId);
    } else {
      nextDomains.add(domainId);
    }
    setSelectedDomainIds(nextDomains);

    // Prune groups that no longer belong to selected domains
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
      setWarningMsg(`Đã bỏ ${prunedCount} Group không còn thuộc lĩnh vực được chọn. Hãy kiểm tra lại phạm vi phụ trách.`);
    } else {
      setWarningMsg(null);
    }
  };

  // Handle toggle group
  const handleToggleGroup = (groupId: string) => {
    const nextGroups = new Set(selectedGroupIds);
    if (nextGroups.has(groupId)) {
      nextGroups.delete(groupId);
    } else {
      nextGroups.add(groupId);
    }
    setSelectedGroupIds(nextGroups);
  };

  // Reset form
  const handleReset = () => {
    setPhone("");
    setName("");
    setOwnerId(user?.id || "");
    setOwnerName(user?.name || "");
    setSimLocation("owner");
    setSimLocationDetail("");
    setSelectedDomainIds(new Set());
    setSelectedGroupIds(new Set());
    setDomainSearch("");
    setGroupSearch("");
    setIsDomainOpen(false);
    setIsGroupOpen(false);
    setWarningMsg(null);
    setStatusMsg(null);
  };

  // Submit form
  const handleSave = async () => {
    if (!phone.trim() || !name.trim() || !ownerId) {
      setStatusMsg({ text: "Vui lòng nhập SĐT, tên Zalo và người phụ trách.", isError: true });
      return;
    }

    if (simLocation !== "owner" && !simLocationDetail.trim()) {
      setStatusMsg({ text: "Vui lòng nhập vị trí SIM / thiết bị thực tế.", isError: true });
      return;
    }

    setIsSubmitting(true);
    setStatusMsg(null);
    try {
      await onSubmit({
        label: name.trim(),
        phone: phone.trim(),
        owner_name: ownerName || undefined,
        id_member: ownerId,
        sim_location: simLocation,
        sim_location_detail: simLocationDetail.trim() || undefined,
        domain_ids: Array.from(selectedDomainIds),
        group_ids: Array.from(selectedGroupIds),
      });
      setStatusMsg({ text: "✓ Thêm tài khoản Zalo thành công!", isError: false });
      setTimeout(() => {
        onClose();
        handleReset();
      }, 700);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lỗi khi thêm tài khoản Zalo.";
      setStatusMsg({ text: msg, isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-card text-foreground rounded-2xl border border-border shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-visible my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between sticky top-0 bg-card/95 backdrop-blur-md rounded-t-2xl z-20">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl font-bold text-foreground">Thêm tài khoản Zalo</h2>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Thư viện Markee Seeding · Demo
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Nhận diện tài khoản, phân công nhân sự và chọn nhóm phụ trách theo lĩnh vực.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
          >
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Main info grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SĐT Zalo */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5">
                SĐT Zalo <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MaterialIcon name="call" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[16px]" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="VD: 090 123 4567"
                  className="w-full rounded-xl border border-border bg-background pl-9 pr-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 transition"
                />
              </div>
            </div>

            {/* Tên Zalo hiển thị */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5">
                Tên Zalo hiển thị <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <MaterialIcon name="person" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[16px]" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tên hiển thị trên Zalo"
                  className="w-full rounded-xl border border-border bg-background pl-9 pr-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 transition"
                />
              </div>
            </div>

            {/* Người phụ trách */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5">
                Người phụ trách <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={ownerId}
                  onChange={(e) => {
                    setOwnerId(e.target.value);
                    const found = staffList.find((s) => s.id === e.target.value);
                    if (found) setOwnerName(found.name);
                  }}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 transition cursor-pointer"
                >
                  <option value="">— Chọn nhân sự —</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Vị trí SIM / Thiết bị */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5">
                Vị trí SIM / Thiết bị <span className="text-red-500">*</span>
              </label>
              <select
                value={simLocation}
                onChange={(e) => setSimLocation(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 transition cursor-pointer"
              >
                <option value="owner">Điện thoại người phụ trách</option>
                <option value="staff">Điện thoại nhân sự khác</option>
                <option value="farm">Phone Farm</option>
              </select>
            </div>

            {/* Extra field when location !== 'owner' */}
            {simLocation !== "owner" && (
              <div className="col-span-1 md:col-span-2 p-3.5 rounded-xl border border-primary/20 bg-primary/5 space-y-1.5 animate-in fade-in duration-200">
                <label className="block text-xs font-bold text-foreground">
                  {simLocation === "farm" ? "Mã Phone Farm / vị trí thiết bị" : "Nhân sự đang giữ SIM"} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={simLocationDetail}
                  onChange={(e) => setSimLocationDetail(e.target.value)}
                  placeholder="Nhập nhân sự giữ SIM hoặc mã thiết bị / Phone Farm"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
              </div>
            )}
          </div>

          {/* Section: Phạm vi phụ trách */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <strong className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <MaterialIcon name="tune" className="text-primary text-[18px]" />
                Phạm vi phụ trách
              </strong>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <MaterialIcon name="sync" className="text-[14px]" />
                Nguồn dữ liệu: Kho thư viện Group / Markee Seeding
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Lĩnh vực phụ trách */}
              <div className="relative" ref={domainPickerRef}>
                <label className="block text-xs font-bold text-foreground mb-1.5">Lĩnh vực phụ trách</label>
                <button
                  type="button"
                  onClick={() => {
                    setIsDomainOpen(!isDomainOpen);
                    setIsGroupOpen(false);
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-border bg-background px-3 py-1.5 text-left flex items-center justify-between gap-2 hover:border-primary/50 focus:border-primary transition cursor-pointer"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1 items-center">
                    {selectedDomainIds.size === 0 ? (
                      <span className="text-xs text-muted-foreground">Chọn một hoặc nhiều lĩnh vực...</span>
                    ) : (
                      Array.from(selectedDomainIds).map((id) => {
                        const d = domains.find((item) => item.id === id);
                        if (!d) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20"
                          >
                            <span>{d.name}</span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleDomain(id);
                              }}
                              className="hover:text-red-700 font-bold ml-0.5 cursor-pointer"
                            >
                              ×
                            </span>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <span className="material-symbols-outlined text-muted-foreground text-[16px] shrink-0">
                    {isDomainOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {/* Dropdown Domains */}
                {isDomainOpen && (
                  <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-30 bg-card rounded-xl border border-border shadow-xl p-2 space-y-1.5 animate-in fade-in duration-150">
                    <input
                      type="text"
                      value={domainSearch}
                      onChange={(e) => setDomainSearch(e.target.value)}
                      placeholder="Tìm lĩnh vực..."
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      autoFocus
                    />
                    <div className="max-h-[180px] overflow-y-auto space-y-1">
                      {filteredDomains.length === 0 ? (
                        <div className="p-2 text-center text-xs text-muted-foreground">Không tìm thấy lĩnh vực</div>
                      ) : (
                        filteredDomains.map((d) => {
                          const checked = selectedDomainIds.has(d.id);
                          return (
                            <label
                              key={d.id}
                              className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/60 transition cursor-pointer text-xs select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleDomain(d.id)}
                                className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                              />
                              <span className="font-medium text-foreground">{d.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Chọn nhiều lĩnh vực để mở rộng danh sách Group.</p>
              </div>

              {/* Tên nhóm phụ trách */}
              <div className="relative" ref={groupPickerRef}>
                <label className="block text-xs font-bold text-foreground mb-1.5">Tên nhóm phụ trách</label>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedDomainIds.size === 0) {
                      setIsDomainOpen(true);
                      setIsGroupOpen(false);
                      return;
                    }
                    setIsGroupOpen(!isGroupOpen);
                    setIsDomainOpen(false);
                  }}
                  className="w-full min-h-[44px] rounded-xl border border-border bg-background px-3 py-1.5 text-left flex items-center justify-between gap-2 hover:border-primary/50 focus:border-primary transition cursor-pointer"
                >
                  <div className="flex flex-wrap gap-1.5 flex-1 items-center">
                    {selectedDomainIds.size === 0 ? (
                      <span className="text-xs text-muted-foreground">Chọn lĩnh vực trước...</span>
                    ) : selectedGroupIds.size === 0 ? (
                      <span className="text-xs text-muted-foreground">Chọn một hoặc nhiều Group...</span>
                    ) : (
                      Array.from(selectedGroupIds).map((id) => {
                        const g = groups.find((item) => item.id === id);
                        if (!g) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"
                          >
                            <span className="truncate max-w-[140px]">{g.name}</span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleGroup(id);
                              }}
                              className="hover:text-red-700 font-bold ml-0.5 cursor-pointer"
                            >
                              ×
                            </span>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <span className="material-symbols-outlined text-muted-foreground text-[16px] shrink-0">
                    {isGroupOpen ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {/* Dropdown Groups */}
                {isGroupOpen && (
                  <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-30 bg-card rounded-xl border border-border shadow-xl p-2 space-y-1.5 animate-in fade-in duration-150">
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Tìm Group theo tên..."
                      className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      autoFocus
                    />
                    <div className="max-h-[180px] overflow-y-auto space-y-1">
                      {selectedDomainIds.size === 0 ? (
                        <div className="p-3 text-center text-xs text-muted-foreground">Hãy chọn ít nhất một lĩnh vực trước.</div>
                      ) : filteredEligibleGroups.length === 0 ? (
                        <div className="p-3 text-center text-xs text-muted-foreground">Không có Group nào trong lĩnh vực đã chọn.</div>
                      ) : (
                        filteredEligibleGroups.map((g) => {
                          const checked = selectedGroupIds.has(g.id);
                          const domainObj = domains.find((d) => d.id === g.domain);
                          return (
                            <label
                              key={g.id}
                              className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/60 transition cursor-pointer text-xs select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleGroup(g.id)}
                                className="rounded border-border text-primary focus:ring-0 cursor-pointer"
                              />
                              <span className="font-medium text-foreground truncate flex-1">{g.name}</span>
                              {domainObj && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                  {domainObj.name}
                                </span>
                              )}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {selectedDomainIds.size > 0
                    ? `Có ${eligibleGroups.length} Group phù hợp trong ${selectedDomainIds.size} lĩnh vực đã chọn.`
                    : "Chỉ hiển thị Group thuộc lĩnh vực đã chọn."}
                </p>
              </div>
            </div>

            {/* Warning when unchecking domain removes groups */}
            {warningMsg && (
              <div className="mt-3 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs flex items-center gap-2 animate-in fade-in duration-200">
                <MaterialIcon name="warning" className="text-amber-600 text-[18px] shrink-0" />
                <span>{warningMsg}</span>
              </div>
            )}
          </div>

          {/* Notice */}
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-900 text-xs leading-relaxed flex items-start gap-2.5">
            <MaterialIcon name="info" className="text-blue-600 text-[18px] shrink-0 mt-0.5" />
            <div>
              <b>Danh mục minh họa mô phỏng dữ liệu Markee Seeding:</b> Khi tích hợp thật, hệ thống sẽ lấy ID lĩnh vực và ID Group từ thư viện chung, áp dụng phân quyền và tự động cập nhật tên nhóm. Không nhập mật khẩu hoặc OTP tại đây.
            </div>
          </div>

          {/* Status Message */}
          {statusMsg && (
            <div
              className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 animate-in fade-in duration-150 ${
                statusMsg.isError ? "border-red-200 bg-red-50 text-red-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              <MaterialIcon name={statusMsg.isError ? "error" : "check_circle"} className="text-[18px] shrink-0" />
              <span>{statusMsg.text}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 px-6 border-t border-border flex items-center justify-end gap-3 sticky bottom-0 bg-card/95 backdrop-blur-md rounded-b-2xl z-10">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl border border-border bg-background hover:bg-muted text-foreground text-xs font-bold transition cursor-pointer disabled:opacity-50"
          >
            Đặt lại
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl bg-primary hover:bg-red-700 text-white text-xs font-bold transition shadow-sm shadow-red-500/20 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-1" />
                Đang lưu...
              </>
            ) : (
              <>
                <MaterialIcon name="person_add" className="text-[16px]" />
                Thêm tài khoản
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

