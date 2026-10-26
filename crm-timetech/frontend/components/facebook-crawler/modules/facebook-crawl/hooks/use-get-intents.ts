import { useGetCategoriesQuery } from "./use-get-categories-query";

export const useGetIntents = () => {
  const { data, isLoading, error } = useGetCategoriesQuery();

  const intents = (data?.intent || []).map((t: any) => ({
    name: t.name || t.code || t.value || "Unknown",
    value: t.code || t.value || t.name || "unknown",
  }));

  const fetchIntents = async () => {
    return intents;
  };

  return {
    intents,
    isLoading,
    errorMessage: error ? (error as Error).message : null,
    fetchIntents,
  };
};