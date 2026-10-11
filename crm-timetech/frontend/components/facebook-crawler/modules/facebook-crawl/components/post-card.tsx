// src/modules/post/components/PostCard.tsx
"use client"
import React from "react";
import {
    FaRegThumbsUp,
    FaRegCommentDots,
    FaExternalLinkAlt, 
    FaShareAlt,
    FaFacebook,
    FaLinkedin
} from "react-icons/fa";
import {DataFBResponse} from "../types/data-fb.type";
import { useGetIntents } from "../hooks/use-get-intents";
import {CrawlIntentOption} from "../types/data-fb.type";
import { useEffect } from "react";
import {InteractionForm} from "./interaction-form";
interface PostCardProps {
    item: DataFBResponse;
    onLinkClick?: (url: string) => void;
    /** Trạng thái seeding của bài viết này */
    isSeedingMarked?: boolean;
    /** Callback khi bấm đánh dấu seeding */
    onMarkSeeding?: (url: string) => void;
    /** Callback khi bấm xác minh seeding - nhận full post object */
    onVerifySeeding?: (post: DataFBResponse) => void;
}

export function PostCard({ item, onLinkClick, isSeedingMarked, onMarkSeeding, onVerifySeeding }: PostCardProps) {
    const { intents,fetchIntents } = useGetIntents();
    useEffect(() => {
        fetchIntents();
    }, []);
    const hasMedia = item.images.length > 0 || Boolean(item.media_url);

    const displayDate = typeof item.dateCrawl === 'string' 
        ? new Date(item.dateCrawl).toLocaleDateString('vi-VN') 
        : item.dateCrawl instanceof Date 
            ? item.dateCrawl.toLocaleDateString('vi-VN') 
            : "";

    const detectPlatform = (targetUrl: string) => {
        return targetUrl.includes("linkedin.com") ? "LinkedIn" : "Facebook";
    };
    const platform = detectPlatform(item.link_group || item.url);

  

    let scoreBg = "bg-gray-100 text-gray-700";
    if (item.score >= 85) scoreBg = "bg-emerald-100 text-emerald-700";
    else if (item.score >= 60) scoreBg = "bg-amber-100 text-amber-700";

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3.5 items-center">
                    
                    {/* Khối AI Score */}
                    <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl shrink-0 ${scoreBg}`}>
                        <span className="text-lg font-black leading-tight">{item.score}</span>
                        <span className="text-[8px] font-bold uppercase tracking-tighter opacity-80 mt-0.5">AI Score</span>
                    </div>

                    <div className="min-w-0">
                        {/* Tên Group kèm Link & Nhãn Intent in trực tiếp */}
                        <div className="flex items-center gap-2 flex-wrap">
                          
                            
                            <a 
                                href={item.link_group || "#"} 
                                target="_blank" 
                                rel="noreferrer"
                                className="font-semibold text-gray-800 hover:text-indigo-600 hover:underline truncate max-w-[220px]"
                                title="Truy cập Group"
                            >
                                {item.group_name}
                            </a>

                            {/* ✅ In thẳng biến intent ra giao diện */}
                         
                        </div>
                        
                        {/* Subtitle */}
                        <p className="text-sm text-gray-500 mt-0.5">
                            {displayDate} • {item.date} • {item.total_posts_24h} bài viết
                        </p>
                    </div>
                </div>

                {/* Nút Link Bài Viết Gốc */}
                <div className="flex items-center gap-3">
                    {/* intent */}
                    {
                        item.intent &&
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-[11px] font-medium  flex items-center gap-1 w-max ">
                        <span>{intents.find((i) => i.value === item.intent)?.name || item.intent}</span>
                    </span>
}
                    <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gray-400 hover:text-indigo-600 transition p-1"
                        title="Mở link bài gốc"
                    >
                        <FaExternalLinkAlt className="text-xs" />
                    </a>
                </div>
            </div>

            {/* Content */}
            <div className="mt-4 max-h-[220px] overflow-y-auto pr-2 text-sm leading-7 text-gray-700">
                <p className="whitespace-pre-line">{item.content || "Không có nội dung"}</p>

                {/* Media */}
                {hasMedia && (
                    <div className="mt-5 max-h-[420px] space-y-4 overflow-y-auto pr-2">
                        {item.images.length > 0 && (
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                {item.images.map((img, index) => (
                                    <img
                                        key={index}
                                        src={img}
                                        alt={`image-${index}`}
                                        className="h-32 w-full rounded-xl object-cover border border-gray-100"
                                    />
                                ))}
                            </div>
                        )}

                        {item.media_url && (
                            <video
                                controls
                                className="max-h-[300px] w-full rounded-xl border bg-black"
                            >
                                <source src={item.media_url} type="video/mp4" />
                            </video>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="mt-5 border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    
                    {/* Cụm Tương tác */}
                    <div className="flex items-center gap-6 text-sm text-gray-600">
                        <div className="flex items-center gap-2" title="Lượt thích">
                            <FaRegThumbsUp className="text-blue-500" />
                            <span className="font-medium">{item.reactions}</span>
                        </div>

                        <div className="flex items-center gap-2" title="Lượt bình luận">
                            <FaRegCommentDots className="text-amber-500" />
                            <span className="font-medium">{item.comments}</span>
                        </div>

                        <div className="flex items-center gap-2" title="Lượt chia sẻ">
                            <FaShareAlt className="text-emerald-500" />
                            <span className="font-medium">{item.shares}</span>
                        </div>
                    </div>

                    {/* Nút Xem bài viết */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Nút Đánh dấu seeding — chỉ hiện cho Facebook */}
                        {platform === "Facebook" && onMarkSeeding && (
                            <button
                                type="button"
                                disabled={isSeedingMarked}
                                onClick={() => onMarkSeeding(item.url)}
                                className={`px-4 py-2 text-xs font-bold rounded-xl transition shadow-xs cursor-pointer ${
                                    isSeedingMarked
                                        ? "bg-emerald-100 text-emerald-700 border border-emerald-300 cursor-default"
                                        : "bg-[#E3000F] hover:bg-[#C40009] text-white"
                                }`}
                            >
                                {isSeedingMarked ? "✓ Đã seeding" : "Đánh dấu seeding"}
                            </button>
                        )}

                        <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-white border border-[#E3000F] text-[#E3000F] hover:bg-[#E3000F] hover:text-white text-xs px-4 py-2 rounded-xl font-semibold transition inline-block text-center shadow-xs"
                            onClick={() => {
                                if (onLinkClick) {
                                    onLinkClick(item.url);
                                }
                            }}
                        >
                            Xem bài viết
                        </a>

                        {/* Nút Xác minh seeding — luôn hiện bên cạnh Xem bài viết */}
                        {platform === "Facebook" && onVerifySeeding && (
                            <button
                                type="button"
                                onClick={() => onVerifySeeding(item)}
                                className="group relative px-4 py-2 text-xs font-bold rounded-xl transition-all duration-200 shadow-md hover:shadow-lg hover:-translate-y-0.5 cursor-pointer bg-gradient-to-r from-[#E3000F] to-[#C40009] hover:from-[#C40009] hover:to-[#E3000F] text-white"
                            >
                                <span className="flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Xác minh
                                </span>
                            </button>
                        )}
                    </div>

                </div>
            </div>
            <InteractionForm url={item.url} />

        </div>
    );
}