import { useQuery } from "@tanstack/react-query";
import { FacebookGroupDTO } from "../types/data-fb.type";
import { getPresetGroupsService, getLinkedInGroupsService } from "../services/group";

export const useGetPresetGroups = (linkedInEmail?: string, reloadToken?: any) => {
  const email = linkedInEmail?.trim() ?? "";

  const { data, isLoading, error, refetch } = useQuery<FacebookGroupDTO[]>({
    queryKey: ["presetGroups", email, reloadToken],
    queryFn: async () => {
      const [fbData, liData] = await Promise.all([
        getPresetGroupsService().catch((err) => {
          console.error("Lỗi fetch FB groups:", err);
          return [];
        }),
        getLinkedInGroupsService(email).catch((err) => {
          console.error("Lỗi fetch LI groups:", err);
          return [];
        }),
      ]);

      const fbGroups = fbData.map((g) => ({ ...g, platform: "facebook" }));
      const liGroups = liData.map((g) => ({ ...g, platform: "linkedin" }));

      return [...fbGroups, ...liGroups];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });

  return {
    presetGroups: data || [],
    isLoadingGroups: isLoading,
    errorGroups: error ? "Lỗi tải danh sách Group." : null,
    fetchPresetGroups: refetch,
  };
};