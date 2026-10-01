"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { allPlatformPostsService } from "@/services/all-platform.service";
import type { TeamSeedingEfficiency } from "@/types/unified.types";

interface TeamEfficiencyWidgetProps {
  email: string;
}

/** "Hiệu quả theo team" — Dashboard leader (Seeding bên ngoài). Admin thấy mọi team,
 * leader chỉ thấy team mình quản lý. Dữ liệu tính trong ngày (giờ VN), không phải luỹ kế. */
export function TeamEfficiencyWidget({ email }: TeamEfficiencyWidgetProps) {
  const [teams, setTeams] = useState<TeamSeedingEfficiency[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await allPlatformPostsService.getTeamsSeedingEfficiency(email);
      if (res.success && res.data) {
        setTeams(res.data.teams || []);
      } else {
        setError(res.message || "Không tải được hiệu quả theo team.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi không xác định.");
    } finally {
      setIsLoading(false);
    }
  }, [email]);

  useEffect(() => {
    load();
  }, [load]);

  const maxVerified = Math.max(1, ...teams.map((t) => t.total_verified_today));

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h4 className="text-sm font-bold text-foreground">Hiệu quả theo team</h4>
        <span className="ml-auto text-[11px] text-muted-foreground">Hôm nay</span>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 bg-muted rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="text-xs text-red-600">{error}</div>
        ) : teams.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">Chưa có team nào để hiển thị.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {teams.map((t, idx) => {
              const pct = Math.round((t.total_verified_today / maxVerified) * 100);
              const rate = t.total_members > 0 ? Math.round((t.active_members_today / t.total_members) * 100) : 0;
              return (
                <div key={t.team_id} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-foreground truncate">{t.team_name}</span>
                      <span className="text-xs font-bold text-foreground shrink-0">{rate}%</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mb-1">
                      {t.total_seeded_today} bài · {t.total_verified_today} verify · {t.active_members_today}/{t.total_members} thành viên hoạt động
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
