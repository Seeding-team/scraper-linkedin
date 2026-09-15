"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MaterialIcon } from "@/components/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useZaloAccountOptions } from "../centralized-shared/useZaloAccountOptions";
import { ZaloAccountPicker } from "../centralized-shared/ZaloAccountPicker";
import { CampaignFormDialog } from "./CampaignFormDialog";
import {
  deleteZaloCampaign,
  listZaloCampaignLogs,
  listZaloCampaignRecipients,
  listZaloCampaigns,
  patchZaloCampaign,
} from "@/services/zaloCrawlerService";
import type { ZaloCampaign, ZaloCampaignLog, ZaloCampaignRecipient } from "@/types/zalo-api";

export function ZaloCampaignsPageContent() {
  const { accounts, selectedAccountId, setSelectedAccountId, loading: loadingAccounts } = useZaloAccountOptions();
  const [campaigns, setCampaigns] = useState<ZaloCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<ZaloCampaign | null>(null);
  const [recipients, setRecipients] = useState<ZaloCampaignRecipient[]>([]);
  const [logs, setLogs] = useState<ZaloCampaignLog[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const reload = useCallback(async () => {
    if (!selectedAccountId) {
      setCampaigns([]);
      return;
    }
    setLoadingCampaigns(true);
    setError(null);
    try {
      const res = await listZaloCampaigns(selectedAccountId);
      setCampaigns(res.campaigns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách chiến dịch");
    } finally {
      setLoadingCampaigns(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleToggle(c: ZaloCampaign) {
    setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_enabled: !x.is_enabled } : x)));
    try {
      await patchZaloCampaign(selectedAccountId, c.id, { is_enabled: !c.is_enabled });
    } catch (e) {
      setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_enabled: c.is_enabled } : x)));
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái");
    }
  }

  async function handleDelete(c: ZaloCampaign) {
    if (!confirm(`Xoá chiến dịch "${c.name}"?`)) return;
    try {
      await deleteZaloCampaign(selectedAccountId, c.id);
      setCampaigns((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xoá được chiến dịch");
    }
  }

  async function openDetail(c: ZaloCampaign) {
    setDetailCampaign(c);
    setLoadingDetail(true);
    try {
      const [r, l] = await Promise.all([
        listZaloCampaignRecipients(selectedAccountId, c.id),
        listZaloCampaignLogs(selectedAccountId, c.id),
      ]);
      setRecipients(r.recipients);
      setLogs(l.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được chi tiết chiến dịch");
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f9fa] p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Chiến dịch nhắn tin tự động</h1>
            <p className="text-sm text-muted-foreground">
              Nhắn tin lặp lịch theo khung giờ/ngày trong tuần, xoay vòng mẫu tin, gợi ý nội dung bằng AI.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ZaloAccountPicker accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} loading={loadingAccounts} />
            {selectedAccountId && <CampaignFormDialog accountId={selectedAccountId} onCreated={reload} />}
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Danh sách chiến dịch</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCampaigns ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Đang tải...</div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <MaterialIcon name="campaign" className="text-3xl text-muted-foreground" />
                Chưa có chiến dịch nào. Bấm "Tạo chiến dịch" để bắt đầu.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {campaigns.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <button className="flex flex-1 items-center gap-3 text-left" onClick={() => void openDetail(c)}>
                      <Switch checked={c.is_enabled} onCheckedChange={() => void handleToggle(c)} onClick={(e) => e.stopPropagation()} />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.start_time?.slice(0, 5)}-{c.end_time?.slice(0, 5)} · {c.sent_today}/{c.daily_limit} hôm nay
                        </p>
                      </div>
                    </button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void handleDelete(c)}>
                      <MaterialIcon name="delete" className="text-base" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!detailCampaign} onOpenChange={(open) => !open && setDetailCampaign(null)}>
        <SheetContent className="w-full max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detailCampaign?.name}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            {loadingDetail ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Đang tải...</div>
            ) : (
              <Tabs defaultValue="recipients">
                <TabsList>
                  <TabsTrigger value="recipients">Người nhận ({recipients.length})</TabsTrigger>
                  <TabsTrigger value="logs">Log gửi ({logs.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="recipients">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Người nhận</TableHead>
                        <TableHead>Trạng thái</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipients.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{r.display_name || r.phone || r.uid}</TableCell>
                          <TableCell className="text-xs">{r.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
                <TabsContent value="logs">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SĐT</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Thời gian</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs">{l.phone}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={l.status === "success" ? "border-green-200 bg-green-100 text-green-700" : "border-red-200 bg-red-100 text-red-700"}>
                              {l.status === "success" ? "Thành công" : "Thất bại"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("vi-VN")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
