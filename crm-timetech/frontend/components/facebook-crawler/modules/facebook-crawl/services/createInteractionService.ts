import { DataFBResponse } from '../types/data-fb.type';
import axiosClient from "../../../shared/api/axiosClient";
import { InteractionPayload } from "../schemas/interaction-schemas";

export interface InteractionResponse {
    success: "success" | "error";
    message: string;
    Data?:any
}

export const interactPostService = async (payload: InteractionPayload): Promise<InteractionResponse> => {
    // Thay thế endpoint này bằng API thực tế của bạn
    const response = await axiosClient.post<InteractionResponse>("/api/v1/posts/interact", payload);
    return response.data;
};