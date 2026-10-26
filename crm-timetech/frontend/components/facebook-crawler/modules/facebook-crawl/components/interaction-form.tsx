"use client";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FaUser, FaPaperPlane } from "react-icons/fa";
import { InteractionSchema, InteractionPayload } from "../schemas/interaction-schemas";
import { useInteractPost } from "../hooks/use-interact-post";
import { useAuthContext } from "@/components/facebook-crawler/shared/components/contexts/AuthContext";
interface InteractionFormProps {
    url: string;
}


import { useGetInteractions } from "../hooks/use-get-interaction";
// Dùng trực tiếp Emoji vào chuỗi label
const REACTIONS = [
    { value: "LIKE", label: "👍 Thích" },
    { value: "LOVE", label: "❤️ Yêu thích" },
    { value: "CARE", label: "🫂 Thương thương" },
    { value: "HAHA", label: "😂 Haha" },
    { value: "WOW", label: "😲 Wow" },
    { value: "SAD", label: "😢 Buồn" },
    { value: "ANGRY", label: "😡 Phẫn nộ" },
];

export function InteractionForm({ url }: InteractionFormProps) {
    const { user } = useAuthContext();
    const { interactions, error, fetchInteractions } = useGetInteractions();

    useEffect(() => {
        fetchInteractions();
    }, [fetchInteractions]);

    const { isLoading, submitInteraction } = useInteractPost();

    const {
        register,
        handleSubmit,
        setValue,
        formState: { errors },
        reset
    } = useForm<InteractionPayload>({
        resolver: zodResolver(InteractionSchema),
        defaultValues: {
            url: url,
            id: "",
            reaction: "LIKE",
            comment: "",
            name: "",
            email: user?.email || "",
            password: user?.password || "",
        },
    });

    const onSubmit = async (data: InteractionPayload) => {
        const result = await submitInteraction(data);
        if (result) {
            reset({ ...data, comment: "" });
        }
    };

    return (
        <form
            onSubmit={handleSubmit(onSubmit)}
            className="mt-md rounded-xl bg-surface-container-low border border-outline-variant p-sm flex flex-col gap-sm"
        >
            <div className="flex flex-col sm:flex-row gap-sm">

                {/* Chọn User */}
                <div className="flex items-center gap-2 bg-surface border border-outline-variant rounded-lg px-md py-1.5 w-full sm:w-1/3 focus-within:border-primary transition-colors">
                    <FaUser className="text-on-surface-variant shrink-0 text-sm" />
                    <select
                        {...register("id")}
                        className="w-full bg-transparent outline-none text-sm text-on-surface cursor-pointer"
                        onChange={(e) => { setValue("name", e.target.options[e.target.selectedIndex].text); }}
                    >
                        <option value="">-- Chọn User --</option>
                        {interactions.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                    </select>
                </div>

                {/* Chọn Cảm xúc */}
                <div className="flex items-center gap-2 bg-surface border border-outline-variant rounded-lg px-md py-1.5 w-full sm:w-1/4 focus-within:border-primary transition-colors">
                    <select
                        {...register("reaction")}
                        className="w-full bg-transparent outline-none text-sm text-on-surface cursor-pointer"
                    >
                        {REACTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                                {r.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Nhập Bình luận & Nút Gửi */}
                <div className="flex items-center gap-2 bg-surface border border-outline-variant rounded-lg px-md py-1.5 w-full sm:flex-1 focus-within:border-primary transition-colors">
                    <input
                        {...register("comment")}
                        type="text"
                        placeholder="Viết bình luận..."
                        className="w-full bg-transparent outline-none text-sm text-on-surface py-0.5"
                        autoComplete="off"
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-on-primary p-1.5 rounded-lg transition-colors shrink-0 flex items-center justify-center"
                        title="Gửi tương tác"
                    >
                        <FaPaperPlane className="text-sm" />
                    </button>
                </div>
            </div>

            {/* Hiển thị lỗi validation */}
            {errors.id && (
                <span className="text-xs text-error font-medium ml-xs">* {errors.id.message}</span>
            )}
        </form>
    );
}