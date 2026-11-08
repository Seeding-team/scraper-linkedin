import { useMutation, UseMutationOptions, useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/components/features/dashboard/dashboard-context";
import { submitSharedUpdateGroup } from "@/lib/group-platform-api";
import type { FacebookGroupDTO } from "../types/data-fb.type";

interface UpdateGroupPayload {
  group_url: string;
  group_name: string;
  url: string;
  intent?: string;
  members?: number;
  posts_per_week?: number;
  health_score?: number;
  status?: string;
  industry?: string;
  tier?: number;
  team?: string;
  icp?: string;
  icp_desc?: string;
  _originalGroup?: FacebookGroupDTO;
}

interface UpdateGroupResponse {
  success: boolean;
  message: string;
  data?: any;
}

export function useUpdateGroup(
  options?: UseMutationOptions<UpdateGroupResponse, Error, UpdateGroupPayload>,
) {
  const d = useDashboard();
  const queryClient = useQueryClient();
  const updateGroupMutation = useMutation<
    UpdateGroupResponse,
    Error,
    UpdateGroupPayload
  >({
    mutationFn: async (payload: UpdateGroupPayload) => {
      const { group_url, _originalGroup, ...updateData } = payload;
      if (!_originalGroup) {
        throw new Error("Thiếu dữ liệu nhóm gốc để cập nhật.");
      }
      const result = await submitSharedUpdateGroup(
        _originalGroup,
        { group_url, ...updateData },
        d.email,
      );
      if (!result.ok) throw new Error(result.message);
      return { success: true, message: result.message };
    },
    onSuccess: (data, variables, context) => {
      console.log("Group cập nhật thành công:", data);
      queryClient.invalidateQueries({ queryKey: ["presetGroups"] });
      if (options?.onSuccess) {
        (options.onSuccess as any)(data, variables, context);
      }
    },
    onError: (error: Error, variables, context) => {
      console.error("Lỗi cập nhật group:", error.message);
      if (options?.onError) {
        (options.onError as any)(error, variables, context);
      }
    },
  });

  return {
    updateGroup: updateGroupMutation.mutate,
    isUpdating: updateGroupMutation.isPending,
    isSuccess: updateGroupMutation.isSuccess,
    error: updateGroupMutation.error,
    reset: updateGroupMutation.reset,
  };
}
