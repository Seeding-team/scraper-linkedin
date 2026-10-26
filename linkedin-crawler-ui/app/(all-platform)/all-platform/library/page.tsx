"use client";

import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  useQuickInboxLibrary,
  type QuickInboxLibraryEntry,
} from "@/hooks/useQuickInboxLibrary";
import {
  useQuickCommentLibrary,
  type QuickCommentTemplate,
} from "@/hooks/useQuickCommentLibrary";

const INBOX_LABELS = ["Chào hỏi", "Follow-up", "Chốt đơn", "Giới thiệu", "CSKH", "Khác"];
const COMMENT_LABELS = ["Khen ngợi", "Hỏi giá", "Quan tâm", "Chia sẻ trải nghiệm", "Khác"];
const PLATFORMS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Tất cả nền tảng" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
];

function textFilter(text: string, filter: string) {
  return text.toLowerCase().includes(filter.trim().toLowerCase());
}

function InboxLibraryPanel() {
  const {
    libraryItems,
    isLoaded,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    moveTemplate,
  } = useQuickInboxLibrary();

  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState({ title: "", label: "", content: "", contentWithPost: "" });

  const filteredItems = useMemo(() => {
    return libraryItems.filter((item: QuickInboxLibraryEntry) => {
      const matchesLabel = selectedLabel ? item.label === selectedLabel : true;
      const matchesText =
        !search.trim() ||
        textFilter(item.title, search) ||
        textFilter(item.label, search) ||
        textFilter(item.content, search);
      return matchesLabel && matchesText;
    });
  }, [libraryItems, search, selectedLabel]);

  const handleOpenNew = () => {
    setEditingId(null);
    setDraft({ title: "", label: "", content: "", contentWithPost: "" });
  };

  const handleEdit = (item: QuickInboxLibraryEntry) => {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      label: item.label,
      content: item.content,
      contentWithPost: item.contentWithPost || "",
    });
  };

  const handleSave = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    setIsSaving(true);
    const payload = {
      title: draft.title,
      label: draft.label || "Khác",
      content: draft.content,
      contentWithPost: draft.contentWithPost || undefined,
    };
    if (editingId) {
      await updateTemplate(editingId, payload);
    } else {
      await createTemplate(payload);
    }
    setIsSaving(false);
    handleOpenNew();
  };

  if (!isLoaded) {
    return <div className="p-6 text-sm text-muted-foreground">Đang tải thư viện...</div>;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="rounded-[28px] border border-border bg-white/90 p-5 shadow-sm shadow-slate-200/20">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              placeholder="Tìm kiếm title / label / nội dung..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button variant="outline" type="button" onClick={() => setSearch("")}>Xóa</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${selectedLabel === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              onClick={() => setSelectedLabel("")}
            >
              Tất cả
            </button>
            {INBOX_LABELS.map((label) => (
              <button
                key={label}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${selectedLabel === label ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setSelectedLabel(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="grid gap-4">
          {filteredItems.length === 0 ? (
            <div className="rounded-[28px] border border-border bg-surface p-6 text-sm text-muted-foreground shadow-sm shadow-slate-200/10">
              Không có mẫu phù hợp. Vui lòng thêm mẫu mới hoặc thay đổi bộ lọc.
            </div>
          ) : (
            filteredItems.map((item) => (
              <div key={item.id} className="rounded-[28px] border border-border bg-white/95 p-5 shadow-sm shadow-slate-200/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="outline">{item.label}</Badge>
                      <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-6">{item.content}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => moveTemplate(item.id, "up")}> <MaterialIcon name="arrow_upward" /> </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => moveTemplate(item.id, "down")}> <MaterialIcon name="arrow_downward" /> </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleEdit(item)}> <MaterialIcon name="edit" /> </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => deleteTemplate(item.id)}> <MaterialIcon name="delete" /> </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-[28px] border border-border bg-card/90 p-5 shadow-sm shadow-slate-200/20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Thêm / sửa mẫu inbox</h2>
            <Button type="button" size="sm" variant="outline" onClick={handleOpenNew}>
              <MaterialIcon name="add" /> Mẫu mới
            </Button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Title</label>
              <Input
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Tên mẫu hiển thị"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Label</label>
              <Input
                value={draft.label}
                onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="Ví dụ: Chào hỏi, Follow-up"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Nội dung chính</label>
              <Textarea
                value={draft.content}
                onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
                placeholder="Nội dung mẫu câu"
                rows={4}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Nội dung có chèn bài khách</label>
              <Textarea
                value={draft.contentWithPost}
                onChange={(event) => setDraft((prev) => ({ ...prev, contentWithPost: event.target.value }))}
                placeholder="Nội dung dùng khi có bài khách (có thể chứa {post})"
                rows={4}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {editingId ? "Lưu thay đổi" : "Lưu mẫu"}
              </Button>
              <Button type="button" variant="outline" onClick={handleOpenNew}>
                Hủy
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CommentLibraryPanel() {
  const {
    libraryItems,
    isLoaded,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    moveTemplate,
  } = useQuickCommentLibrary();

  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState({ title: "", label: "", content: "", platform: "all" });

  const filteredItems = useMemo(() => {
    return libraryItems.filter((item: QuickCommentTemplate) => {
      const matchesLabel = selectedLabel ? item.label === selectedLabel : true;
      const matchesText =
        !search.trim() ||
        textFilter(item.title, search) ||
        textFilter(item.label, search) ||
        textFilter(item.content, search);
      return matchesLabel && matchesText;
    });
  }, [libraryItems, search, selectedLabel]);

  const handleOpenNew = () => {
    setEditingId(null);
    setDraft({ title: "", label: "", content: "", platform: "all" });
  };

  const handleEdit = (item: QuickCommentTemplate) => {
    setEditingId(item.id);
    setDraft({ title: item.title, label: item.label, content: item.content, platform: item.platform });
  };

  const handleSave = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return;
    setIsSaving(true);
    const payload = {
      title: draft.title,
      label: draft.label || "Khác",
      content: draft.content,
      platform: draft.platform,
    };
    if (editingId) {
      await updateTemplate(editingId, payload);
    } else {
      await createTemplate(payload);
    }
    setIsSaving(false);
    handleOpenNew();
  };

  if (!isLoaded) {
    return <div className="p-6 text-sm text-muted-foreground">Đang tải thư viện...</div>;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="rounded-[28px] border border-border bg-white/90 p-5 shadow-sm shadow-slate-200/20">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              placeholder="Tìm kiếm title / label / nội dung..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button variant="outline" type="button" onClick={() => setSearch("")}>Xóa</Button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${selectedLabel === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
              onClick={() => setSelectedLabel("")}
            >
              Tất cả
            </button>
            {COMMENT_LABELS.map((label) => (
              <button
                key={label}
                type="button"
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${selectedLabel === label ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                onClick={() => setSelectedLabel(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="grid gap-4">
          {filteredItems.length === 0 ? (
            <div className="rounded-[28px] border border-border bg-surface p-6 text-sm text-muted-foreground shadow-sm shadow-slate-200/10">
              Không có mẫu phù hợp. Vui lòng thêm mẫu mới hoặc thay đổi bộ lọc.
            </div>
          ) : (
            filteredItems.map((item) => (
              <div key={item.id} className="rounded-[28px] border border-border bg-white/95 p-5 shadow-sm shadow-slate-200/20">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge variant="outline">{item.label}</Badge>
                      <Badge variant="outline">{item.platform}</Badge>
                      <span className="text-sm font-semibold text-foreground truncate">{item.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 leading-6">{item.content}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => moveTemplate(item.id, "up")}> <MaterialIcon name="arrow_upward" /> </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => moveTemplate(item.id, "down")}> <MaterialIcon name="arrow_downward" /> </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleEdit(item)}> <MaterialIcon name="edit" /> </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => deleteTemplate(item.id)}> <MaterialIcon name="delete" /> </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-[28px] border border-border bg-card/90 p-5 shadow-sm shadow-slate-200/20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Thêm / sửa mẫu comment</h2>
            <Button type="button" size="sm" variant="outline" onClick={handleOpenNew}>
              <MaterialIcon name="add" /> Mẫu mới
            </Button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Title</label>
              <Input
                value={draft.title}
                onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Tên mẫu hiển thị"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Label</label>
              <Input
                value={draft.label}
                onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="Ví dụ: Khen ngợi, Hỏi giá"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Nền tảng</label>
              <select
                className="w-full rounded-xl border border-input bg-background p-2.5 text-sm"
                value={draft.platform}
                onChange={(event) => setDraft((prev) => ({ ...prev, platform: event.target.value }))}
              >
                {PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Nội dung comment</label>
              <Textarea
                value={draft.content}
                onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
                placeholder="Nội dung mẫu câu comment"
                rows={4}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {editingId ? "Lưu thay đổi" : "Lưu mẫu"}
              </Button>
              <Button type="button" variant="outline" onClick={handleOpenNew}>
                Hủy
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<"inbox" | "comment">("inbox");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "comment" || tab === "inbox") setActiveTab(tab);
  }, []);

  return (
    <div className="space-y-6 p-6 bg-surface min-h-screen text-foreground">
      <div className="rounded-[32px] border border-border bg-card/90 p-6 shadow-sm shadow-slate-200/30">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Thư viện mẫu câu</h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-7">
            Quản lý mẫu câu dùng cho Inbox ngay và Seeding Comment hàng loạt. Mọi người có thể xem và chọn dùng tuỳ thích.
          </p>
        </div>

        <div className="mt-5 flex gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => setActiveTab("inbox")}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition ${activeTab === "inbox" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Inbox nhanh
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("comment")}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition ${activeTab === "comment" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Mẫu Comment
          </button>
        </div>
      </div>

      {activeTab === "inbox" ? <InboxLibraryPanel /> : <CommentLibraryPanel />}
    </div>
  );
}
