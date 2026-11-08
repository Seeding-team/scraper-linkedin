import { useMutation, UseMutationOptions } from "@tanstack/react-query";
import axiosClient from "../../../shared/api/axiosClient";

interface DeleteGroupPayload {
  group_url: string;
}

interface DeleteGroupResponse {
  success: boolean;
  message: string;
  data?: any;
}

export const useDeleteGroup = (
  options?: UseMutationOptions<DeleteGroupResponse, Error, DeleteGroupPayload>
) => {
  const deleteGroupMutation = useMutation<
    DeleteGroupResponse,
    Error,
    DeleteGroupPayload
  >({
    mutationFn: async (payload: DeleteGroupPayload) => {
      const { group_url } = payload;

      try {
        const response = await axiosClient.delete(
          `/api/v1/groups/delete?group_url=${encodeURIComponent(group_url)}`
        );
        return response.data;
      } catch (error: any) {
        throw new Error(
          error.response?.data?.detail || error.response?.data?.message || `Lỗi xóa group`
        );
      }
    },
    onSuccess: (data) => {
      console.log("Group xóa thành công:", data);
    },
    onError: (error: Error) => {
      console.error("Lỗi xóa group:", error.message);
    },
    ...options,
  });

  return {
    deleteGroup: deleteGroupMutation.mutateAsync,
    isDeleting: deleteGroupMutation.isPending,
    error: deleteGroupMutation.error,
  };
};
