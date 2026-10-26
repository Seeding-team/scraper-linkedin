import { useQuery } from "@tanstack/react-query";
import { getCategoriesService } from "../services/category_service";

export const useGetCategoriesQuery = () => {
  return useQuery({
    queryKey: ["categories"],
    queryFn: getCategoriesService,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
    refetchOnWindowFocus: false,
  });
};
