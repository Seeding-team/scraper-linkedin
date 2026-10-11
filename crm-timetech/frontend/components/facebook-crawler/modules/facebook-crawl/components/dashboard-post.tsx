// src/modules/post/components/DashboardPosts.tsx
"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FaFacebook, FaLinkedin } from "react-icons/fa";
import { useGetIntents } from "../hooks/use-get-intents";
import { useFetchAllPosts } from "../hooks/use-get-data-fb";
import { DataFBResponse } from "../types/data-fb.type";
import { PostCard } from "./post-card";
import { useGetPresetGroups } from "../hooks/use-get-preset-groups";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { useAppPlatform } from "@/components/providers/AppPlatformProvider";
import {
  PlatformStatCard,
  PlatformStatsRow,
} from "@/components/features/shared/PlatformStatCard";
import { MaterialIcon } from "@/components/ui";
import type { AppPlatform } from "@/lib/app-platform";
import { getAllSeedingMarks, getUnverifiedSeedingMarks, markSeeding, verifySeedingMark } from "@/services/linkedinCrawlerService";
import { useGetCategoriesQuery } from "../hooks/use-get-categories-query";
import { allPlatformCategoriesService, teamsService, socialAccountsService } from "@/services/all-platform.service";
import type { Category, SocialAccount } from "@/types/unified.types";

// Declare chrome for extension API
declare const chrome: {
  runtime: {
    sendMessage: (message: any, callback?: (response: any) => void) => void;
    lastError?: { message: string };
  };
};

// ─── KPI Check Types ─────────────────────────────────────────────────────────
interface KpiCheckResult {
  link_post: string;
  group_name: string;
  content: string;
  status: "seeded" | "success" | "not_seeded" | "already_saved" | "error" | "pending";
  message?: string;
  link_comment?: string;
}

// ============================================================================
// 1. CÁC HÀM HELPER PURE (ĐẶT NGOÀI COMPONENT)
// Giải quyết triệt để lỗi TDZ (Cannot access before initialization) và tối ưu RAM
// ============================================================================

// Nhận diện nền tảng mạng xã hội dựa trên URL
const detectPlatform = (post: DataFBResponse) => {
    const targetUrl = post.link_group || post.url || "";
    return targetUrl.includes("linkedin.com") ? "LinkedIn" : "Facebook";
};

// Render Icon Platform tương ứng
const renderPlatformIcon = (platform: string) => {
    if (platform === "LinkedIn") {
        return <FaLinkedin className="text-blue-700 text-xs shrink-0" title="LinkedIn" />;
    }
    return <FaFacebook className="text-blue-600 text-xs shrink-0" title="Facebook" />;
};

// ═══════════════════════════════════════════════════════════════════════════
// TIMEZONE HELPERS (Vietnam UTC+7)
// ═══════════════════════════════════════════════════════════════════════════

const VIETNAM_OFFSET_HOURS = 7;

/** Lấy ngày hiện tại theo giờ Việt Nam, trả về Date object */
function getVietnamNow(): Date {
    return new Date(Date.now() + VIETNAM_OFFSET_HOURS * 60 * 60 * 1000);
}

/** Lấy chuỗi YYYY-MM-DD theo giờ Việt Nam */
function getVietnamDateStr(): string {
    return getVietnamNow().toISOString().split("T")[0];
}

/** Lấy ngày hôm qua theo giờ Việt Nam */
function getVietnamYesterdayStr(): string {
    const d = getVietnamNow();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
}

// Trích xuất chuỗi 10 ký tự ngày chuẩn (YYYY-MM-DD) từ string hoặc Date Object
// Backend lưu datetime theo server local (UTC+7) dạng "YYYY-MM-DD HH:MM:SS"
// Frontend parse string -> JS hiểu là UTC -> bị lệch 7 tiếng
// => Lấy date string trực tiếp, KHÔNG parse qua Date object
const getDatePart = (dateInput?: Date | string | null) => {
    if (!dateInput) return "";
    if (typeof dateInput === "string") {
        const normalized = dateInput.replace(" ", "T");
        const datePart = normalized.split("T")[0];
        if (datePart.length === 10) {
            return datePart;
        }
        return normalized.substring(0, 10);
    }
    try {
        return dateInput.toISOString().split("T")[0];
    } catch (e) {
        return "";
    }
};

// Trích xuất chuỗi ngày hiển thị thân thiện (DD/MM/YYYY)
const getCompactDateString = (dateInput?: Date | string | null) => {
    if (!dateInput) return "";
    try {
        if (dateInput instanceof Date) {
            return dateInput.toLocaleDateString('vi-VN');
        }
        const safeStr = dateInput.replace(" ", "T");
        return new Date(safeStr).toLocaleDateString('vi-VN');
    } catch (e) {
        return "";
    }
};

// Chuyển đổi dữ liệu thời gian sang dạng số (Timestamp) để phục vụ sắp xếp mới nhất
const getDateTimestamp = (dateInput?: Date | string | null) => {
    if (!dateInput) return 0;
    try {
        if (dateInput instanceof Date) return dateInput.getTime();
        return new Date(dateInput.replace(" ", "T")).getTime();
    } catch (e) {
        return 0;
    }
};

// Render UI động hiển thị so sánh chênh lệch giữa 2 mốc số liệu
const renderComparisonUI = (todayCount: number, yesterdayCount: number) => {
    const diff = todayCount - yesterdayCount;
    
    if (diff > 0) {
        return (
            <p className="text-xs text-emerald-600 font-medium mt-3">
                ↑ {diff} so với hôm qua
            </p>
        );
    } else if (diff < 0) {
        return (
            <p className="text-xs text-rose-500 font-medium mt-3">
                ↓ {Math.abs(diff)} so với hôm qua
            </p>
        );
    }
    return (
        <p className="text-xs text-slate-400 font-medium mt-3">
            ↔ Bằng với hôm qua
        </p>
    );
};

