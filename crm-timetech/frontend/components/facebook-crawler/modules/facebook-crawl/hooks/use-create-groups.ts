import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { submitSharedAddGroup } from "@/lib/group-platform-api";
import { CreateGroupPayload } from "../schemas/create_groups_shemas";
import { useQueryClient } from "@tanstack/react-query";

export function useCreateGroup() {
    const router = useRouter();
    const d = useDashboard();
    const queryClient = useQueryClient();
    const [isLoading, setIsLoading] = useState(false);

    const submitGroupData = async (data: CreateGroupPayload) => {
        setIsLoading(true);
        try {
            const result = await submitSharedAddGroup(data, d.email);
            if (result.ok) {
                toast.success(result.message || "Tạo Group thành công!");
                queryClient.invalidateQueries({ queryKey: ["presetGroups"] });
                return true;
            }
            toast.error(result.message || "Có lỗi xảy ra khi tạo group!");
            return null;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Có lỗi xảy ra khi kết nối đến server!");
            return null;
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        router.back();
    };

    return {
        isLoading,
        submitGroupData,
        handleCancel
    };
}