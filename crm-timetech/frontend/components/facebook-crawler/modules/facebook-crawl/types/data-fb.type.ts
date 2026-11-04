export interface DataFBResponse{
    group_name: string;
    total_posts_24h: number;

    link_group: string;

    url: string;
    date: string;
    dateCrawl:Date,
    intent?: string;
    reactions: number;
    comments: number;
    shares: number;
    score: number;
    content?: string;
    media_url: string | null;
    images: string[];
    author_url?: string;

    // Taxonomy fields - kế thừa từ nhóm nguồn
    industry?: string;
    team?: string[] | string;
    tier?: number;
}
export interface CrawlIntentOption {
    value: string;
    label: string;
}
export interface FacebookGroupDTO {
    group_name: string;             // Tương ứng: str
    url: string;                    // Tương ứng: str
    intent: string;                 // Tương ứng: str
    members?: number | null;        // Tương ứng: Optional[int]
    last_crawl?: string | null;    // Tương ứng: Optional[str] 
    date_crawl?: string | null;    // Tương ứng: Optional[str] 
    posts_per_week?: number | null; // Tương ứng: Optional[int]
    health_score?: number | null;   // Tương ứng: Optional[float]
    chay_24h?: boolean | null;      // Tương ứng: Optional[bool]
    status?: "ACTIVE" | "IDLE" | "DEAD"; 
    
    // Taxonomy fields
    platform?: string; // "facebook" | "linkedin"
    industry?: string;
    tier?: number;
    team?: string[] | string;
    icp?: string[] | string;
    icp_desc?: string;
}