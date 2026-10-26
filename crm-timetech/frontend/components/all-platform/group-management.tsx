"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FaFacebook, FaLinkedin, FaPlus, FaEdit, FaTrash, FaSearch } from "react-icons/fa";
import { MaterialIcon } from "@/components/ui";
import { useAppAuth } from "@/contexts/AppAuthContext";
import { useMembers } from "@/hooks/useMembers";
import {
  allPlatformGroupsService,
  allPlatformCategoriesService,
  teamsService,
  usersService,
  type AppUserProfile,
  type TeamRow
} from "@/services/all-platform.service";
import type { FacebookGroup, LinkedInGroup, FeedPlatform, Category } from "@/types/unified.types";

const PLATFORMS: { key: FeedPlatform; label: string; Icon: typeof FaFacebook }[] = [
  { key: "facebook", label: "Facebook Groups", Icon: FaFacebook },
  { key: "linkedin", label: "LinkedIn Groups", Icon: FaLinkedin },
];

// ── Searchable Dropdown Component ─────────────────────────────────────────────
interface SearchableDropdownProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: Category[];
  placeholder: string;
  required?: boolean;
  valueField?: "id" | "code";
}

function SearchableDropdown({
  label,
  value,
  onChange,
  options,
  placeholder,
  required = false,
  valueField = "id",
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const optionValue = useCallback(
    (o: Category) => {
      if (valueField === "code") return String(o.code ?? "");
      return String((o as any).id ?? "");
    },
    [valueField],
  );

  // Sync internal search input with current selected value's representation
  useEffect(() => {
    const match = options.find((o) => optionValue(o) === (value || ""));
    if (match) {
      setSearch(match.name || match.code || optionValue(match));
    } else {
      setSearch(value);
    }
    setIsTyping(false);
  }, [value, options, optionValue]);

  // Click outside to close dropdown and restore search value to matching label
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsTyping(false);
        const match = options.find((o) => optionValue(o) === (value || ""));
        if (match) {
          setSearch(match.name || match.code || optionValue(match));
        } else {
          setSearch(value);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value, options, optionValue]);

  const filteredOptions = isTyping
    ? options.filter(
        (o) =>
          (o.code || "").toLowerCase().includes(search.toLowerCase()) ||
          (o.name || "").toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  return (
    <div ref={containerRef} className="relative flex flex-col">
      <label className="text-xs font-bold text-on-surface-variant block mb-1">
        {label} {required && "*"}
      </label>
      <div className="relative">
        <input
          type="text"
          className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary pr-8 text-on-surface"
          placeholder={placeholder}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            setIsTyping(true);
            if (e.target.value === "") {
              onChange("");
            }
          }}
          onFocus={() => {
            setIsOpen(true);
            setIsTyping(false);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            setIsTyping(false);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px] select-none pointer-events-none">
            {isOpen ? "arrow_drop_up" : "arrow_drop_down"}
          </span>
        </button>
      </div>

      {isOpen && (
        <div className="absolute top-full z-[60] left-0 right-0 mt-1 bg-surface border border-outline-variant rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <div className="p-3 text-xs text-on-surface-variant text-center">Không tìm thấy danh mục</div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                key={String(opt.id || opt.code)}
                type="button"
                onClick={() => {
                  onChange(optionValue(opt));
                  setSearch(opt.name || opt.code || optionValue(opt));
                  setIsTyping(false);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-surface-container-low transition-all duration-200 ease-out border-b border-outline-variant last:border-0 cursor-pointer ${
                  (value || "") === optionValue(opt)
                    ? "bg-primary/10 font-bold text-primary"
                    : "text-on-surface"
                }`}
              >
                <div className="font-bold">{opt.name || opt.code}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Facebook Group Form ──────────────────────────────────────────────────────
interface FbGroupFormData {
  id_member?: string;
  group_name: string;
  group_url: string;
  id_intent: string;
  id_industry: string;
  id_tier: string;
  id_team: string;
  id_icp: string;
  icp_desc: string;
  members: string;
  posts_per_week: string;
  health_score: string;
  chay_24h: boolean;
  crawl_time: string;
  crawl_frequency: string;
  id_content_type: string;
  id_product_seeding: string;
  end_time_24h: string;
  start_time_in_day: string;
  end_time_in_day: string;
  time_crawl: string;
  end_date_hour: string;
  note: string;
  risk_note: string;
  assignee_id: string;
  co_assignee_id: string;
  assignee_name_hint: string;
  co_assignee_name_hint: string;
  id_member_name_hint: string;
}

const FB_EMPTY_FORM: FbGroupFormData = {
  id_member: "",
  group_name: "",
  group_url: "",
  id_intent: "",
  id_industry: "",
  id_tier: "",
  id_team: "",
  id_icp: "",
  icp_desc: "",
  members: "",
  posts_per_week: "",
  health_score: "",
  chay_24h: false,
  crawl_time: "10:00",
  crawl_frequency: "daily",
  id_content_type: "",
  id_product_seeding: "",
  end_time_24h: "",
  start_time_in_day: "",
  end_time_in_day: "",
  time_crawl: "",
  end_date_hour: "",
  note: "",
  risk_note: "",
  assignee_id: "",
  co_assignee_id: "",
  assignee_name_hint: "",
  co_assignee_name_hint: "",
  id_member_name_hint: "",
};

function FacebookGroupForm({
  initial,
  onSubmit,
  onCancel,
  intentOptions,
  industryOptions,
  teamOptions,
  tierOptions,
  icpOptions,
  contentTypeOptions,
  productSeedingOptions,
  userOptions,
  validUserIds,
  nameHintById,
}: {
  initial?: Partial<FbGroupFormData>;
  onSubmit: (data: Partial<FbGroupFormData>) => Promise<void>;
  onCancel: () => void;
  intentOptions: Category[];
  industryOptions: Category[];
  teamOptions: Category[];
  tierOptions: Category[];
  icpOptions: Category[];
  contentTypeOptions: Category[];
  productSeedingOptions: Category[];
  userOptions: Category[];
  validUserIds: Set<string>;
  nameHintById: Record<string, string>;
}) {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";
  const [form, setForm] = useState<FbGroupFormData>({ ...FB_EMPTY_FORM, ...initial });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof FbGroupFormData, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Chọn 1 người phụ trách/thành viên sở hữu thì lưu kèm luôn tên hiển thị
  // "sạch" (không kèm email) — dùng làm fallback hiển thị nếu người đó chưa
  // liên kết tài khoản đăng nhập nên field FK id bị bỏ trống lúc lưu.
  const setPerson = (idKey: keyof FbGroupFormData, hintKey: keyof FbGroupFormData, value: string) => {
    setForm((f) => ({ ...f, [idKey]: value, [hintKey]: nameHintById[value] || "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.group_name.trim() || !form.group_url.trim()) return;

    // Validate that intent, industry, team, tier and icp are chosen from options (if selected)
    if (form.id_intent && !intentOptions.some((o) => String(o.id) === form.id_intent)) {
      alert("Vui lòng chọn Lĩnh vực hợp lệ từ danh mục!");
      return;
    }
    if (form.id_industry && !industryOptions.some((o) => String(o.id) === form.id_industry)) {
      alert("Vui lòng chọn Industry hợp lệ từ danh sách!");
      return;
    }
    if (form.id_team && !teamOptions.some((o) => String(o.id) === form.id_team)) {
      alert("Vui lòng chọn Team hợp lệ từ danh sách!");
      return;
    }
    if (form.id_tier && !tierOptions.some((o) => String(o.id) === form.id_tier)) {
      alert("Vui lòng chọn Tier hợp lệ từ danh sách!");
      return;
    }
    if (form.id_icp && !icpOptions.some((o) => String(o.id) === form.id_icp)) {
      alert("Vui lòng chọn ICP Target hợp lệ từ danh sách!");
      return;
    }

    setBusy(true);
    try {
      // Validate 24h crawl config
      if (form.chay_24h) {
        if (!form.start_time_in_day && form.start_time_in_day !== "0") {
          alert("Vui lòng nhập Giờ bắt đầu trong ngày!");
          setBusy(false);
          return;
        }
        if (!form.end_time_in_day && form.end_time_in_day !== "0") {
          alert("Vui lòng nhập Giờ kết thúc trong ngày!");
          setBusy(false);
          return;
        }
        if (Number(form.start_time_in_day) >= Number(form.end_time_in_day)) {
          alert("Giờ bắt đầu phải nhỏ hơn giờ kết thúc!");
          setBusy(false);
          return;
        }
        if (!form.time_crawl) {
          alert("Vui lòng chọn Khoảng cách cào!");
          setBusy(false);
          return;
        }
      }
      // assignee_id/co_assignee_id/id_member là FK thật tới app_users — người
      // được chọn trong danh bạ nhưng chưa liên kết tài khoản đăng nhập thì
      // không có id hợp lệ để lưu, bỏ trống thay vì gửi giá trị sai (DB sẽ từ
      // chối insert nếu gửi id không tồn tại trong app_users).
      const submitData: Partial<FbGroupFormData> = {
        ...form,
        assignee_id: validUserIds.has(form.assignee_id) ? form.assignee_id : "",
        co_assignee_id: validUserIds.has(form.co_assignee_id) ? form.co_assignee_id : "",
        id_member: form.id_member && validUserIds.has(form.id_member) ? form.id_member : "",
      };
      await onSubmit(submitData);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Tên nhóm *</label>
          <input
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
            value={form.group_name}
            onChange={(e) => set("group_name", e.target.value)}
            required
            placeholder="VD: IT Vietnam"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">URL nhóm *</label>
          <input
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
            value={form.group_url}
            onChange={(e) => set("group_url", e.target.value)}
            required
            placeholder="https://facebook.com/groups/..."
          />
        </div>
        <div>
          <SearchableDropdown
            label="Lĩnh vực"
            value={form.id_intent}
            onChange={(val) => set("id_intent", val)}
            options={intentOptions}
            placeholder="Tìm chọn Lĩnh vực..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Industry"
            value={form.id_industry}
            onChange={(val) => set("id_industry", val)}
            options={industryOptions}
            placeholder="Tìm chọn Industry..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Tier"
            value={form.id_tier}
            onChange={(val) => set("id_tier", val)}
            options={tierOptions}
            placeholder="Tìm chọn Tier..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Team"
            value={form.id_team}
            onChange={(val) => set("id_team", val)}
            options={teamOptions}
            placeholder="Tìm chọn Team..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="ICP Target"
            value={form.id_icp}
            onChange={(val) => set("id_icp", val)}
            options={icpOptions}
            placeholder="Tìm chọn ICP Target..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Người phụ trách chính"
            value={form.assignee_id}
            onChange={(val) => setPerson("assignee_id", "assignee_name_hint", val)}
            options={userOptions}
            placeholder="Tìm theo tên/email..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Đồng phụ trách"
            value={form.co_assignee_id}
            onChange={(val) => setPerson("co_assignee_id", "co_assignee_name_hint", val)}
            options={userOptions}
            placeholder="Tìm theo tên/email..."
            valueField="id"
          />
        </div>
        {isAdmin && (
          <div>
            <SearchableDropdown
              label="Thành viên sở hữu *"
              value={form.id_member || ""}
              onChange={(val) => setPerson("id_member", "id_member_name_hint", val)}
              options={userOptions}
              placeholder="Tìm theo tên/email..."
              valueField="id"
              required
            />
          </div>
        )}
        <div>
          <SearchableDropdown
            label="Loại nội dung"
            value={form.id_content_type}
            onChange={(val) => set("id_content_type", val)}
            options={contentTypeOptions}
            placeholder="Tìm chọn Loại nội dung..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Sản phẩm Seeding"
            value={form.id_product_seeding}
            onChange={(val) => set("id_product_seeding", val)}
            options={productSeedingOptions}
            placeholder="Tìm chọn SP Seeding..."
            valueField="id"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Số thành viên</label>
          <input
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
            value={form.members}
            onChange={(e) => set("members", e.target.value)}
            placeholder="50000"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Posts/tuần</label>
          <input
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
            value={form.posts_per_week}
            onChange={(e) => set("posts_per_week", e.target.value)}
            placeholder="10"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Ghi chú rủi ro</label>
          <textarea
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface resize-y min-h-[60px]"
            value={form.risk_note}
            onChange={(e) => set("risk_note", e.target.value)}
            placeholder="Nhập cảnh báo/rủi ro nếu có..."
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Ghi chú</label>
          <textarea
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface resize-y min-h-[80px]"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Nhập ghi chú chung..."
          />
        </div>
        <div className="md:col-span-2 p-4 border border-outline-variant rounded-xl bg-surface-container-low space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.chay_24h}
              onChange={(e) => set("chay_24h", e.target.checked)}
              className="w-4 h-4 rounded text-primary border-outline-variant focus:ring-primary/20"
            />
            <span className="text-sm font-bold text-on-surface">Bật cào tự động 24h (Cronjob)</span>
          </label>

          {form.chay_24h && (
            <div className="space-y-3">
              <div className="text-xs text-on-surface-variant bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 leading-relaxed">
                ⚡ <b>Cách hoạt động:</b> Mỗi phút scheduler sẽ kiểm tra — nếu thời điểm hiện tại nằm trong khung giờ và chia hết cho khoảng cách cào (theo phút) thì sẽ cào nhóm này.
                <br/>Ví dụ: Khung giờ <b>7h–22h</b>, khoảng cách <b>60 phút</b> → cào vào 7:00, 8:00, 9:00... cho đến 22:00.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-on-surface-variant block mb-1">
                    Giờ bắt đầu trong ngày <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
                    value={form.start_time_in_day}
                    onChange={(e) => set("start_time_in_day", e.target.value)}
                    placeholder="VD: 7 (7 giờ sáng)"
                    required={form.chay_24h}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant block mb-1">
                    Giờ kết thúc trong ngày <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
                    value={form.end_time_in_day}
                    onChange={(e) => set("end_time_in_day", e.target.value)}
                    placeholder="VD: 22 (10 giờ tối)"
                    required={form.chay_24h}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant block mb-1">
                    Khoảng cách cào (phút) <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface bg-surface"
                    value={form.time_crawl}
                    onChange={(e) => set("time_crawl", e.target.value)}
                    required={form.chay_24h}
                  >
                    <option value="">-- Chọn khoảng cách --</option>
                    <option value="30">30 phút</option>
                    <option value="60">1 tiếng (60 phút)</option>
                    <option value="120">2 tiếng (120 phút)</option>
                    <option value="180">3 tiếng (180 phút)</option>
                    <option value="240">4 tiếng (240 phút)</option>
                    <option value="300">5 tiếng (300 phút)</option>
                    <option value="360">6 tiếng (360 phút)</option>
                    <option value="480">8 tiếng (480 phút)</option>
                    <option value="720">12 tiếng (720 phút)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-on-surface-variant block mb-1">
                    Ngày kết thúc cào tự động
                  </label>
                  <input
                    type="date"
                    className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
                    value={form.end_date_hour}
                    onChange={(e) => set("end_date_hour", e.target.value)}
                  />
                  <p className="text-[10px] text-on-surface-variant mt-1">Để trống = không có ngày hết hạn</p>
                </div>
              </div>
              {form.start_time_in_day && form.end_time_in_day && Number(form.start_time_in_day) >= Number(form.end_time_in_day) && (
                <p className="text-xs text-red-500 font-bold">⚠️ Giờ bắt đầu phải nhỏ hơn giờ kết thúc!</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-3 border-t border-outline-variant pt-4 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold py-2 rounded-xl hover:bg-surface-container-low text-sm transition-all duration-200 ease-out cursor-pointer"
        >
          Hủy
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex-1 bg-primary text-white font-bold py-2 rounded-xl hover:bg-on-primary-fixed-variant text-sm transition-all duration-200 ease-out disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Đang lưu..." : initial?.group_name ? "Cập nhật" : "Thêm mới"}
        </button>
      </div>
    </form>
  );
}

// ── LinkedIn Group Form ──────────────────────────────────────────────────────
interface LiGroupFormData {
  id_member?: string;
  group_name: string;
  group_url: string;
  status: string;
  id_intent: string;
  id_industry: string;
  id_tier: string;
  id_team: string;
  id_icp: string;
  id_content_type: string;
  id_product_seeding: string;
  note: string;
  risk_note: string;
  assignee_id: string;
  co_assignee_id: string;
  assignee_name_hint: string;
  co_assignee_name_hint: string;
  id_member_name_hint: string;
}

const LI_EMPTY_FORM: LiGroupFormData = {
  id_member: "",
  group_name: "",
  group_url: "",
  status: "idle",
  id_intent: "",
  id_industry: "",
  id_tier: "",
  id_team: "",
  id_icp: "",
  id_content_type: "",
  id_product_seeding: "",
  note: "",
  risk_note: "",
  assignee_id: "",
  co_assignee_id: "",
  assignee_name_hint: "",
  co_assignee_name_hint: "",
  id_member_name_hint: "",
};

function LinkedInGroupForm({
  initial,
  onSubmit,
  onCancel,
  intentOptions,
  industryOptions,
  teamOptions,
  tierOptions,
  icpOptions,
  contentTypeOptions,
  productSeedingOptions,
  userOptions,
  validUserIds,
  nameHintById,
}: {
  initial?: Partial<LiGroupFormData>;
  onSubmit: (data: Partial<LiGroupFormData>) => Promise<void>;
  onCancel: () => void;
  intentOptions: Category[];
  industryOptions: Category[];
  teamOptions: Category[];
  tierOptions: Category[];
  icpOptions: Category[];
  contentTypeOptions: Category[];
  productSeedingOptions: Category[];
  userOptions: Category[];
  validUserIds: Set<string>;
  nameHintById: Record<string, string>;
}) {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";
  const [form, setForm] = useState<LiGroupFormData>({ ...LI_EMPTY_FORM, ...initial });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof LiGroupFormData, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Chọn 1 người phụ trách/thành viên sở hữu thì lưu kèm luôn tên hiển thị
  // "sạch" (không kèm email) — dùng làm fallback hiển thị nếu người đó chưa
  // liên kết tài khoản đăng nhập nên field FK id bị bỏ trống lúc lưu.
  const setPerson = (idKey: keyof LiGroupFormData, hintKey: keyof LiGroupFormData, value: string) => {
    setForm((f) => ({ ...f, [idKey]: value, [hintKey]: nameHintById[value] || "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.group_url.trim()) return;

    if (form.id_intent && !intentOptions.some((o) => String(o.id) === form.id_intent)) {
      alert("Vui lòng chọn Lĩnh vực hợp lệ từ danh mục!");
      return;
    }
    if (form.id_industry && !industryOptions.some((o) => String(o.id) === form.id_industry)) {
      alert("Vui lòng chọn Industry hợp lệ từ danh sách!");
      return;
    }
    if (form.id_team && !teamOptions.some((o) => String(o.id) === form.id_team)) {
      alert("Vui lòng chọn Team hợp lệ từ danh sách!");
      return;
    }
    if (form.id_tier && !tierOptions.some((o) => String(o.id) === form.id_tier)) {
      alert("Vui lòng chọn Tier hợp lệ từ danh sách!");
      return;
    }
    if (form.id_icp && !icpOptions.some((o) => String(o.id) === form.id_icp)) {
      alert("Vui lòng chọn ICP Target hợp lệ từ danh sách!");
      return;
    }

    setBusy(true);
    try {
      // assignee_id/co_assignee_id/id_member là FK thật tới app_users — người
      // được chọn trong danh bạ nhưng chưa liên kết tài khoản đăng nhập thì
      // không có id hợp lệ để lưu, bỏ trống thay vì gửi giá trị sai (DB sẽ từ
      // chối insert nếu gửi id không tồn tại trong app_users).
      const submitData: Partial<LiGroupFormData> = {
        ...form,
        assignee_id: validUserIds.has(form.assignee_id) ? form.assignee_id : "",
        co_assignee_id: validUserIds.has(form.co_assignee_id) ? form.co_assignee_id : "",
        id_member: form.id_member && validUserIds.has(form.id_member) ? form.id_member : "",
      };
      await onSubmit(submitData);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Tên nhóm</label>
          <input
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
            value={form.group_name}
            onChange={(e) => set("group_name", e.target.value)}
            placeholder="LinkedIn Group Name"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">URL nhóm *</label>
          <input
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface"
            value={form.group_url}
            onChange={(e) => set("group_url", e.target.value)}
            required
            placeholder="https://linkedin.com/groups/..."
          />
        </div>

        <div>
          <SearchableDropdown
            label="Lĩnh vực"
            value={form.id_intent}
            onChange={(val) => set("id_intent", val)}
            options={intentOptions}
            placeholder="Tìm chọn Lĩnh vực..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Industry"
            value={form.id_industry}
            onChange={(val) => set("id_industry", val)}
            options={industryOptions}
            placeholder="Tìm chọn Industry..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Tier"
            value={form.id_tier}
            onChange={(val) => set("id_tier", val)}
            options={tierOptions}
            placeholder="Tìm chọn Tier..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Team"
            value={form.id_team}
            onChange={(val) => set("id_team", val)}
            options={teamOptions}
            placeholder="Tìm chọn Team..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="ICP Target"
            value={form.id_icp}
            onChange={(val) => set("id_icp", val)}
            options={icpOptions}
            placeholder="Tìm chọn ICP Target..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Loại nội dung"
            value={form.id_content_type}
            onChange={(val) => set("id_content_type", val)}
            options={contentTypeOptions}
            placeholder="Tìm chọn Loại nội dung..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Sản phẩm Seeding"
            value={form.id_product_seeding}
            onChange={(val) => set("id_product_seeding", val)}
            options={productSeedingOptions}
            placeholder="Tìm chọn SP Seeding..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Người phụ trách chính"
            value={form.assignee_id}
            onChange={(val) => setPerson("assignee_id", "assignee_name_hint", val)}
            options={userOptions}
            placeholder="Tìm theo tên/email..."
            valueField="id"
          />
        </div>
        <div>
          <SearchableDropdown
            label="Đồng phụ trách"
            value={form.co_assignee_id}
            onChange={(val) => setPerson("co_assignee_id", "co_assignee_name_hint", val)}
            options={userOptions}
            placeholder="Tìm theo tên/email..."
            valueField="id"
          />
        </div>
        {isAdmin && (
          <div>
            <SearchableDropdown
              label="Thành viên sở hữu *"
              value={form.id_member || ""}
              onChange={(val) => setPerson("id_member", "id_member_name_hint", val)}
              options={userOptions}
              placeholder="Tìm theo tên/email..."
              valueField="id"
              required
            />
          </div>
        )}
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Ghi chú rủi ro</label>
          <textarea
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface resize-y min-h-[60px]"
            value={form.risk_note}
            onChange={(e) => set("risk_note", e.target.value)}
            placeholder="Nhập cảnh báo/rủi ro nếu có..."
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs font-bold text-on-surface-variant block mb-1">Ghi chú</label>
          <textarea
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-on-surface resize-y min-h-[80px]"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Nhập ghi chú chung..."
          />
        </div>
      </div>
      <div className="flex gap-3 border-t border-outline-variant pt-4 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold py-2 rounded-xl hover:bg-surface-container-low text-sm transition-all duration-200 ease-out cursor-pointer"
        >
          Hủy
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex-1 bg-primary text-white font-bold py-2 rounded-xl hover:bg-on-primary-fixed-variant text-sm transition-all duration-200 ease-out disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Đang lưu..." : initial?.group_name ? "Cập nhật" : "Thêm mới"}
        </button>
      </div>
    </form>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function GroupManagementContent() {
  const { user } = useAppAuth();
  const isAdmin = user?.role === "admin";
  const isLeader = user?.role === "leader";

  const [platform, setPlatform] = useState<FeedPlatform>("facebook");
  const [fbGroups, setFbGroups] = useState<FacebookGroup[]>([]);
  const [liGroups, setLiGroups] = useState<LinkedInGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [teamsData, setTeamsData] = useState<TeamRow[]>([]);
  const [allUsers, setAllUsers] = useState<AppUserProfile[]>([]);
  const myTeams = useMemo(() => {
    if (!user || user.role !== "leader") return [];
    return teamsData.filter(t => String(t.id_leader) === String(user.id));
  }, [teamsData, user]);

  const myTeamMemberIds = useMemo(() => {
    const ids = new Set<string>();
    myTeams.forEach(t => {
      t.members?.forEach(m => {
        if (m.id) ids.add(String(m.id));
      });
    });
    return ids;
  }, [myTeams]);

  // Hiện ĐẦY ĐỦ toàn bộ danh bạ (140 người) — GET /api/all-platform/members —
  // chọn tự do không chặn ai. Người chưa liên kết tài khoản đăng nhập vẫn chọn
  // được bình thường; lúc lưu group sẽ tự bỏ trống field đó nếu người được chọn
  // chưa có app_users.id thật (assignee_id/co_assignee_id/id_member có FK, xem
  // validUserIds truyền xuống 2 form bên dưới).
  const { members } = useMembers();
  const userOptions: Category[] = useMemo(() => {
    return members
      .map(m => {
        const linkedUserId = m.linked_user_id || m.linked_user_id_2 || null;
        const linkedUser = linkedUserId ? allUsers.find(u => u.id === linkedUserId) : undefined;
        return {
          id: linkedUserId || m.id,
          name: linkedUser ? `${m.display_name} (${linkedUser.email})` : `${m.display_name} (chưa liên kết tài khoản)`,
          code: linkedUser?.email || "",
          category_type: "user",
          platform: "all"
        } as unknown as Category;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [members, allUsers]);

  const validUserIds = useMemo(() => new Set(allUsers.map(u => u.id)), [allUsers]);

  // Tên hiển thị "sạch" (không kèm email/ghi chú) theo option id — dùng để lưu
  // kèm name-hint khi người được chọn chưa liên kết tài khoản (xem migration 045).
  const nameHintById = useMemo(() => {
    const map: Record<string, string> = {};
    members.forEach(m => {
      const linkedUserId = m.linked_user_id || m.linked_user_id_2 || null;
      map[linkedUserId || m.id] = m.display_name;
    });
    return map;
  }, [members]);

  const teamCategories: Category[] = useMemo(() => {
    const uniqueTeams: TeamRow[] = [];
    const seen = new Set<string>();
    teamsData.forEach((t) => {
      const id = String((t as any).id || "");
      if (!id) return;
      if (seen.has(id)) return;
      seen.add(id);
      uniqueTeams.push(t);
    });

    return uniqueTeams.map((t) =>
      ({
        id: String((t as any).id),
        category_type: "team",
        code: t.name_team || String((t as any).id),
        name: t.name_team || String((t as any).id),
      } as Category),
    );
  }, [teamsData]);

  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FacebookGroup | LinkedInGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewingGroupClassification, setViewingGroupClassification] = useState<FacebookGroup | LinkedInGroup | null>(null);
  const [deletingGroupItem, setDeletingGroupItem] = useState<FacebookGroup | LinkedInGroup | null>(null);

  // States bộ lọc
  const [intentFilter, setIntentFilter] = useState("all");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [icpFilter, setIcpFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");
  const [productSeedingFilter, setProductSeedingFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const [fbRes, liRes] = await Promise.all([
        allPlatformGroupsService.getAll("facebook"),
        allPlatformGroupsService.getAll("linkedin"),
      ]);
      if (fbRes.success && fbRes.data) setFbGroups(fbRes.data as FacebookGroup[]);
      if (liRes.success && liRes.data) setLiGroups(liRes.data as LinkedInGroup[]);
    } catch {
      setError("Không thể tải danh sách nhóm");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const [catRes, teamRes, userRes] = await Promise.all([
        allPlatformCategoriesService.getAll(),
        teamsService.getAll(),
        usersService.getAllProfiles()
      ]);
      if (catRes.success && catRes.data) {
        setCategories(catRes.data);
      }
      if (teamRes.success && teamRes.data) {
        setTeamsData(teamRes.data);
      }
      if (userRes.success && userRes.data) {
        setAllUsers(userRes.data);
      }
    } catch (e) {
      console.error("Lỗi khi tải danh mục:", e);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
    fetchCategories();
  }, [fetchGroups, fetchCategories]);

  // Local filtering...
  // fallbackHint: tên đã chọn tại thời điểm lưu (name-hint, xem migration 045) —
  // dùng khi id là NULL vì người được chọn lúc đó chưa liên kết tài khoản đăng
  // nhập, để không hiện trống trơn/mất dấu vết đã chọn ai.
  const getUserName = useCallback((id: string | null | undefined, fallbackHint?: string | null) => {
    if (!id) return fallbackHint ? `${fallbackHint} (chưa liên kết tài khoản)` : "—";
    const user = allUsers.find(u => String(u.id) === String(id));
    if (!user) return fallbackHint ? `${fallbackHint} (chưa liên kết tài khoản)` : "—";
    return (user as any).full_name || (user as any).name || user.email;
  }, [allUsers]);

  const getTeamName = useCallback((id: string | null | undefined) => {
    if (!id) return "—";
    const team = teamsData.find(t => String((t as any).id) === String(id));
    if (!team) return "—";
    return team.name_team || "—";
  }, [teamsData]);

  const getUserTeamName = useCallback((idMember: string | null | undefined) => {
    if (!idMember) return "—";
    const team = teamsData.find(t => t.members?.some(m => String(m.id) === String(idMember)));
    if (!team) return "—";
    return team.name_team || "—";
  }, [teamsData]);

  // Mapping helper từ id hoặc code sang name danh mục
  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((c) => {
      if (c.id) {
        map.set(String(c.id), c.name || c.code || String(c.id));
      }
      if (c.code) {
        map.set(String(c.code).toLowerCase(), c.name || c.code);
      }
    });
    return map;
  }, [categories]);

  const getCategoryName = useCallback((val: string | undefined | null) => {
    if (!val) return "—";
    // Prefer id lookup, fallback to code lookup
    return categoryNameMap.get(String(val)) || categoryNameMap.get(String(val).toLowerCase()) || val;
  }, [categoryNameMap]);

  const filteredFb = useMemo(() => {
    return fbGroups
      .filter((g) => {
        if (isLeader && user) {
          const isOwnerLeader = String(g.id_member) === String(user.id);
          const isOwnerMemberOfMyTeam = myTeamMemberIds.has(String(g.id_member));
          if (!isOwnerLeader && !isOwnerMemberOfMyTeam) {
            return false;
          }
        }

        const matchesSearch = !search ||
          g.group_name?.toLowerCase().includes(search.toLowerCase()) ||
          g.group_url?.toLowerCase().includes(search.toLowerCase());

        const matchesIntent = intentFilter === "all" || String((g as any).id_intent ?? "") === intentFilter;
        const matchesIndustry = industryFilter === "all" || String((g as any).id_industry ?? "") === industryFilter;

        // Team filter: for admin, filter by member's team. Otherwise filter by category id_team.
        let matchesTeam = true;
        if (teamFilter !== "all") {
          if (isAdmin) {
            const selectedTeam = teamsData.find(t => String(t.id) === teamFilter);
            matchesTeam = selectedTeam?.members?.some(m => String(m.id) === String(g.id_member)) || false;
          } else {
            matchesTeam = String((g as any).id_team ?? "") === teamFilter;
          }
        }

        const matchesTier = tierFilter === "all" || String((g as any).id_tier ?? "") === tierFilter;
        const matchesIcp = icpFilter === "all" || String((g as any).id_icp ?? "") === icpFilter;
        const matchesMember = memberFilter === "all" || String(g.id_member ?? "") === memberFilter;
        const matchesContentType = contentTypeFilter === "all" || String((g as any).id_content_type ?? "") === contentTypeFilter;
        const matchesProductSeeding = productSeedingFilter === "all" || String((g as any).id_product_seeding ?? "") === productSeedingFilter;

        return matchesSearch && matchesIntent && matchesIndustry && matchesTeam && matchesTier && matchesIcp && matchesMember && matchesContentType && matchesProductSeeding;
      })
      .sort((g1, g2) => {
        if (isLeader && user) {
          const isLeader1 = String(g1.id_member) === String(user.id);
          const isLeader2 = String(g2.id_member) === String(user.id);
          // Leader's own groups float to top
          if (isLeader1 && !isLeader2) return -1;
          if (!isLeader1 && isLeader2) return 1;
          // Then group by member name A-Z (same as admin)
          const u1 = getUserName(g1.id_member) || "";
          const u2 = getUserName(g2.id_member) || "";
          const userComp = u1.localeCompare(u2, "vi");
          if (userComp !== 0) return userComp;
        } else if (isAdmin) {
          const u1 = getUserName(g1.id_member) || "";
          const u2 = getUserName(g2.id_member) || "";
          const userComp = u1.localeCompare(u2, "vi");
          if (userComp !== 0) return userComp;
        }
        const name1 = g1.group_name || "";
        const name2 = g2.group_name || "";
        return name1.localeCompare(name2, "vi");
      });
  }, [fbGroups, search, intentFilter, industryFilter, teamFilter, tierFilter, icpFilter, memberFilter, contentTypeFilter, productSeedingFilter, isAdmin, isLeader, user, myTeamMemberIds, teamsData, getUserName]);

  const filteredLi = useMemo(() => {
    return liGroups
      .filter((g) => {
        if (isLeader && user) {
          const isOwnerLeader = String(g.id_member) === String(user.id);
          const isOwnerMemberOfMyTeam = myTeamMemberIds.has(String(g.id_member));
          if (!isOwnerLeader && !isOwnerMemberOfMyTeam) {
            return false;
          }
        }

        const matchesSearch = !search ||
          g.group_name?.toLowerCase().includes(search.toLowerCase()) ||
          g.group_url?.toLowerCase().includes(search.toLowerCase());

        const matchesIntent = intentFilter === "all" || String((g as any).id_intent ?? "") === intentFilter;
        const matchesIndustry = industryFilter === "all" || String((g as any).id_industry ?? "") === industryFilter;

        let matchesTeam = true;
        if (teamFilter !== "all") {
          if (isAdmin) {
            const selectedTeam = teamsData.find(t => String(t.id) === teamFilter);
            matchesTeam = selectedTeam?.members?.some(m => String(m.id) === String(g.id_member)) || false;
          } else {
            matchesTeam = String((g as any).id_team ?? "") === teamFilter;
          }
        }

        const matchesTier = tierFilter === "all" || String((g as any).id_tier ?? "") === tierFilter;
        const matchesIcp = icpFilter === "all" || String((g as any).id_icp ?? "") === icpFilter;
        const matchesMember = memberFilter === "all" || String(g.id_member ?? "") === memberFilter;
        const matchesContentType = contentTypeFilter === "all" || String((g as any).id_content_type ?? "") === contentTypeFilter;
        const matchesProductSeeding = productSeedingFilter === "all" || String((g as any).id_product_seeding ?? "") === productSeedingFilter;

        return matchesSearch && matchesIntent && matchesIndustry && matchesTeam && matchesTier && matchesIcp && matchesMember && matchesContentType && matchesProductSeeding;
      })
      .sort((g1, g2) => {
        if (isLeader && user) {
          const isLeader1 = String(g1.id_member) === String(user.id);
          const isLeader2 = String(g2.id_member) === String(user.id);
          // Leader's own groups float to top
          if (isLeader1 && !isLeader2) return -1;
          if (!isLeader1 && isLeader2) return 1;
          // Then group by member name A-Z (same as admin)
          const u1 = getUserName(g1.id_member) || "";
          const u2 = getUserName(g2.id_member) || "";
          const userComp = u1.localeCompare(u2, "vi");
          if (userComp !== 0) return userComp;
        } else if (isAdmin) {
          const u1 = getUserName(g1.id_member) || "";
          const u2 = getUserName(g2.id_member) || "";
          const userComp = u1.localeCompare(u2, "vi");
          if (userComp !== 0) return userComp;
        }
        const name1 = g1.group_name || "";
        const name2 = g2.group_name || "";
        return name1.localeCompare(name2, "vi");
      });
  }, [liGroups, search, intentFilter, industryFilter, teamFilter, tierFilter, icpFilter, memberFilter, contentTypeFilter, productSeedingFilter, isAdmin, isLeader, user, myTeamMemberIds, teamsData, getUserName]);

  const handleDeleteGroup = async (id: string) => {
    const res = await allPlatformGroupsService.delete(id, platform);
    if (res.success) {
      await fetchGroups();
      setSuccess("Đã xóa nhóm và toàn bộ bài viết liên quan thành công");
    } else {
      setError(res.message || "Xóa thất bại");
    }
  };

  const handleFbSubmit = async (data: Partial<FbGroupFormData>) => {
    let res;
    const payload = {
      ...data,
      // ensure numeric fields are sent as numbers where backend expects
      members: data.members ? parseInt(data.members as string) : null,
      posts_per_week: data.posts_per_week ? parseInt(data.posts_per_week as string) : null,
      health_score: data.health_score ? parseInt(data.health_score as string) : null,
      start_time_in_day: data.start_time_in_day ? parseInt(data.start_time_in_day as string) : null,
      end_time_in_day: data.end_time_in_day ? parseInt(data.end_time_in_day as string) : null,
      time_crawl: data.time_crawl ? parseInt(data.time_crawl as string) : null,
      end_time_24h: data.end_time_24h || null,
      end_date_hour: data.end_date_hour || null,
    };
    if (editingGroup) {
      res = await allPlatformGroupsService.update({ ...payload, id: editingGroup.id }, "facebook");
    } else {
      res = await allPlatformGroupsService.add(payload, "facebook");
    }
    if (res.success) {
      await fetchGroups();
      setShowAddForm(false);
      setEditingGroup(null);
      setSuccess(editingGroup ? "Đã cập nhật nhóm" : "Đã thêm nhóm");
    } else {
      setError(res.message || "Thao tác thất bại");
    }
  };

  const handleLiSubmit = async (data: Partial<LiGroupFormData>) => {
    let res;
    if (editingGroup) {
      res = await allPlatformGroupsService.update({ ...data, id: editingGroup.id }, "linkedin");
    } else {
      res = await allPlatformGroupsService.add(data, "linkedin");
    }
    if (res.success) {
      await fetchGroups();
      setShowAddForm(false);
      setEditingGroup(null);
      setSuccess(editingGroup ? "Đã cập nhật nhóm" : "Đã thêm nhóm");
    } else {
      setError(res.message || "Thao tác thất bại");
    }
  };

  const currentGroups = platform === "facebook" ? filteredFb : filteredLi;
  const totalItems = currentGroups.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paginatedGroups = currentGroups.slice((page - 1) * pageSize, page * pageSize);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [platform, search, intentFilter, industryFilter, teamFilter, tierFilter, icpFilter, memberFilter, contentTypeFilter, productSeedingFilter]);

  return (
<div className="w-full space-y-6">      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-outline-variant bg-surface p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
        <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-primary/[0.06] blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl bg-primary/10 p-3">
              <MaterialIcon name="groups" className="text-primary text-3xl" />
            </div>
            <div>
              <h1 className="text-h1 text-on-surface font-bold tracking-tight">Quản lý nhóm</h1>
              <p className="text-body-md text-on-surface-variant">
                Danh sách nhóm Facebook &amp; LinkedIn dùng để thu thập dữ liệu
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setShowAddForm(true);
              setEditingGroup(null);
            }}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-on-primary-fixed-variant transition-all duration-200 ease-out shrink-0 cursor-pointer active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] hover:shadow-[0_4px_14px_-2px_rgba(217,55,55,0.45)]"
          >
            <FaPlus />
            Thêm nhóm
          </button>
        </div>
      </div>

      {/* Platform Tabs */}
      <div className="inline-flex w-full max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-low p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:w-fit">
        {PLATFORMS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => {
              setPlatform(key);
              setPage(1);
              setShowAddForm(false);
              setEditingGroup(null);
              setViewingGroupClassification(null);
              setSearch("");
              setIntentFilter("all");
              setIndustryFilter("all");
              setTeamFilter("all");
              setTierFilter("all");
              setIcpFilter("all");
              setContentTypeFilter("all");
              setProductSeedingFilter("all");
            }}
            className={`flex items-center gap-2 whitespace-nowrap px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ease-out cursor-pointer ${
              platform === key
                ? "bg-primary text-white shadow-[0_2px_8px_-1px_rgba(217,55,55,0.4)]"
                : "text-on-surface-variant hover:bg-surface hover:text-primary"
            }`}
          >
            <Icon className="text-lg" />
            {label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black ${
              platform === key ? "bg-white/20 text-white" : "bg-surface-container-highest text-on-surface-variant"
            }`}>
              {key === "facebook" ? filteredFb.length : filteredLi.length}
            </span>
          </button>
        ))}
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] animate-in fade-in">
          <span className="flex items-center gap-2 font-medium"><MaterialIcon name="error" className="text-base" />{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] animate-in fade-in">
          <span className="flex items-center gap-2 font-medium"><MaterialIcon name="check_circle" className="text-base" />{success}</span>
          <button onClick={() => setSuccess(null)} className="text-emerald-500 hover:text-emerald-700 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-surface-container-low flex flex-wrap items-center gap-3 rounded-2xl border border-outline-variant p-4 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
        <div className="relative min-w-[200px] flex-1">
          <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm" />
          <input
            type="text"
            placeholder="Tìm kiếm nhóm theo tên hoặc URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-[#333333] bg-surface focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl pl-9 pr-4 py-2 text-xs font-semibold text-on-surface outline-none transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]"
          />
        </div>

        <select
          value={intentFilter}
          onChange={(e) => setIntentFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
        >
          <option value="all">Tất cả Lĩnh vực</option>
          {categories.filter(c => c.category_type === 'intent').map((opt) => (
            <option key={opt.id} value={String(opt.id)}>{opt.name || opt.code}</option>
          ))}
        </select>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
        >
          <option value="all">Tất cả Industry</option>
          {categories.filter(c => c.category_type === 'industry').map((opt) => (
            <option key={opt.id} value={String(opt.id)}>{opt.name || opt.code}</option>
          ))}
        </select>

        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
        >
          <option value="all">Tất cả Team</option>
          {teamCategories.map((opt) => (
            <option key={String(opt.id)} value={String(opt.id)}>
              {opt.name || opt.code}
            </option>
          ))}
        </select>

        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[120px]"
        >
          <option value="all">Tất cả Tier</option>
          {categories.filter(c => c.category_type === 'tier').map((opt) => (
            <option key={opt.id} value={String(opt.id)}>{opt.name || opt.code}</option>
          ))}
        </select>

        <select
          value={icpFilter}
          onChange={(e) => setIcpFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
        >
          <option value="all">Tất cả ICP</option>
          {categories.filter(c => c.category_type === 'icp').map((opt) => (
            <option key={opt.id} value={String(opt.id)}>
              {opt.code} {opt.name ? `(${opt.name})` : ""}
            </option>
          ))}
        </select>

        {(isAdmin || isLeader) && (
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
          >
            <option value="all">Tất cả Thành viên</option>
            {userOptions
              .filter(u => {
                if (isAdmin) return true;
                if (isLeader) {
                  return String(u.id) === String(user?.id) || myTeamMemberIds.has(String(u.id));
                }
                return false;
              })
              .map((opt) => (
              <option key={opt.id} value={String(opt.id)}>
                {opt.name || opt.code}
              </option>
            ))}
          </select>
        )}

        <select
          value={contentTypeFilter}
          onChange={(e) => setContentTypeFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
        >
          <option value="all">Tất cả Loại nội dung</option>
          {categories.filter(c => c.category_type === 'content_type').map((opt) => (
            <option key={opt.id} value={String(opt.id)}>
              {opt.name || opt.code}
            </option>
          ))}
        </select>

        <select
          value={productSeedingFilter}
          onChange={(e) => setProductSeedingFilter(e.target.value)}
          className="border border-outline-variant bg-surface hover:bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/15 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] min-w-[130px]"
        >
          <option value="all">Tất cả SP Seeding</option>
          {categories.filter(c => c.category_type === 'product_seeding').map((opt) => (
            <option key={opt.id} value={String(opt.id)}>
              {opt.name || opt.code}
            </option>
          ))}
        </select>

        {(search !== "" ||
          intentFilter !== "all" ||
          industryFilter !== "all" ||
          teamFilter !== "all" ||
          tierFilter !== "all" ||
          icpFilter !== "all" ||
          memberFilter !== "all" ||
          contentTypeFilter !== "all" ||
          productSeedingFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setIntentFilter("all");
                setIndustryFilter("all");
                setTeamFilter("all");
                setTierFilter("all");
                setIcpFilter("all");
                setMemberFilter("all");
                setContentTypeFilter("all");
                setProductSeedingFilter("all");
              }}
              className="border border-primary-container/20 hover:border-primary-container/30 bg-primary-container/5 hover:bg-primary-container/10 hover:text-on-primary-fixed-variant text-primary-container flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold transition-all duration-200 ease-out cursor-pointer shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] active:scale-95"
              title="Xóa tất cả bộ lọc"
            >
              <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
              Xóa lọc
            </button>
          )}
      </div>

      {/* Center Modal Dialog Overlay for Add / Edit */}
      {(showAddForm || editingGroup) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(2, 6, 23, 0.5)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => {
            setShowAddForm(false);
            setEditingGroup(null);
          }}
        >
          <div
            className="bg-surface rounded-2xl border border-outline-variant shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
            style={{
              width: "100%",
              maxWidth: "680px",
              minWidth: "300px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
              <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">
                  {editingGroup ? "edit_square" : "add_circle"}
                </span>
                {editingGroup
                  ? `Sửa nhóm ${platform === "facebook" ? "Facebook" : "LinkedIn"}`
                  : `Thêm nhóm ${platform === "facebook" ? "Facebook" : "LinkedIn"} mới`}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingGroup(null);
                }}
                className="text-on-surface-variant hover:text-on-surface transition-all duration-200 ease-out cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto p-6">
              {platform === "facebook" ? (
                <FacebookGroupForm
                  intentOptions={categories.filter((c) => c.category_type === "intent")}
                  industryOptions={categories.filter((c) => c.category_type === "industry")}
                  teamOptions={teamCategories}
                  tierOptions={categories.filter((c) => c.category_type === "tier")}
                  icpOptions={categories.filter((c) => c.category_type === "icp").map(c => ({...c, name: `${c.code} ${c.name ? `(${c.name})` : ""}`.trim()}))}
                  contentTypeOptions={categories.filter((c) => c.category_type === "content_type")}
                  productSeedingOptions={categories.filter((c) => c.category_type === "product_seeding")}
                  userOptions={userOptions}
                  validUserIds={validUserIds}
                  nameHintById={nameHintById}
                  initial={
                    editingGroup
                      ? {
                          id_member: String((editingGroup as any).id_member ?? ""),
                          group_name: (editingGroup as FacebookGroup).group_name,
                          group_url: (editingGroup as FacebookGroup).group_url,
                          id_intent: String((editingGroup as any).id_intent ?? ""),
                          id_industry: String((editingGroup as any).id_industry ?? ""),
                          id_tier: String((editingGroup as any).id_tier ?? ""),
                          id_team: String((editingGroup as any).id_team ?? ""),
                          id_icp: String((editingGroup as any).id_icp ?? ""),
                          id_content_type: String((editingGroup as any).id_content_type ?? ""),
                          id_product_seeding: String((editingGroup as any).id_product_seeding ?? ""),
                          assignee_id: String((editingGroup as FacebookGroup).assignee_id ?? ""),
                          co_assignee_id: String((editingGroup as FacebookGroup).co_assignee_id ?? ""),
                          note: (editingGroup as FacebookGroup).note || "",
                          risk_note: (editingGroup as FacebookGroup).risk_note || "",
                          icp_desc: (editingGroup as FacebookGroup).icp_desc || "",
                          members: (editingGroup as FacebookGroup).members !== undefined && (editingGroup as FacebookGroup).members !== null ? String((editingGroup as FacebookGroup).members) : "",
                          posts_per_week: (editingGroup as FacebookGroup).posts_per_week !== undefined && (editingGroup as FacebookGroup).posts_per_week !== null ? String((editingGroup as FacebookGroup).posts_per_week) : "",
                          chay_24h: (editingGroup as FacebookGroup).chay_24h || false,
                          crawl_time: (editingGroup as any).crawl_time ? String((editingGroup as any).crawl_time).substring(0, 5) : "10:00",
                          crawl_frequency: (editingGroup as any).crawl_frequency || "daily",
                          start_time_in_day: (editingGroup as FacebookGroup).start_time_in_day !== undefined && (editingGroup as FacebookGroup).start_time_in_day !== null ? String((editingGroup as FacebookGroup).start_time_in_day) : "",
                          end_time_in_day: (editingGroup as FacebookGroup).end_time_in_day !== undefined && (editingGroup as FacebookGroup).end_time_in_day !== null ? String((editingGroup as FacebookGroup).end_time_in_day) : "",
                          time_crawl: (editingGroup as FacebookGroup).time_crawl || "",
                          end_time_24h: (editingGroup as FacebookGroup).end_time_24h ? String((editingGroup as FacebookGroup).end_time_24h).substring(0, 10) : "",
                          end_date_hour: (editingGroup as FacebookGroup).end_date_hour ? String((editingGroup as FacebookGroup).end_date_hour).substring(0, 10) : "",
                        }
                      : undefined
                  }
                  onSubmit={handleFbSubmit}
                  onCancel={() => {
                    setShowAddForm(false);
                    setEditingGroup(null);
                  }}
                />
              ) : (
                <LinkedInGroupForm
                  intentOptions={categories.filter((c) => c.category_type === "intent")}
                  industryOptions={categories.filter((c) => c.category_type === "industry")}
                  teamOptions={teamCategories}
                  tierOptions={categories.filter((c) => c.category_type === "tier")}
                  icpOptions={categories.filter((c) => c.category_type === "icp").map(c => ({...c, name: `${c.code} ${c.name ? `(${c.name})` : ""}`.trim()}))}
                  contentTypeOptions={categories.filter((c) => c.category_type === "content_type")}
                  productSeedingOptions={categories.filter((c) => c.category_type === "product_seeding")}
                  initial={
                    editingGroup
                      ? {
                          id_member: String((editingGroup as any).id_member ?? ""),
                          group_name: (editingGroup as LinkedInGroup).group_name,
                          group_url: (editingGroup as LinkedInGroup).group_url,
                          status: (editingGroup as LinkedInGroup).status || "idle",
                          id_intent: String((editingGroup as any).id_intent ?? ""),
                          id_industry: String((editingGroup as any).id_industry ?? ""),
                          id_tier: String((editingGroup as any).id_tier ?? ""),
                          id_team: String((editingGroup as any).id_team ?? ""),
                          id_icp: String((editingGroup as any).id_icp ?? ""),
                          id_content_type: String((editingGroup as any).id_content_type ?? ""),
                          id_product_seeding: String((editingGroup as any).id_product_seeding ?? ""),
                          assignee_id: String((editingGroup as LinkedInGroup).assignee_id ?? ""),
                          co_assignee_id: String((editingGroup as LinkedInGroup).co_assignee_id ?? ""),
                          note: (editingGroup as LinkedInGroup).note || "",
                          risk_note: (editingGroup as LinkedInGroup).risk_note || "",
                        }
                      : undefined
                  }
                  userOptions={userOptions}
                  validUserIds={validUserIds}
                  nameHintById={nameHintById}
                  onSubmit={handleLiSubmit}
                  onCancel={() => {
                    setShowAddForm(false);
                    setEditingGroup(null);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Groups table */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-9 h-9 border-[3px] border-outline-variant border-t-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-on-surface-variant text-xs font-medium">Đang tải dữ liệu...</p>
        </div>
      ) : currentGroups.length === 0 ? (
        <div className="text-center py-16 bg-surface-container-low/60 rounded-2xl border border-dashed border-outline-variant">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <MaterialIcon name="group" className="text-3xl text-primary" />
          </div>
          <p className="text-on-surface font-semibold text-sm">Chưa có nhóm nào</p>
          <p className="text-on-surface-variant text-xs mt-1">Thêm nhóm đầu tiên để bắt đầu theo dõi</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="mt-4 inline-flex items-center gap-1.5 bg-primary hover:bg-on-primary-fixed-variant text-white px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ease-out active:scale-95 shadow-[0_2px_8px_-1px_rgba(217,55,55,0.35)] cursor-pointer"
          >
            <FaPlus size={10} /> Thêm nhóm đầu tiên
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)]">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider">
                  Tên nhóm
                </th>
                <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[280px]">
                  Phân loại
                </th>
                {isLeader ? (
                  <>
                    <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[150px]">
                      Người phụ trách
                    </th>
                    <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[150px]">
                      Đồng phụ trách
                    </th>
                    <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[150px]">
                      Thành viên
                    </th>
                  </>
                ) : (
                  <>
                    <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[150px]">
                      {isAdmin ? "Thành viên" : "Người phụ trách"}
                    </th>
                    <th className="text-left px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[150px]">
                      {isAdmin ? "Team" : "Đồng phụ trách"}
                    </th>
                  </>
                )}
                <th className="text-right px-4 py-3.5 font-bold text-on-surface-variant text-[10px] uppercase tracking-wider w-[120px]">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {paginatedGroups.map((g) => {
                const isLeaderGroup = isLeader && user && String(g.id_member) === String(user.id);
                return (
                  <tr
                    key={g.id}
                    className={`transition-all duration-200 ease-out ${
                      isLeaderGroup
                        ? "bg-emerald-50/70 hover:bg-emerald-100/70"
                        : "hover:bg-primary/[0.03]"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <a
                        href={g.group_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-on-surface hover:text-primary hover:underline transition-all duration-200 ease-out block leading-snug"
                        title={g.group_name}
                      >
                        {g.group_name || "—"}
                      </a>
                      {platform === "facebook" && (
                        <div className="mt-1.5 text-xs text-on-surface-variant">
                          Thành viên: <span className="font-semibold text-on-surface">{Number((g as FacebookGroup).members) > 0 ? Number((g as FacebookGroup).members).toLocaleString("vi-VN") : "?"}</span> thành viên
                        </div>
                      )}
                      {platform === "linkedin" && (
                        <div className="mt-1">
                            <span className={`font-black px-1.5 py-0.5 rounded text-[9px] uppercase ${
                              (g as LinkedInGroup).status === "success"
                                ? "bg-green-100 text-green-700"
                                : (g as LinkedInGroup).status === "failed"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                            }`}>
                              {(g as LinkedInGroup).status || "idle"}
                            </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {platform === "facebook" && (g as FacebookGroup).chay_24h && (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md text-[10px] font-bold flex items-center gap-0.5" title={`Giờ chạy: ${(g as FacebookGroup).start_time_in_day}h - ${(g as FacebookGroup).end_time_in_day}h\nCách: ${(g as FacebookGroup).time_crawl} phút\nĐến: ${(g as FacebookGroup).end_time_24h ? String((g as FacebookGroup).end_time_24h).substring(0, 10) : ""}`}>
                            <span className="material-symbols-outlined text-[10px]">bolt</span> 24h Tự động
                          </span>
                        )}
                        {g.intent_name && <span className="px-2 py-0.5 bg-primary/10 text-primary rounded-md text-[10px] font-bold" title="Lĩnh vực">{g.intent_name}</span>}
                        {(g as any).id_team && getTeamName((g as any).id_team) !== "—" && <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded-md text-[10px] font-bold" title="Team">{getTeamName((g as any).id_team)}</span>}
                        {g.industry_name && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md text-[10px] font-bold" title="Industry">{g.industry_name}</span>}
                        {(g as any).content_type_name && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md text-[10px] font-bold" title="Content Type">{(g as any).content_type_name}</span>}
                        {(g as any).product_seeding_name && <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded-md text-[10px] font-bold" title="Product Seeding">{(g as any).product_seeding_name}</span>}
                        {(g as any).tier_name && <span className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-md text-[10px] font-bold" title="Tier">{(g as any).tier_name}</span>}
                        {g.icp_name && <span className="px-2 py-0.5 bg-pink-50 text-pink-700 rounded-md text-[10px] font-bold" title="ICP">{g.icp_name}</span>}
                        <button
                          onClick={() => setViewingGroupClassification(g)}
                          className="px-2 py-0.5 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-highest rounded-md text-[10px] font-bold transition-all duration-200 ease-out flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[10px]">more_horiz</span>
                          Thêm
                        </button>
                      </div>
                    </td>
                    {isLeader ? (
                      <>
                        <td className="px-4 py-3 text-xs font-medium text-on-surface">
                          {getUserName((g as any).assignee_id, (g as any).assignee_name_hint)}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-on-surface">
                          {getUserName((g as any).co_assignee_id, (g as any).co_assignee_name_hint)}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-on-surface">
                          {getUserName((g as any).id_member, (g as any).id_member_name_hint)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-xs font-medium text-on-surface">
                          {isAdmin ? getUserName((g as any).id_member, (g as any).id_member_name_hint) : getUserName((g as any).assignee_id, (g as any).assignee_name_hint)}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-on-surface">
                          {isAdmin ? getUserTeamName((g as any).id_member) : getUserName((g as any).co_assignee_id, (g as any).co_assignee_name_hint)}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingGroup(g);
                            setShowAddForm(false);
                          }}
                          title="Sửa"
                          className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-lg transition-all duration-200 ease-out cursor-pointer"
                        >
                          <FaEdit size={13} />
                        </button>
                        <button
                          onClick={() => setDeletingGroupItem(g)}
                          title="Xóa"
                          className="p-1.5 text-on-surface-variant hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200 ease-out cursor-pointer"
                        >
                          <FaTrash size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant bg-surface rounded-b-xl">
              <div className="text-sm text-on-surface-variant">
                Hiển thị <span className="font-bold text-on-surface">{(page - 1) * pageSize + 1}</span> đến <span className="font-bold text-on-surface">{Math.min(page * pageSize, totalItems)}</span> trong số <span className="font-bold text-on-surface">{totalItems}</span> nhóm
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 ease-out cursor-pointer"
                >
                  Trước
                </button>
                <div className="px-3 py-1 text-sm font-bold text-on-surface bg-surface-container-low rounded-xl border border-outline-variant">
                  {page} / {totalPages}
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 ease-out cursor-pointer"
                >
                  Sau
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal xem phân loại */}
      {viewingGroupClassification && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(2, 6, 23, 0.5)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setViewingGroupClassification(null)}
        >
          <div
            className="bg-surface rounded-2xl border border-outline-variant shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
            style={{
              width: "100%",
              maxWidth: "600px",
              minWidth: "300px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low flex-shrink-0">
              <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">
                  info
                </span>
                Chi tiết phân loại nhóm
              </h3>
              <button
                type="button"
                onClick={() => setViewingGroupClassification(null)}
                className="text-on-surface-variant hover:text-on-surface transition-all duration-200 ease-out cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Tên nhóm</span>
                <span className="text-sm font-bold text-on-surface break-all">{viewingGroupClassification.group_name || "—"}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-outline-variant pt-4">
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Lĩnh vực</span>
                  <span className="inline-flex bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {(viewingGroupClassification as any).intent_name || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Team</span>
                  <span className="inline-flex bg-teal-50 text-teal-700 border border-teal-200 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {getTeamName((viewingGroupClassification as any).id_team)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Ngành (Industry)</span>
                  <span className="inline-flex bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {(viewingGroupClassification as any).industry_name || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">ICP Target</span>
                  <span className="inline-flex bg-pink-50 text-pink-700 border border-pink-200 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {(viewingGroupClassification as any).icp_name || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Tier</span>
                  <span className="inline-flex bg-purple-50 text-purple-700 border border-purple-200 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {(viewingGroupClassification as any).tier_name || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Loại nội dung</span>
                  <span className="inline-flex bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {(viewingGroupClassification as any).content_type_name || "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">SP Seeding</span>
                  <span className="inline-flex bg-orange-50 text-orange-700 border border-orange-200 px-2.5 py-0.5 rounded-xl text-xs font-bold">
                    {(viewingGroupClassification as any).product_seeding_name || "—"}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Ghi chú rủi ro</span>
                  <div className={`text-sm p-3 rounded-xl border whitespace-pre-wrap ${(viewingGroupClassification as any).risk_note ? 'bg-[#FFF0F0] border-[#FFE0E0] text-red-700 font-medium' : 'bg-[#F9F9F9] border-outline-variant text-on-surface-variant'}`}>
                    {(viewingGroupClassification as any).risk_note || "—"}
                  </div>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Ghi chú chung</span>
                  <div className={`text-sm p-3 rounded-xl border whitespace-pre-wrap ${(viewingGroupClassification as any).note ? 'bg-surface-container-low border-outline-variant text-on-surface' : 'bg-[#F9F9F9] border-outline-variant text-on-surface-variant'}`}>
                    {(viewingGroupClassification as any).note || "—"}
                  </div>
                </div>
                {platform === "facebook" ? (
                  <>
                  <div>
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Chạy 24h</span>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-xl text-xs font-bold border ${(viewingGroupClassification as FacebookGroup).chay_24h ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-surface-container-low text-on-surface-variant border-outline-variant"}`}>
                      {(viewingGroupClassification as FacebookGroup).chay_24h ? "Có (⚡ Tự động)" : "Không"}
                    </span>
                  </div>
                  {(viewingGroupClassification as FacebookGroup).chay_24h && (
                    <>
                      <div>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Giờ chạy</span>
                        <span className="text-sm font-bold text-on-surface">
                          {String((viewingGroupClassification as any).crawl_time || "—").substring(0, 5)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Tần suất</span>
                        <span className="text-sm font-bold text-on-surface">
                          {(viewingGroupClassification as any).crawl_frequency === "weekly" ? "Hàng tuần" : "Hàng ngày"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Khung giờ</span>
                        <span className="text-sm font-bold text-on-surface">
                          {(viewingGroupClassification as FacebookGroup).start_time_in_day ?? "—"}h - {(viewingGroupClassification as FacebookGroup).end_time_in_day ?? "—"}h
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Khoảng cách cào</span>
                        <span className="text-sm font-bold text-on-surface">
                          {(viewingGroupClassification as FacebookGroup).time_crawl || "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Đến (khoảng giờ)</span>
                        <span className="text-sm font-bold text-on-surface">
                          {(viewingGroupClassification as FacebookGroup).end_date_hour ? String((viewingGroupClassification as FacebookGroup).end_date_hour).substring(0, 10) : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Đến (24h)</span>
                        <span className="text-sm font-bold text-on-surface">
                          {(viewingGroupClassification as FacebookGroup).end_time_24h ? String((viewingGroupClassification as FacebookGroup).end_time_24h).substring(0, 10) : "—"}
                        </span>
                      </div>
                    </>
                  )}
                  </>
                ) : (
                  <div>
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase block mb-1">Trạng thái</span>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-xl text-xs font-bold uppercase ${(viewingGroupClassification as LinkedInGroup).status === "success" ? "bg-green-100 text-green-700" : (viewingGroupClassification as LinkedInGroup).status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {(viewingGroupClassification as LinkedInGroup).status || "idle"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 border-t border-outline-variant px-6 py-4 bg-surface-container-low justify-end flex-shrink-0">
              <button
                type="button"
                onClick={() => setViewingGroupClassification(null)}
                className="bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold px-5 py-2 rounded-2xl hover:bg-surface-container-low text-sm transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] active:scale-95 cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận xóa */}
      {deletingGroupItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(2, 6, 23, 0.5)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setDeletingGroupItem(null)}
        >
          <div
            className="bg-surface rounded-2xl border border-outline-variant shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
            style={{
              width: "100%",
              maxWidth: "440px",
              minWidth: "300px",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-primary-container/5">
              <h3 className="text-sm font-bold text-primary-container flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary-container">
                  warning
                </span>
                Xác nhận xóa nhóm
              </h3>
              <button
                type="button"
                onClick={() => setDeletingGroupItem(null)}
                className="text-on-surface-variant hover:text-on-surface transition-all duration-200 ease-out cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-3">
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Bạn có chắc chắn muốn xóa nhóm <strong className="text-on-surface font-bold">{deletingGroupItem.group_name || "—"}</strong>?
              </p>
              <div className="bg-primary-container/10 border border-primary-container/20 rounded-2xl p-3 flex gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary-container shrink-0 select-none">
                  info
                </span>
                <span className="text-xs text-primary-container leading-normal">
                  <strong>Chú ý:</strong> Hành động này sẽ xóa vĩnh viễn nhóm này cùng với <strong>tất cả các bài viết</strong> thuộc nhóm này trong hệ thống. Thao tác này không thể hoàn tác!
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 border-t border-outline-variant px-6 py-4 bg-surface-container-low justify-end">
              <button
                type="button"
                onClick={() => setDeletingGroupItem(null)}
                className="bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface font-bold px-4 py-2 rounded-2xl hover:bg-surface-container-low text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] active:scale-95 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetId = deletingGroupItem.id;
                  setDeletingGroupItem(null);
                  await handleDeleteGroup(targetId);
                }}
                className="bg-primary-container text-white font-bold px-4 py-2 rounded-2xl hover:bg-on-primary-fixed-variant text-xs transition-all duration-200 ease-out shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_10px_-2px_rgba(16,24,40,0.06)] active:scale-95 cursor-pointer"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
