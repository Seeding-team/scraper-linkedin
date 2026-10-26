"use client";

import { MaterialIcon } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ZaloAccountInfo } from "@/types/zalo-api";

interface ZaloAccountPickerProps {
  accounts: ZaloAccountInfo[];
  value: string;
  onChange: (accountId: string) => void;
  loading?: boolean;
}

export function ZaloAccountPicker({ accounts, value, onChange, loading }: ZaloAccountPickerProps) {
  if (loading) {
    return <div className="h-9 w-64 animate-pulse rounded-md bg-surface-container-highest" />;
  }
  if (accounts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        <MaterialIcon name="info" className="text-base" />
        Chưa có tài khoản Zalo nào đã đăng nhập.
      </div>
    );
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Chọn tài khoản Zalo" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.account_id} value={a.account_id}>
            {a.label || a.account_id}
            {a.phone ? ` · ${a.phone}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
