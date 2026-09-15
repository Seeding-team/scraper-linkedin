"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaterialIcon } from "@/components/ui";
import { createZaloBulkJob } from "@/services/zaloCrawlerService";
import type { ZaloBulkJobRecipient, ZaloBulkJobType } from "@/types/zalo-api";

interface CreateBulkJobDialogProps {
  accountId: string;
  onCreated: () => void;
}

function parseRecipients(raw: string): ZaloBulkJobRecipient[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phoneOrUid, ...nameParts] = line.split(",").map((s) => s.trim());
      const displayName = nameParts.join(", ") || undefined;
      const isPhone = /^[0-9+][0-9+\s]{6,}$/.test(phoneOrUid);
      return isPhone
        ? { phone: phoneOrUid, display_name: displayName }
        : { uid: phoneOrUid, display_name: displayName };
    });
}

export function CreateBulkJobDialog({ accountId, onCreated }: CreateBulkJobDialogProps) {
  const [open, setOpen] = useState(false);
  const [jobType, setJobType] = useState<ZaloBulkJobType>("send_message");
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [message, setMessage] = useState("");
  const [friendMessage, setFriendMessage] = useState("");
  const [imageUrlsRaw, setImageUrlsRaw] = useState("");
  const [targetGroupName, setTargetGroupName] = useState("");
  const [delayMin, setDelayMin] = useState(3);
  const [delayMax, setDelayMax] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recipients = parseRecipients(recipientsRaw);

  async function handleSubmit() {
    if (recipients.length === 0) {
      setError("Cần ít nhất 1 số điện thoại hoặc UID.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createZaloBulkJob({
        account_id: accountId,
        job_type: jobType,
        recipients,
        message: message.trim() || undefined,
        friend_message: friendMessage.trim() || undefined,
        image_urls: imageUrlsRaw.split("\n").map((s) => s.trim()).filter(Boolean),
        target_group_name: targetGroupName.trim() || undefined,
        delay_seconds_min: delayMin,
        delay_seconds_max: delayMax,
      });
      setOpen(false);
      setRecipientsRaw("");
      setMessage("");
      setFriendMessage("");
      setImageUrlsRaw("");
      setTargetGroupName("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <MaterialIcon name="add" className="text-base" />
          Tạo job gửi hàng loạt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Tạo job gửi hàng loạt</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div>
            <Label className="mb-2 block">Hành động</Label>
            <Select value={jobType} onValueChange={(v) => setJobType(v as ZaloBulkJobType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send_message">Gửi tin nhắn</SelectItem>
                <SelectItem value="add_friend">Gửi lời mời kết bạn</SelectItem>
                <SelectItem value="invite_group">Mời vào nhóm</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="recipients">Danh sách SĐT hoặc UID (mỗi dòng 1 người, có thể thêm ", Tên" phía sau)</Label>
            <Textarea
              id="recipients"
              rows={5}
              placeholder={"0912345678, Chị Lan\n0987654321"}
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{recipients.length} người nhận hợp lệ</p>
          </div>

          {jobType === "send_message" && (
            <>
              <div>
                <Label htmlFor="msg">Nội dung tin nhắn</Label>
                <Textarea id="msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="images">Link ảnh đính kèm (mỗi dòng 1 link, tuỳ chọn)</Label>
                <Textarea id="images" rows={2} value={imageUrlsRaw} onChange={(e) => setImageUrlsRaw(e.target.value)} />
              </div>
            </>
          )}

          {jobType === "add_friend" && (
            <div>
              <Label htmlFor="friend-msg">Lời nhắn kèm lời mời kết bạn</Label>
              <Textarea id="friend-msg" rows={2} value={friendMessage} onChange={(e) => setFriendMessage(e.target.value)} />
            </div>
          )}

          {jobType === "invite_group" && (
            <>
              <div>
                <Label htmlFor="group-name">Tên/link nhóm cần mời vào</Label>
                <Input id="group-name" value={targetGroupName} onChange={(e) => setTargetGroupName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="msg2">Lời nhắn kèm</Label>
                <Textarea id="msg2" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="delay-min">Giãn cách tối thiểu (giây)</Label>
              <Input id="delay-min" type="number" min={1} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value) || 1)} />
            </div>
            <div>
              <Label htmlFor="delay-max">Giãn cách tối đa (giây)</Label>
              <Input id="delay-max" type="number" min={1} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value) || 1)} />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Đang tạo..." : "Tạo job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
