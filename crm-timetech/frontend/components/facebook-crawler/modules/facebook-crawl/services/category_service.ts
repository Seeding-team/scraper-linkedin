import axiosClient from "../../../shared/api/axiosClient";

export interface CategoryItemDTO {
  value: string;
  name: string;
  code?: string;
}

export interface GetCategoriesResponse {
  status: string;
  message: string;
  data: Record<string, CategoryItemDTO[]>;
}

export interface CategoryPayload {
  category_type: string;
  value: string;
  name: string;
  platform?: string;
}

export const getCategoriesService = async (): Promise<Record<string, CategoryItemDTO[]>> => {
  const response = await axiosClient.get<GetCategoriesResponse>("/api/v1/categories");
  return response.data.data;
};

export const addCategoryService = async (payload: CategoryPayload) => {
  const response = await axiosClient.post("/api/v1/categories/add", payload);
  return response.data;
};

export const updateCategoryService = async (payload: CategoryPayload) => {
  const response = await axiosClient.put("/api/v1/categories/update", payload);
  return response.data;
};

export const deleteCategoryService = async (payload: { category_type: string; value: string }) => {
  const response = await axiosClient.delete("/api/v1/categories/delete", { data: payload });
  return response.data;
};