// ============================================================================
// 2. COMPONENT CHÍNH
// ============================================================================
export function DashboardPosts({
    forcedPlatform = null,
    hideStats = false,
}: {
    /** Khóa feed theo nền tảng sidebar (facebook / linkedin). */
    forcedPlatform?: AppPlatform | null;
    hideStats?: boolean;
}) {
    const { platform } = useAppPlatform();
    // States bộ lọc & sắp xếp
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [intentFilter, setIntentFilter] = useState<string>("all");
    const [industryFilter, setIndustryFilter] = useState<string>("all");
    const [teamFilter, setTeamFilter] = useState<string>("all");
    const [tierFilter, setTierFilter] = useState<string>("all");
    const [platformFilter, setPlatformFilter] = useState<string>("all");
    const [sortBy, setSortBy] = useState<string>("latest"); 

    // States phân trang
    const [currentPage, setCurrentPage] = useState<number>(1);
    const itemsPerPage = 6;

    // State lưu trữ dữ liệu bài viết đang được mở trong Modal
    const [selectedPostForModal, setSelectedPostForModal] = useState<DataFBResponse | null>(null);

    // KPI Check states
    const [isKpiChecking, setIsKpiChecking] = useState(false);
    const [kpiResults, setKpiResults] = useState<KpiCheckResult[]>([]);
    const [kpiModalOpen, setKpiModalOpen] = useState(false);
    const [kpiProgress, setKpiProgress] = useState({ current: 0, total: 0 });

    const [fbProfileId, setFbProfileId] = useState("");
    const [fbName, setFbName] = useState("");
    const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string>("");
    const [kpiStage, setKpiStage] = useState<"input" | "checking" | "done">("input");

    // Track seeding status: link_post -> "pending" (chưa verify) | "yes" (đã verify)
    const [seedingStatus, setSeedingStatus] = useState<Record<string, string>>({});
    const [seedingLoading, setSeedingLoading] = useState(false);

    // Gọi Hooks fetch dữ liệu
    const d = useDashboard();

    // Tải cấu hình trước đó từ localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            setSelectedAccountId(localStorage.getItem("kpi_selected_social_account_id") || "");
        }
    }, []);

    // Load social accounts when modal opens
    useEffect(() => {
        if (kpiModalOpen) {
            socialAccountsService.getAll("facebook").then((res) => {
                if (res.success && res.data) {
                    setSocialAccounts(res.data);
                    if (!selectedAccountId && res.data.length > 0) {
                        setSelectedAccountId(res.data[0].id);
                    }
                }
            }).catch(e => console.error("Error fetching social accounts:", e));
        }
    }, [kpiModalOpen]);

    // Load seeding status khi email thay đổi
    const loadSeedingStatus = useCallback(async () => {
        const memberEmail = d.email?.trim();
        if (!memberEmail) return;

        setSeedingLoading(true);
        const controller = new AbortController();

        try {
            const res = await getAllSeedingMarks(
                { email_member: memberEmail },
                { signal: controller.signal },
            );
            if (res.success && res.data) {
                setSeedingStatus(res.data);
                console.log("[KPI] Đã load seeding status:", Object.keys(res.data).length, "bài");
            }
        } catch (e) {
            if (e instanceof Error && e.name === "AbortError") return;
            console.error("Lỗi load seeding status:", e);
        } finally {
            setSeedingLoading(false);
        }
    }, [d.email]);

    useEffect(() => {
        loadSeedingStatus();
    }, [loadSeedingStatus]);

    // Lắng nghe message từ extension khi verify xong và đóng tab
    useEffect(() => {
        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === "KPI_VERIFY_COMPLETE") {
                console.log("[KPI] Nhận thông báo verify hoàn thành từ extension");
                // Reload seeding status để cập nhật UI
                await loadSeedingStatus();
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [loadSeedingStatus]);

    const { intents } = useGetIntents();
    const { allPosts, isLoading, error, refetch } = useFetchAllPosts(d.dashboardReloadToken);

    const [processedPosts, setProcessedPosts] = useState<DataFBResponse[]>([]);
    const [isProcessing, setIsProcessing] = useState<boolean>(false);

    const { presetGroups } = useGetPresetGroups(d.email, d.dashboardReloadToken);
    const { data: categoriesData } = useGetCategoriesQuery();
    const dynCategories = categoriesData || {};

    const [allPlatformCategories, setAllPlatformCategories] = useState<Category[]>([]);
    const [teamsData, setTeamsData] = useState<any[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [catRes, teamRes] = await Promise.all([
                    allPlatformCategoriesService.getAll(),
                    teamsService.getAll()
                ]);
                if (catRes.success && catRes.data) {
                    setAllPlatformCategories(catRes.data);
                }
                if (teamRes.success && teamRes.data) {
                    setTeamsData(teamRes.data);
                }
            } catch (err) {
                console.error("Error fetching all-platform data:", err);
            }
        };
        fetchData();
    }, []);

    // Resolve unified categories vs old facebook ones
    const resolvedCategories = useMemo(() => {
        if (allPlatformCategories && allPlatformCategories.length > 0) {
            const grouped: Record<string, any[]> = {
                intent: [],
                industry: [],
                team: [],
                tier: [],
            };
            allPlatformCategories.forEach((cat) => {
                const type = cat.category_type;
                if (type && type !== "team" && grouped[type]) {
                    grouped[type].push(cat);
                }
            });
            
            // Map teams from teamsData
            const uniqueNames = Array.from(new Set(teamsData.map(t => t.name_team)))
                .filter(name => name && name.toLowerCase() !== "tất cả team" && name.toLowerCase() !== "all");
            grouped.team = uniqueNames.map(name => ({
                id: name,
                category_type: "team",
                code: name,
                name: name,
            }));

            return grouped;
        }
        return dynCategories;
    }, [allPlatformCategories, teamsData, dynCategories]);

    // Helper: chuyển team/icp string|array thành mảng string
    const teamOrIcpToArray = (value?: string[] | string | null): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(t => String(t).trim()).filter(Boolean);
        return String(value).split(/[,;]/).map(t => t.trim()).filter(Boolean);
    };

    // ─── Kết hợp taxonomy từ nhóm vào post ──────────────────────────────
    const enrichedPosts = useMemo(() => {
        // Build lookup maps từ presetGroups
        const groupMap = new Map<string, typeof presetGroups[0]>();
        presetGroups.forEach(g => {
            if (g.url) {
                const key = g.url.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
                groupMap.set(key, g);
            }
        });

        return allPosts.map(post => {
            const groupUrl = (post.link_group || post.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
            const group = groupMap.get(groupUrl);

            return {
                ...post,
                // Kế thừa taxonomy từ nhóm nếu post chưa có
                intent: post.intent || group?.intent || "",
                industry: post.industry || group?.industry || "",
                team: post.team ?? group?.team ?? "",
                tier: post.tier ?? group?.tier ?? undefined,
            };
        });
    }, [allPosts, presetGroups]);

    // ─── Helper: Lọc bài Facebook trong ngày hôm nay ─────────────────────────
    const getTodayFacebookPosts = useMemo(() => {
        const todayStr = getVietnamDateStr();
        return enrichedPosts.filter(p => {
            const platform = (p.link_group || p.url || "");
            const isFb = !platform.includes("linkedin.com");
            const crawlDate = getDatePart(p.dateCrawl);
            return isFb && crawlDate === todayStr;
        });
    }, [enrichedPosts]);

    // ─── Tính KPI Handler ────────────────────────────────────────────────
    const handleCheckKpi = useCallback(async () => {
        const memberEmail = d.email?.trim();
        if (!memberEmail) {
            alert("Vui lòng đăng nhập để sử dụng tính năng Tính KPI.");
            return;
        }

        // Lấy danh sách bài đã đánh dấu seeding nhưng chưa verify
        try {
            const res = await getUnverifiedSeedingMarks({ email_member: memberEmail });
            const markedCount = Array.isArray(res.data) ? res.data.length : 0;

            if (markedCount === 0) {
                alert("Chưa có bài nào được đánh dấu seeding.\n\nHãy vào bài viết Facebook và bấm \"Đánh dấu đã seeding\" trên popup.");
                return;
            }

            // Hiển thị modal để người dùng nhập thông tin trước
            setKpiStage("input");
            setKpiResults([]);
            setKpiProgress({ current: 0, total: markedCount });
            setKpiModalOpen(true);
        } catch (err) {
            console.error("Lỗi khi lấy danh sách mark:", err);
            alert("Lỗi khi lấy danh sách bài đã đánh dấu.");
        }
    }, [d.email]);

    // ─── Xác minh 1 bài Seeding (mỗi lần 1 bài) ───────────────────────────
    const verifySinglePost = useCallback(async (post: any) => {
        const memberEmail = d.email?.trim();
        if (!memberEmail) return;
    
        if (!selectedAccountId) {
            alert("Vui lòng chọn một tài khoản mạng xã hội.");
            return;
        }

        const selectedAccount = socialAccounts.find(a => a.id === selectedAccountId);
        if (!selectedAccount) {
            alert("Tài khoản không hợp lệ.");
            return;
        }
    
        const fbNameValue = selectedAccount.account_name || "";
        const fbProfileIdValue = selectedAccount.account_profile_id || "";
        const platformIdValue = selectedAccount.id_platform || "";
    
        const postUrl = (post.link_post || post.url || "").trim();
        if (!postUrl) {
            alert("Bài viết không có URL!");
            return;
        }
    
        // Lưu lại để lần sau đỡ nhập lại
        localStorage.setItem("kpi_selected_social_account_id", selectedAccountId);
    
        // Tạo URL với hash params cho extension
        const targetUrl = `${postUrl}#kpi_email=${encodeURIComponent(memberEmail)}&kpi_uid=${encodeURIComponent(fbProfileIdValue)}&kpi_name=${encodeURIComponent(fbNameValue)}&social_account_id=${encodeURIComponent(selectedAccount.id)}&platform_id=${encodeURIComponent(platformIdValue.toString())}`;
    
        console.log("[KPI] Mở tab để xác minh:", postUrl);
        
        // Mở tab mới - user click nên không bị block
        const win = window.open(targetUrl, "_blank");
        
        if (!win) {
            alert("Không thể mở tab mới. Vui lòng cho phép popup cho trang này.");
            return;
        }
    
        console.log("[KPI] Đã mở tab - extension sẽ tự động xử lý...");
    
    }, [d.email, selectedAccountId, socialAccounts]);

    // Tự động set platformFilter theo platform của workspace khi mount / thay đổi workspace
    useEffect(() => {
        if (forcedPlatform === "facebook" || forcedPlatform === "linkedin") {
            setPlatformFilter(forcedPlatform);
            return;
        }
        if (platform === "facebook") {
            setPlatformFilter("facebook");
        } else if (platform === "linkedin") {
            setPlatformFilter("linkedin");
        } else {
            setPlatformFilter("all");
        }
    }, [platform, forcedPlatform]);

    // Thực hiện lọc và sắp xếp ở Front-end (có Loading)
    useEffect(() => {
        setIsProcessing(true);
        const timer = setTimeout(() => {
            const filtered = enrichedPosts.filter((post) => {
                const platformName = detectPlatform(post);

                const matchSearch =
                    (post.content || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (post.group_name || "").toLowerCase().includes(searchTerm.toLowerCase());

                const matchIntent =
                    intentFilter === "all" ||
                    (intentFilter === "unclassified" && !post.intent) ||
                    (post.intent || "").toLowerCase() === intentFilter.toLowerCase();

                const matchIndustry =
                    industryFilter === "all" ||
                    (post.industry || "").toLowerCase() === industryFilter.toLowerCase();

                const matchTeam =
                    teamFilter === "all" ||
                    teamOrIcpToArray(post.team).some(
                        t => t.toLowerCase() === teamFilter.toLowerCase()
                    );

                const matchTier =
                    tierFilter === "all" ||
                    String(post.tier ?? "") === tierFilter;

                const matchPlatform =
                    platformFilter === "all" ||
                    platformName.toLowerCase() === platformFilter.toLowerCase();

                return matchSearch && matchIntent && matchIndustry && matchTeam && matchTier && matchPlatform;
            });

            filtered.sort((a, b) => {
                if (sortBy === "score_desc") return b.score - a.score;
                if (sortBy === "score_asc") return a.score - b.score;
                if (sortBy === "comments_desc") return (b.comments || 0) - (a.comments || 0);
                if (sortBy === "latest") {
                    return getDateTimestamp(b.dateCrawl) - getDateTimestamp(a.dateCrawl);
                }
                return 0;
            });

            setProcessedPosts(filtered);
            setIsProcessing(false);
        }, 200);

        return () => clearTimeout(timer);
    }, [enrichedPosts, searchTerm, intentFilter, industryFilter, teamFilter, tierFilter, platformFilter, sortBy]);

    // Tự động quay về trang 1 nếu thay đổi từ khóa tìm kiếm hoặc các bộ lọc
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, intentFilter, industryFilter, teamFilter, tierFilter, platformFilter, sortBy]);

    // ─── Render Taxonomy Badges (Industry, Team, Tier) ──────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTaxonomyBadges = (post: any) => {
        const badges: React.ReactNode[] = [];

        // Industry badge
        if (post.industry) {
            const match = resolvedCategories.industry?.find(
                c => (c.code || c.value || "").toLowerCase() === (post.industry || "").toLowerCase()
            );
            const indLabel = match ? match.name || match.value : post.industry;
            badges.push(
                <span key="ind" className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-800" title="Ngành">
                    📂 {indLabel}
                </span>
            );
        }

        // Team badges
        teamOrIcpToArray(post.team).forEach((t: string) => {
            const match = resolvedCategories.team?.find(
                c => (c.code || c.value || "").toLowerCase() === t.toLowerCase()
            );
            const teamLabel = match ? match.name || match.code : t;
            badges.push(
                <span key={`team-${t}`} className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-800" title="Team">
                    👥 {teamLabel}
                </span>
            );
        });

        // Tier badge
        if (post.tier != null) {
            const tierLabels: Record<number, string> = { 1: "🔥 Tier 1", 2: "⚡ Tier 2", 3: "💎 Tier 3" };
            badges.push(
                <span key="tier" className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold text-purple-800" title="Tier">
                    {tierLabels[post.tier] || `Tier ${post.tier}`}
                </span>
            );
        }

        return badges.length > 0 ? <div className="flex flex-wrap gap-1 mt-1">{badges}</div> : null;
    };



    // ─── Render Taxonomy Filter Dropdowns ───────────────────────────────
    const intentOptions = useMemo(() => [
        { id: "all", label: "Tất cả Intent" },
        ...(resolvedCategories.intent || []).map(c => ({
            id: (c.code || c.value || c.name || "").toLowerCase(),
            label: c.name || c.code || c.value || "",
        })),
    ], [resolvedCategories.intent]);

    const industryOptions = useMemo(() => [
        { id: "all", label: "Tất cả Ngành" },
        ...(resolvedCategories.industry || []).map(c => ({
            id: (c.code || c.value || c.name || "").toLowerCase(),
            label: c.name || c.code || c.value || "",
        })),
    ], [resolvedCategories.industry]);

    const teamOptions = useMemo(() => [
        { id: "all", label: "Tất cả Team" },
        ...(resolvedCategories.team || []).map(c => ({
            id: (c.code || c.value || "").toLowerCase(),
            label: c.name || c.code || c.value || "",
        })),
    ], [resolvedCategories.team]);

    const tierOptions = useMemo(() => [
        { id: "all", label: "Tất cả Tier" },
        ...(resolvedCategories.tier || []).map(c => {
            const v = c.code || c.value || c.name || "";
            const name = c.name || `Tier ${v}`;
            return { id: String(v).toLowerCase(), label: name };
        }),
    ], [resolvedCategories.tier]);

    // ─── Render Intent Badge ──────────────────────────────────────────
    const renderIntentBadge = (intentValue?: string) => {
        if (!intentValue) return null;

        const matched = intents.find(i => i.value === intentValue || i.name === intentValue);
        const displayName = matched ? matched.name : intentValue;

        return (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium border flex items-center gap-1 w-max bg-blue-50 text-blue-600 border-blue-100">
                <span>{displayName}</span>
            </span>
        );
    };

    // ==========================================
    // TÍNH TOÁN CÁC CHỈ SỐ THỐNG KÊ (SUMMARY CARDS)
    // ==========================================
    // Xác định mốc ngày hệ thống chuẩn
    const todayStr = getVietnamDateStr();
    
    const yesterdayObj = new Date();
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = getVietnamYesterdayStr();

    // Lọc tập dữ liệu cào về trong Hôm nay và Hôm qua
    const postsToday = allPosts.filter(p => getDatePart(p.dateCrawl) === todayStr);
    const postsYesterday = allPosts.filter(p => getDatePart(p.dateCrawl) === yesterdayStr);

    const totalPostsToday = postsToday.length;
    const totalPostsYesterday = postsYesterday.length;

    const highScores = allPosts.filter(p => p.score >= 70);
    const highScorePercent = allPosts.length > 0 ? Math.round((highScores.length / allPosts.length) * 100) : 0;
    
    const pendingReviewCount = allPosts.filter(p => p.score >= 50 && p.score < 70).length;
    
    // Giả định dữ liệu seeded chiếm 20% lượng bài thu thập của mỗi ngày
    const seededTodayCount = Math.floor(totalPostsToday * 0.2); 
    const seededYesterdayCount = Math.floor(totalPostsYesterday * 0.2);

    // ==========================================
    // LOGIC PHÂN TRANG DỰA TRÊN KẾT QUẢ ĐÃ LỌC & SẮP XẾP (SLIDING WINDOW 5 NÚT)
    // ==========================================
    const totalPages = Math.ceil(processedPosts.length / itemsPerPage);
    const paginatedPosts = processedPosts.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const getPaginationNumbers = () => {
        const maxButtons = 5;
        let start = Math.max(1, currentPage - 2);
        let end = Math.min(totalPages, currentPage + 2);

        if (totalPages > maxButtons) {
            if (currentPage <= 3) {
                start = 1;
                end = maxButtons;
            } else if (currentPage >= totalPages - 2) {
                start = totalPages - maxButtons + 1;
                end = totalPages;
            }
        } else {
            start = 1;
            end = totalPages;
        }

        const pages = [];
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        return { pages, start, end };
    };

    const { pages: pageNumbers, start: startPage, end: endPage } = getPaginationNumbers();

    const platformLabel =
        forcedPlatform === "facebook"
            ? "Facebook"
            : forcedPlatform === "linkedin"
              ? "LinkedIn"
              : "Tất cả nền tảng";

    return (
        <div className="flex w-full flex-col gap-lg font-sans">
            {!hideStats && (
                <PlatformStatsRow>
                    <PlatformStatCard
                        label={`Tổng bài hôm nay (${platformLabel})`}
                        value={totalPostsToday}
                        hint={
                            totalPostsToday - totalPostsYesterday > 0
                                ? `↑ ${totalPostsToday - totalPostsYesterday} so với hôm qua`
                                : totalPostsToday - totalPostsYesterday < 0
                                  ? `↓ ${Math.abs(totalPostsToday - totalPostsYesterday)} so với hôm qua`
                                  : "↔ Bằng hôm qua"
                        }
                        hintTone={
                            totalPostsToday > totalPostsYesterday
                                ? "up"
                                : totalPostsToday < totalPostsYesterday
                                  ? "down"
                                  : "neutral"
                        }
                        accent="primary"
                    />
                    <PlatformStatCard
                        label="Điểm cao (≥70)"
                        value={highScores.length}
                        hint={`${highScorePercent}% trong tập đang lọc`}
                        hintTone="up"
                        accent="success"
                    />

                    {/* <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-100 border-l-4 border-l-amber-500 flex flex-col justify-between">
                        <div>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cần Theo Dõi</p>
                            <h3 className="text-3xl font-black text-slate-900 mt-1">{pendingReviewCount}</h3>
                        </div>
                        <p className="text-xs text-amber-600 font-medium mt-3">Điểm mức trung bình</p>
                    </div> */}

                    <PlatformStatCard
                        label="Đã seeded hôm nay"
                        value={seededTodayCount}
                        hint={`Ước tính từ batch hôm nay`}
                        accent="warning"
                    />
                    <PlatformStatCard
                        label="Tổng bài đang hiển thị"
                        value={processedPosts.length}
                        hint={`${allPosts.length} bài trong API`}
                        accent="primary"
                    />
                </PlatformStatsRow>
            )}

            <div className="bg-slate-50/50 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-100 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
                <div className="relative min-w-[220px] flex-1">
                    <input
                        type="text"
                        placeholder="Tìm kiếm bài post..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="border border-slate-200 bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 w-full rounded-xl px-4 py-2 text-xs font-semibold text-slate-700 outline-none transition shadow-sm"
                    />
                </div>

                <select
                    value={intentFilter}
                    onChange={(e) => setIntentFilter(e.target.value)}
                    className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[130px]"
                >
                    {intentOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                </select>

                <select
                    value={industryFilter}
                    onChange={(e) => setIndustryFilter(e.target.value)}
                    className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[130px]"
                >
                    {industryOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                </select>

                <select
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[130px]"
                >
                    {teamOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                </select>

                <select
                    value={tierFilter}
                    onChange={(e) => setTierFilter(e.target.value)}
                    className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[120px]"
                >
                    {tierOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                </select>

                {!forcedPlatform && platform !== "facebook" && platform !== "linkedin" ? (
                    <select
                        value={platformFilter}
                        onChange={(e) => setPlatformFilter(e.target.value)}
                        className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[130px]"
                    >
                        <option value="all">Tất cả platform</option>
                        <option value="facebook">Facebook</option>
                        <option value="linkedin">LinkedIn</option>
                    </select>
                ) : null}

                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="border border-slate-200 bg-white hover:bg-slate-50 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition cursor-pointer shadow-sm min-w-[150px]"
                >
                    <option value="latest">Sắp xếp: Mới nhất</option>
                    <option value="score_desc">Sắp xếp: Điểm cao nhất</option>
                    <option value="score_asc">Sắp xếp: Điểm thấp nhất</option>
                    <option value="comments_desc">Sắp xếp: Bình luận nhiều nhất</option>
                </select>

                <button
                    type="button"
                    onClick={() => void refetch()}
                    disabled={isLoading}
                    className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-800 flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold transition disabled:opacity-50 cursor-pointer shadow-sm active:scale-95"
                    title="Làm mới dữ liệu"
                >
                    <MaterialIcon
                        name="sync"
                        className={`text-[18px] ${isLoading ? "animate-spin" : ""}`}
                    />
                </button>

                <button
                    type="button"
                    onClick={() => void handleCheckKpi()}
                    disabled={isKpiChecking || isLoading}
                    className="flex items-center gap-1.5 rounded-xl bg-[#E3000F] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#C40009] active:scale-[0.97] disabled:opacity-50 cursor-pointer"
                    title="Tính KPI seeding cho bài đã đánh dấu"
                >
                    <MaterialIcon name="analytics" className="text-[16px]" />
                    {isKpiChecking ? "Đang tính..." : "Tính KPI"}
                </button>

                {(searchTerm !== "" ||
                  intentFilter !== "all" ||
                  industryFilter !== "all" ||
                  teamFilter !== "all" ||
                  tierFilter !== "all" ||
                  platformFilter !== "all") && (
                    <button
                        type="button"
                        onClick={() => {
                            setSearchTerm("");
                            setIntentFilter("all");
                            setIndustryFilter("all");
                            setTeamFilter("all");
                            setTierFilter("all");
                            setPlatformFilter(forcedPlatform || "all");
                        }}
                        className="border border-[#E3000F]/20 hover:border-[#E3000F]/40 bg-[#E3000F]/5 hover:bg-[#E3000F]/10 hover:text-[#E3000F] text-[#E3000F] flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold transition cursor-pointer shadow-sm active:scale-95"
                        title="Xóa tất cả bộ lọc"
                    >
                        <MaterialIcon name="filter_alt_off" className="text-[16px]" />
                        Xóa lọc
                    </button>
                )}
            </div>

            {error ? (
                <div className="border-error/30 bg-error/10 text-error rounded-lg border p-md text-xs font-medium">
                    {error}
                </div>
            ) : null}

            {/* HÀNG 3: DANH SÁCH BÀI VIẾT (DẠNG THẺ THU GỌN) */}
            <div className="flex flex-col gap-4">
                {isLoading || isProcessing ? (
                    <div className="border-outline-variant bg-surface flex flex-col items-center justify-center gap-2 rounded-xl border py-20">
                        <div className="border-primary h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
                        <span className="text-on-surface-variant text-xs">
                            {isLoading ? "Đang tải dữ liệu bài viết từ API..." : "Đang tính toán và sắp xếp bộ lọc bài viết..."}
                        </span>
                    </div>
                ) : paginatedPosts.length === 0 ? (
                    <div className="border-outline-variant bg-surface text-on-surface-variant rounded-xl border py-20 text-center text-xs italic">
                        Không tìm thấy bài post nào phù hợp với bộ lọc.
                    </div>
                ) : (
                    paginatedPosts.map((post, index) => {
                        const platform = detectPlatform(post);
                        const compactDateStr = getCompactDateString(post.dateCrawl);

                        // Phân loại màu nền cho Score Box
                        let scoreBg = "bg-slate-100 text-slate-700";
                        if (post.score >= 85) scoreBg = "bg-emerald-100 text-emerald-700";
                        else if (post.score >= 60) scoreBg = "bg-amber-100 text-amber-700";

                        return (
                            <div 
                                key={index} 
                                className="bg-white rounded-xl shadow-xs border border-slate-200/80 p-4 flex gap-4 items-start transition duration-200 hover:border-slate-300"
                            >
                                {/* KHỐI AI SCORE BÊN TRÁI */}
                                <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 ${scoreBg}`}>
                                    <span className="text-xl font-black leading-tight">{post.score}</span>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">AI Score</span>
                                </div>

                                {/* NỘI DUNG CHÍNH */}
                                <div className="flex-1 flex flex-col justify-between min-w-0">
                                    
                                    <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {renderPlatformIcon(platform)}

                                            <a 
                                                href={post.link_group || "#"} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-xs font-bold text-slate-900 hover:text-indigo-600 hover:underline truncate max-w-[220px]"
                                            >
                                                {post.group_name}
                                            </a>

                                            {renderIntentBadge(post.intent)}
                                            {/* Taxonomy badges: Industry, Team, Tier */}
                                            {renderTaxonomyBadges(post)}
                                        </div>

                                        <span className="text-[11px] text-slate-400 shrink-0 font-medium">
                                            {compactDateStr} {post.date ? `• ${post.date}` : ''}
                                        </span>
                                    </div>

                                    {/* TRÍCH DẪN NỘI DUNG */}
                                    <p className="text-xs text-slate-700 italic line-clamp-2 leading-relaxed bg-slate-50/50 p-x-2.5 rounded-lg border border-slate-100/60 mb-3">
                                        "{post.content || "Nội dung bài viết rỗng hoặc chứa thuần hình ảnh/video."}"
                                    </p>

                                    {/* FOOTER THẺ CON */}
                                    <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                                        
                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50/60 text-amber-700 rounded-md text-[11px] font-bold border border-amber-100/40" title="Lượt thích/Cảm xúc">
                                                👍 {post.reactions?.toLocaleString() || 0}
                                            </span>
                                            
                                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md text-[11px] font-bold" title="Lượt bình luận">
                                                💬 {post.comments?.toLocaleString() || 0}
                                            </span>

                                            <span className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-600 rounded-md text-[11px] font-bold" title="Lượt chia sẻ">
                                                🔁 {post.shares?.toLocaleString() || 0}
                                            </span>
                                        </div>

                                        {/* KÍCH HOẠT MODAL KHI XEM CHI TIẾT */}
                                        <div className="flex items-center gap-2">
                                                    {/* Badge seeding status - kiểm tra cả pending và verified */}
                                                    {(() => {
                                                        const postLink = (post.url || "").trim().toLowerCase();
                                                        const status = seedingStatus[postLink];
                                                        const isPending = status === "pending";
                                                        const isVerified = status === "yes";
                                                        
                                                        return (
                                                            <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold border ${
                                                                isVerified
                                                                    ? "bg-green-100 text-green-700 border-green-200"
                                                                    : isPending
                                                                        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                                                        : "bg-slate-100 text-slate-500 border-slate-200"
                                                            }`}>
                                                                {isVerified ? "✓ Đã xác minh" : isPending ? "✓ Đã seeding" : "Chưa seeding"}
                                                            </span>
                                                        );
                                                    })()}

                                            <button
                                                type="button"
                                                onClick={() => setSelectedPostForModal(post)}
                                                className="px-4 py-1.5 bg-white border border-[#E3000F] text-[#E3000F] hover:bg-[#E3000F] hover:text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
                                            >
                                                Xem chi tiết
                                            </button>

                                                    {/* Nút Xác minh - luôn hiện bên cạnh Xem chi tiết */}
                                                    <button
                                                        type="button"
                                                        onClick={() => verifySinglePost(post)}
                                                        className="group relative px-3 py-1.5 bg-gradient-to-r from-[#E3000F] to-[#C40009] hover:from-[#C40009] hover:to-[#E3000F] text-white rounded-lg text-[11px] font-bold transition-all duration-200 shadow-md hover:shadow-lg hover:-translate-y-0.5 cursor-pointer"
                                                    >
                                                        <span className="flex items-center gap-1.5">
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                            Xác minh
                                                        </span>
                                                    </button>
                                        </div>

                                    </div>

                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* HÀNG 4: FOOTER PHÂN TRANG */}
            {!isLoading && totalPages > 1 && (
                <div className="mt-6 p-4 border border-slate-200/80 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3 bg-white">
                    <div className="text-xs text-slate-500">
                        Hiển thị <span className="font-bold text-slate-700">{((currentPage - 1) * itemsPerPage) + 1}</span> - <span className="font-bold text-slate-700">{Math.min(currentPage * itemsPerPage, processedPosts.length)}</span> trong số <span className="font-bold text-slate-700">{processedPosts.length}</span> bài viết
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                        >
                            Trước
                        </button>

                        {startPage > 1 && (
                            <>
                                <button
                                    onClick={() => setCurrentPage(1)}
                                    className="w-7 h-7 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                >
                                    1
                                </button>
                                {startPage > 2 && <span className="px-1 text-slate-400 text-xs">...</span>}
                            </>
                        )}

                        {pageNumbers.map(page => (
                            <button
                                key={page}
                                onClick={() => setCurrentPage(page)}
                                className={`w-7 h-7 text-xs font-medium rounded-lg transition cursor-pointer ${
                                    currentPage === page 
                                        ? "bg-indigo-600 text-white font-bold shadow-xs" 
                                        : "text-slate-600 hover:bg-slate-100"
                                }`}
                            >
                                {page}
                            </button>
                        ))}

                        {endPage < totalPages && (
                            <>
                                {endPage < totalPages - 1 && <span className="px-1 text-slate-400 text-xs">...</span>}
                                <button
                                    onClick={() => setCurrentPage(totalPages)}
                                    className="w-7 h-7 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                >
                                    {totalPages}
                                </button>
                            </>
                        )}

                        <button
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition disabled:opacity-40 disabled:hover:bg-transparent cursor-pointer"
                        >
                            Sau
                        </button>
                    </div>
                </div>
            )}

            {/* ========================================================= */}
            {/* KHOANG RENDER MODAL HIỂN THỊ COMPONENT CON NGUYÊN BẢN */}
            {/* ========================================================= */}
            {selectedPostForModal && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
                    onClick={() => setSelectedPostForModal(null)} 
                >
                    <div 
                        className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl"
                        onClick={(e) => e.stopPropagation()} 
                    >
                        {/* Nút Đóng góc trên */}
                        <div className="absolute top-3 right-3 z-10">
                            <button 
                                onClick={() => setSelectedPostForModal(null)}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition shadow-xs cursor-pointer"
                                title="Đóng"
                            >
                                ✕
                            </button>
                        </div>

                        {/* TRUYỀN NGUYÊN OBJECT VÀO COMPONENT CON CỦA BẠN */}
                        <PostCard
                            item={selectedPostForModal}
                            isSeedingMarked={!!seedingStatus[(selectedPostForModal?.url || "").trim().toLowerCase()]}
                            onMarkSeeding={async (url: string) => {
                                const email = d.email?.trim();
                                if (!email) {
                                    alert("Vui lòng đăng nhập.");
                                    return;
                                }
                                try {
                                    const res = await markSeeding({ email_member: email, link_post: url });
                                    if (res.success) {
                                        await loadSeedingStatus();
                                        alert("Đã đánh dấu seeding thành công!");
                                    } else {
                                        alert("Lỗi: " + (res.message || "Không rõ nguyên nhân"));
                                    }
                                } catch (err) {
                                    alert("Lỗi khi đánh dấu: " + (err instanceof Error ? err.message : "Unknown"));
                                }
                            }}
                            onVerifySeeding={(post) => {
                                // Validate config trước khi xác minh
                                if (!fbName.trim() && !fbProfileId.trim()) {
                                    alert("Vui lòng vào 'Cấu hình Xác minh' để nhập Tên Facebook và Profile ID trước!");
                                    setKpiModalOpen(true); // Mở modal config
                                    return;
                                }
                                verifySinglePost(post);
                            }}
                        />

                    </div>
                </div>
            )}

            {/* ========================================================= */}
            {/* MODAL KẾT QUẢ TÍNH KPI                                    */}
            {/* ========================================================= */}
            {kpiModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
                    onClick={() => !isKpiChecking && setKpiModalOpen(false)}
                >
                    <div
                        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
                            <div>
                                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600">
                                        <MaterialIcon name="analytics" className="text-[18px]" />
                                    </span>
                                    Cấu hình Xác minh Seeding
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">
                                    Email: <span className="font-semibold text-slate-700">{d.email || "—"}</span>
                                </p>
                            </div>
                            {!isKpiChecking && (
                                <button
                                    onClick={() => setKpiModalOpen(false)}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* STAGE 1: INPUT PROFILE ID & NAME */}
                        {kpiStage === "input" && (
                            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
                                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-800 leading-relaxed">
                                    💡 <strong>Lưu ý quan trọng:</strong> Để tính KPI, bạn cần cài đặt <strong>Facebook Seeding KPI Extension</strong> trên Chrome trước. 
                                    Extension sẽ tự động kiểm tra comment của bạn trên mỗi bài viết.
                                </div>

                                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
                                    <strong>Cách lấy Profile ID:</strong><br/>
                                    1. Vào trang Facebook cá nhân<br/>
                                    2. Copy URL sẽ có dạng: facebook.com/hoang.nguyen.90 hoặc facebook.com/profile.php?id=1000889283726<br/>
                                    3. Dán ID (số hoặc username) vào ô bên dưới
                                </div>

                                <div className="space-y-4">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-bold text-slate-700">
                                            Chọn tài khoản Facebook <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={selectedAccountId}
                                            onChange={(e) => setSelectedAccountId(e.target.value)}
                                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500 transition cursor-pointer"
                                        >
                                            <option value="" disabled>-- Chọn tài khoản --</option>
                                            {socialAccounts.map(account => (
                                                <option key={account.id} value={account.id}>
                                                    {account.account_name} {account.account_profile_id ? `(${account.account_profile_id})` : ""}
                                                </option>
                                            ))}
                                        </select>
                                        <span className="text-[10px] text-slate-400">Tài khoản này sẽ được dùng để đối chiếu comment</span>
                                        {socialAccounts.length === 0 && (
                                            <span className="text-[10px] text-amber-500 mt-1">
                                                Bạn chưa có tài khoản Facebook nào. Hãy thêm trong Quản lý tài khoản.
                                            </span>
                                        )}
                                    </div>
                                </div>

                                    <div className="pt-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!selectedAccountId) {
                                                    alert("Vui lòng chọn tài khoản Facebook.");
                                                    return;
                                                }
                                                // Lưu cấu hình và đóng modal
                                                localStorage.setItem("kpi_selected_social_account_id", selectedAccountId);
                                                setKpiModalOpen(false);
                                            }}
                                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm transition shadow-sm cursor-pointer"
                                        >
                                            ✓ Lưu cấu hình
                                        </button>
                                        <p className="text-[10px] text-slate-400 mt-2 text-center">
                                            Sau khi lưu, nhấn "Xác minh" trên từng bài đã seeding
                                        </p>
                                    </div>
                            </div>
                        )}

                        {/* Done state - show last verified result */}
                        {kpiStage === "done" && (
                            <div className="px-6 pt-4 pb-2">
                                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
                                    <p className="text-sm font-bold text-emerald-700">✅ Đã xác minh thành công!</p>
                                    <p className="text-xs text-emerald-600 mt-1">Tab Facebook đã được đóng. Kết quả đã lưu vào KPI.</p>
                                </div>
                            </div>
                        )}

                        {/* Kết quả xác minh */}
                        {kpiStage !== "input" && kpiResults.length > 0 && (
                            <div className="flex-1 overflow-y-auto px-6 py-4">
                                {kpiResults.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                                        <span className="animate-spin text-2xl">⏳</span>
                                        <p className="text-xs mt-2">Bắt đầu kiểm tra dữ liệu...</p>
                                    </div>
                                )}
                                <div className="space-y-2">
                                    {kpiResults.map((r, idx) => (
                                        <div
                                            key={idx}
                                            className={`flex items-start gap-3 rounded-xl border p-3 text-xs transition-all ${
                                                r.status === "seeded" || r.status === "success"
                                                    ? "bg-emerald-50/60 border-emerald-200"
                                                    : r.status === "already_saved"
                                                      ? "bg-blue-50/40 border-blue-100"
                                                      : r.status === "error"
                                                        ? "bg-red-50/40 border-red-100"
                                                        : "bg-slate-50/40 border-slate-100"
                                            }`}
                                        >
                                            <span className="mt-0.5 text-base">
                                                {r.status === "seeded" || r.status === "success" ? "✅" : r.status === "already_saved" ? "📋" : r.status === "error" ? "❌" : "⏭️"}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-bold text-slate-800 truncate">{r.group_name || "Nhóm Facebook"}</p>
                                                <p className="text-slate-500 italic line-clamp-1 mt-0.5">{r.content || "—"}</p>
                                                {r.link_post && r.link_post !== "(không có URL)" && (
                                                    <a href={r.link_post} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline mt-0.5 inline-block truncate max-w-full">
                                                        Xem bài viết ↗
                                                    </a>
                                                )}
                                                {r.message && (
                                                    <p className="text-[10px] text-slate-400 mt-0.5 italic">{r.message}</p>
                                                )}
                                            </div>
                                            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border ${
                                                r.status === "seeded" || r.status === "success"
                                                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                                    : r.status === "already_saved"
                                                      ? "bg-blue-100 text-blue-700 border-blue-300"
                                                      : r.status === "error"
                                                        ? "bg-red-100 text-red-700 border-red-300"
                                                        : "bg-slate-100 text-slate-600 border-slate-200"
                                            }`}>
                                                {r.status === "seeded" || r.status === "success" ? "Đã lưu" : r.status === "already_saved" ? "Đã có" : r.status === "error" ? "Lỗi" : "Bỏ qua"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
}