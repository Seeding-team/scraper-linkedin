// src/modules/interaction/components/InteractionUI.tsx
"use client";

import React, { useEffect, useMemo } from "react";
import { useGetInteractions } from "../hooks/use-get-interaction";
import { MaterialIcon } from "@/components/ui";

export function InteractionUI() {
    const { interactions, isLoading, error, fetchInteractions } = useGetInteractions();

    useEffect(() => {
        fetchInteractions();
    }, [fetchInteractions]);

    const getInitials = (name: string) => {
        const words = name.trim().split(" ");
        if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    const renderRankIcon = (index: number) => {
        if (index === 0) return <span className="text-2xl drop-shadow-md">🥇</span>;
        if (index === 1) return <span className="text-2xl drop-shadow-md">🥈</span>;
        if (index === 2) return <span className="text-2xl drop-shadow-md">🥉</span>;
        return <span className="text-on-surface-variant font-semibold w-8 text-center">{index + 1}</span>;
    };

    // ==========================================
    // TÍNH TOÁN DỮ LIỆU CHO CÁC THẺ THỐNG KÊ
    // ==========================================
    const stats = useMemo(() => {
        if (!interactions || interactions.length === 0) {
            return { total: 0, avgScore: 0, active: 0, topUser: null };
        }

        const total = interactions.length;
        const totalScore = interactions.reduce((sum, user) => sum + (user.scorePerWeek || 0), 0);
        const avgScore = Math.round(totalScore / total);
        const active = interactions.filter(u => u.scorePerWeek > 0).length;

        const topUser = interactions.reduce((max, user) =>
            (user.scorePerWeek > max.scorePerWeek ? user : max), interactions[0]
        );

        return { total, avgScore, active, topUser };
    }, [interactions]);

    return (
        <div className="w-full">

            {/* HEADER */}
            <div className="flex items-center justify-between mb-lg">
                <h2 className="text-h2 text-on-surface font-semibold">
                    Thống Kê Tương Tác
                </h2>
                <button
                    onClick={fetchInteractions}
                    disabled={isLoading}
                    className="border-outline-variant bg-surface text-on-surface-variant flex items-center gap-2 rounded-lg border px-md py-sm text-xs font-bold uppercase tracking-wide disabled:opacity-50 hover:bg-surface-container transition-colors"
                >
                    <MaterialIcon name="refresh" className="shrink-0 text-[18px]" />
                    {isLoading ? "Đang tải..." : "Làm mới"}
                </button>
            </div>

            {error && (
                <div className="mb-md p-sm bg-error-container/40 border border-error-container text-error rounded-lg text-body-sm font-medium">
                    {error}
                </div>
            )}

            {/* THỐNG KÊ TỔNG QUAN */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md mb-xl">

                {/* Thẻ 1: Tổng Users */}
                <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-lg border-l-4 border-l-primary">
                    <p className="text-table-header text-on-surface-variant font-bold uppercase tracking-wider">
                        Tổng Users
                    </p>
                    <div className="text-3xl font-black text-on-surface mt-1">
                        {isLoading ? "–" : stats.total}
                    </div>
                    <div className="text-xs text-success font-medium mt-2">
                        ↑ tuần này
                    </div>
                </div>

                {/* Thẻ 2: Score Trung Bình */}
                <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-lg border-l-4 border-l-secondary">
                    <p className="text-table-header text-on-surface-variant font-bold uppercase tracking-wider">
                        Score Trung Bình
                    </p>
                    <div className="text-3xl font-black text-on-surface mt-1">
                        {isLoading ? "–" : stats.avgScore}
                    </div>
                    <div className="text-xs text-success font-medium mt-2">
                        ↑ {stats.active}/{stats.total} có data
                    </div>
                </div>

                {/* Thẻ 3: Đang Hoạt Động */}
                <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-lg border-l-4 border-l-warning">
                    <p className="text-table-header text-on-surface-variant font-bold uppercase tracking-wider">
                        Đang Hoạt Động
                    </p>
                    <div className="text-3xl font-black text-on-surface mt-1">
                        {isLoading ? "–" : stats.active}
                    </div>
                    <div className="text-xs text-success font-medium mt-2">
                        ↑ có điểm &gt; 0
                    </div>
                </div>

                {/* Thẻ 4: Top Tương Tác */}
                <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-lg border-l-4 border-l-error overflow-hidden">
                    <p className="text-table-header text-on-surface-variant font-bold uppercase tracking-wider">
                        Top Hôm Nay
                    </p>
                    <div className="text-2xl font-black text-on-surface mt-1 truncate" title={stats.topUser?.name || ""}>
                        {isLoading ? "–" : (stats.topUser?.name || "–")}
                    </div>
                    <div className="text-xs text-success font-medium mt-2">
                        ↑ Score: {stats.topUser?.scorePerWeek || 0}
                    </div>
                </div>
            </div>

            {/* BẢNG XẾP HẠNG */}
            <div className="flex flex-col gap-sm">
                {isLoading && interactions.length === 0 ? (
                    <div className="p-12 flex justify-center">
                        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : (
                    interactions.map((user, index) => {
                        const progressWidth = Math.min(Math.max(user.scorePerWeek, 0), 100);

                        return (
                            <div
                                key={user.id}
                                className="bg-surface-container-lowest rounded-xl border border-outline-variant p-md flex items-center gap-md hover:shadow-sm transition-shadow duration-200"
                            >
                                <div className="flex items-center justify-center w-10 shrink-0">
                                    {renderRankIcon(index)}
                                </div>

                                {/* Avatar initials */}
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                    index === 0 ? "bg-warning/20 text-warning" :
                                    index === 1 ? "bg-surface-container text-on-surface-variant" :
                                    index === 2 ? "bg-secondary/20 text-secondary" :
                                    "bg-primary/10 text-primary"
                                }`}>
                                    {getInitials(user.name)}
                                </div>

                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <div className="font-bold text-on-surface text-[15px] truncate mb-xs">
                                        {user.name}
                                    </div>
                                    <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden mt-xs">
                                        <div
                                            className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                                index < 3 ? "bg-success" : "bg-warning"
                                            }`}
                                            style={{ width: `${progressWidth}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="flex flex-col items-end shrink-0 pl-md border-l border-outline-variant">
                                    <span className={`text-xl font-bold ${
                                        index === 0 ? "text-success" :
                                        index === 1 ? "text-secondary" :
                                        index === 2 ? "text-primary" :
                                        "text-warning"
                                    }`}>
                                        {user.scorePerWeek}
                                    </span>
                                    <span className="text-[10px] uppercase font-medium text-on-surface-variant tracking-wider mt-0.5">
                                        AI Score
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}

                {!isLoading && interactions.length === 0 && !error && (
                    <div className="p-12 text-center text-on-surface-variant italic bg-surface-container-lowest rounded-xl border border-outline-variant">
                        Chưa có dữ liệu tương tác trong tuần này.
                    </div>
                )}
            </div>
        </div>
    );
}