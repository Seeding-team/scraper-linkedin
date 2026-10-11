import { useQuery } from "@tanstack/react-query";
import { getDataFbService } from "../services/getDataFacebook";
import { DataFBResponse } from "../types/data-fb.type";
import { getAllLinkedInPosts } from "@/services/linkedinCrawlerService";

export const useFetchAllPosts = (reloadToken?: any) => {
  // Lấy email LinkedIn lưu trong localStorage để gọi API LinkedIn
  const savedEmail =
    typeof window !== "undefined"
      ? localStorage.getItem("linkedin_crawler_email")
      : null;

  const { data, isLoading, error, refetch } = useQuery<DataFBResponse[]>({
    queryKey: ["allPosts", savedEmail, reloadToken],
    queryFn: async () => {
      // Gọi song song cả Facebook và LinkedIn
      const promises: [Promise<any>, Promise<any>] = [
        getDataFbService().catch((err) => {
          console.error("Lỗi khi lấy bài viết Facebook:", err);
          return { data: [] };
        }),
        savedEmail
          ? getAllLinkedInPosts({ email: savedEmail, filters: {} }).catch((err) => {
              console.error("Lỗi khi lấy bài viết LinkedIn:", err);
              return { success: false, data: [] };
            })
          : Promise.resolve({ success: false, data: [] }),
      ];

      const [fbResponse, liResponse] = await Promise.all(promises);

      const fbPosts = Array.isArray(fbResponse?.data) ? fbResponse.data : [];
      const liSessions =
        liResponse?.success && Array.isArray(liResponse?.data)
          ? liResponse.data
          : [];

      // Map LinkedIn posts sang chuẩn DataFBResponse
      const liPosts: DataFBResponse[] = [];
      liSessions.forEach((session: any) => {
        if (Array.isArray(session.posts)) {
          session.posts.forEach((post: any) => {
            liPosts.push({
              group_name: session.group_name || "Nhóm LinkedIn",
              total_posts_24h: 0,
              link_group: session.group_url || "",
              url: post.post_url || "",
              date: post.posted_at || "",
              dateCrawl: session.date_crawl || new Date(),
              intent: post.intent || "",
              reactions: Number(post.likes || post.reactions || 0),
              comments: Number(post.comments || 0),
              shares: Number(post.reposts || post.shares || 0),
              score: Number(post.score || 0),
              content: post.content || "",
              media_url: post.media_url || null,
              images: Array.isArray(post.images) ? post.images : [],
            });
          });
        }
      });

      return [...fbPosts, ...liPosts];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: false,
  });

  return {
    allPosts: data || [],
    isLoading,
    error: error ? "Không thể tải dữ liệu từ máy chủ." : null,
    refetch,
  };
};