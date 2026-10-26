import { ChannelAccount, ConversationItem } from "../types";
import { MOCK_CHANNEL_ACCOUNTS, MOCK_CONVERSATIONS } from "../mockOmnichannelData";

/**
 * DEV-ONLY UI Preview Fixtures
 * These fixtures are strictly used when a developer explicitly clicks "Xem trước giao diện".
 * They are NEVER loaded automatically in production nor used as fallback when APIs fail.
 */
export const PREVIEW_CHANNEL_ACCOUNTS: ChannelAccount[] = MOCK_CHANNEL_ACCOUNTS;

export const PREVIEW_CONVERSATIONS: ConversationItem[] = MOCK_CONVERSATIONS;
