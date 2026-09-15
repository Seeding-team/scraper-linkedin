"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaterialIcon } from "@/components/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useZaloAccountOptions, useZaloConversationOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { getZaloGroupMembers, createZaloBulkJob } from "@/services/zaloCrawlerService";
import type { ZaloBulkJobType, ZaloGroupMember } from "@/types/zalo-api";

export function ZaloScanGroupMembersPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const { conversations, loading: loadingConversations } = useZaloConversationOptions(selectedAccountId);
  const [groupId, setGroupId] = useState("");
  const [members, setMembers] = useState<ZaloGroupMember[]>([]);
  const [totalMember, setTotalMember] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [jobType, setJobType] = useState<ZaloBulkJobType>("send_message");
  const [jobMessage, setJobMessage] = useState("");
  const [creatingJob, setCreatingJob] = useState(false);

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.trim().toLowerCase();
    return members.filter((m) => m.display_name.toLowerCase().includes(q) || m.uid.includes(q));
  }, [members, search]);

  async function handleScan() {
    if (!selectedAccountId || !groupId) {
      setError("Chọn tài khoản và nhóm cần quét.");
      return;
    }
    setScanning(true);
    setError(null);
    setMembers([]);
    setChecked(new Set());
    try {
      const res = await getZaloGroupMembers(selectedAccountId, groupId);
      setMembers(res.members);
      setTotalMember(res.total_member);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không quét được thành viên nhóm");
    } finally {
      setScanning(false);
    }
  }

  function toggleAll() {
    if (checked.size === filteredMembers.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(filteredMembers.map((m) => m.uid)));
    }
  }

  function toggleOne(uid: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function handleCreateJob() {
    setCreatingJob(true);
    setError(null);
    try {
      const recipients = members
        .filter((m) => checked.has(m.uid))
        .map((m) => ({ uid: m.uid, display_name: m.display_name }));
      await createZaloBulkJob({
        account_id: selectedAccountId,
        job_type: jobType,
        recipients,
        message: jobMessage.trim() || undefined,
        friend_message: jobMessage.trim() || undefined,
      });
      setJobDialogOpen(false);
      setJobMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được job");
    } finally {
      setCreatingJob(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Quét thành viên nhóm</h1>
            <p className="text-sm text-muted-foreground">
              Lấy đầy đủ danh sách thành viên 1 nhóm (không giới hạn ~155-200 như hiển thị Zalo), dùng để tạo job gửi hàng loạt.
            </p>
          </div>
          <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chọn nhóm cần quét</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Select value={groupId} onValueChange={setGroupId} disabled={loadingConversations}>
              <SelectTrigger className="w-80">
                <SelectValue placeholder="Chọn nhóm" />
              </SelectTrigger>
              <SelectContent>
                {conversations.map((c) => (
                  <SelectItem key={c.conversation_id} value={c.conversation_id}>
                    {c.conversation_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => void handleScan()} disabled={scanning || !groupId}>
              <MaterialIcon name="search" className="text-base" />
              {scanning ? "Đang quét..." : "Quét thành viên"}
            </Button>
          </CardContent>
        </Card>

        {members.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {totalMember} thành viên · đã chọn {checked.size}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Input placeholder="Tìm theo tên/uid..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-52" />
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {checked.size === filteredMembers.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </Button>
                <Button size="sm" disabled={checked.size === 0} onClick={() => setJobDialogOpen(true)}>
                  <MaterialIcon name="send" className="text-base" />
                  Tạo bulk-send từ {checked.size} người
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Thành viên</TableHead>
                    <TableHead>Vai trò</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.map((m) => (
                    <TableRow key={m.uid} className="cursor-pointer" onClick={() => toggleOne(m.uid)}>
                      <TableCell>
                        <Checkbox checked={checked.has(m.uid)} className="pointer-events-none" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={m.avatar_url || undefined} />
                            <AvatarFallback>{m.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{m.display_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.role === "admin" ? "Trưởng/phó nhóm" : "Thành viên"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tạo bulk-send job từ {checked.size} thành viên đã chọn</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div>
              <Label className="mb-2 block">Hành động</Label>
              <Select value={jobType} onValueChange={(v) => setJobType(v as ZaloBulkJobType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="send_message">Gửi tin nhắn</SelectItem>
                  <SelectItem value="add_friend">Gửi lời mời kết bạn</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="scan-msg">Nội dung tin nhắn</Label>
              <Textarea id="scan-msg" rows={3} value={jobMessage} onChange={(e) => setJobMessage(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJobDialogOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={() => void handleCreateJob()} disabled={creatingJob}>
              {creatingJob ? "Đang tạo..." : "Tạo job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
