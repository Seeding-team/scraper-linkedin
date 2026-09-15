"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { MaterialIcon } from "@/components/ui";
import { createZaloCampaign, suggestZaloCampaignTemplates } from "@/services/zaloCrawlerService";

interface CampaignFormDialogProps {
  accountId: string;
  onCreated: () => void;
}

const DAYS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

export function CampaignFormDialog({ accountId, onCreated }: CampaignFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("20:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [intervalMin, setIntervalMin] = useState(30);
  const [intervalMax, setIntervalMax] = useState(90);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [templates, setTemplates] = useState<string[]>([""]);
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [brief, setBrief] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  async function handleSuggest() {
    if (!brief.trim()) {
      setError("Nhập mô tả ngắn về sản phẩm/kịch bản để AI gợi ý.");
      return;
    }
    setSuggesting(true);
    setError(null);
    try {
      const res = await suggestZaloCampaignTemplates(brief.trim());
      if (res.templates.length) setTemplates(res.templates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI gợi ý thất bại");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSubmit() {
    const cleanTemplates = templates.map((t) => t.trim()).filter(Boolean);
    if (!name.trim() || cleanTemplates.length === 0) {
      setError("Cần nhập tên chiến dịch và ít nhất 1 mẫu tin nhắn.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const recipients = recipientsRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [phone, ...rest] = line.split(",").map((s) => s.trim());
          return { phone, display_name: rest.join(", ") || undefined };
        });
      await createZaloCampaign({
        account_id: accountId,
        name: name.trim(),
        is_enabled: true,
        start_time: startTime,
        end_time: endTime,
        days_of_week: days,
        interval_seconds_min: intervalMin,
        interval_seconds_max: intervalMax,
        daily_limit: dailyLimit,
        message_templates: cleanTemplates,
        recipients: recipients.length ? recipients : undefined,
      });
      setOpen(false);
      setName("");
      setTemplates([""]);
      setRecipientsRaw("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được chiến dịch");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MaterialIcon name="add" className="text-base" />
          Tạo chiến dịch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo chiến dịch nhắn tin tự động</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div>
            <Label htmlFor="c-name">Tên chiến dịch</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Seeding sản phẩm A tháng 9" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="c-start">Giờ bắt đầu</Label>
              <Input id="c-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="c-end">Giờ kết thúc</Label>
              <Input id="c-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Ngày trong tuần</Label>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((d) => (
                <label key={d.value} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={days.includes(d.value)} onCheckedChange={() => toggleDay(d.value)} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="c-imin">Giãn cách tối thiểu (s)</Label>
              <Input id="c-imin" type="number" value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value) || 1)} />
            </div>
            <div>
              <Label htmlFor="c-imax">Giãn cách tối đa (s)</Label>
              <Input id="c-imax" type="number" value={intervalMax} onChange={(e) => setIntervalMax(Number(e.target.value) || 1)} />
            </div>
            <div>
              <Label htmlFor="c-limit">Giới hạn/ngày</Label>
              <Input id="c-limit" type="number" value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value) || 1)} />
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface-container/40 p-3">
            <Label htmlFor="c-brief" className="mb-1 block">Mô tả ngắn cho AI gợi ý nội dung (tuỳ chọn)</Label>
            <div className="flex gap-2">
              <Input id="c-brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="VD: giới thiệu khoá học online, giọng thân thiện" />
              <Button type="button" variant="outline" size="sm" onClick={() => void handleSuggest()} disabled={suggesting}>
                <MaterialIcon name="auto_awesome" className="text-base" />
                {suggesting ? "Đang gợi ý..." : "AI gợi ý"}
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Mẫu tin nhắn (xoay vòng, dùng {"{{ten}}"} để cá nhân hoá)</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTemplates((prev) => [...prev, ""])}>
                <MaterialIcon name="add" className="text-base" />
                Thêm mẫu
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {templates.map((t, idx) => (
                <div key={idx} className="flex gap-2">
                  <Textarea
                    rows={2}
                    value={t}
                    onChange={(e) => setTemplates((prev) => prev.map((x, i) => (i === idx ? e.target.value : x)))}
                    placeholder={`Mẫu ${idx + 1}: Chào {{ten}}, ...`}
                  />
                  {templates.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => setTemplates((prev) => prev.filter((_, i) => i !== idx))}>
                      <MaterialIcon name="close" className="text-base" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="c-recipients">Danh sách người nhận (SĐT, mỗi dòng 1 người — tuỳ chọn, có thể thêm sau)</Label>
            <Textarea id="c-recipients" rows={3} value={recipientsRaw} onChange={(e) => setRecipientsRaw(e.target.value)} placeholder={"0912345678, Chị Lan"} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Đang tạo..." : "Tạo chiến dịch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
