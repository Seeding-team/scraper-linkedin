import { ChannelType } from "../types";

export interface ChannelCapabilityConfig {
  id: ChannelType;
  name: string;
  categoryName: string;
  description: string;
  isAvailable: boolean;
  badgeText?: string;
  connectRoute?: string;
  connectActionLabel: string;
}

export const CHANNEL_CAPABILITIES: Record<ChannelType, ChannelCapabilityConfig> = {
  all: {
    id: "all",
    name: "Tất cả",
    categoryName: "Tất cả kênh",
    description: "Xem toàn bộ hội thoại từ tất cả kênh xã hội",
    isAvailable: true,
    connectActionLabel: "",
  },
  zalo: {
    id: "zalo",
    name: "Zalo",
    categoryName: "Zalo Personal / OA",
    description: "Kết nối tài khoản Zalo cá nhân hoặc Official Account",
    isAvailable: true,
    connectRoute: "/all-platform/quan-ly-tai-khoan",
    connectActionLabel: "Kết nối →",
  },
  facebook: {
    id: "facebook",
    name: "Facebook",
    categoryName: "Facebook Messenger Fanpage",
    description: "Kết nối Fanpage Facebook Messenger",
    isAvailable: true,
    connectRoute: "/all-platform/quan-ly-tai-khoan",
    connectActionLabel: "Kết nối →",
  },
  telegram: {
    id: "telegram",
    name: "Telegram",
    categoryName: "Telegram Account / Bot",
    description: "Kết nối tài khoản Telegram hoặc Telegram Bot",
    isAvailable: true,
    connectRoute: "/all-platform/telegram-chat",
    connectActionLabel: "Kết nối →",
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp",
    categoryName: "WhatsApp Business",
    description: "Tính năng đang phát triển",
    isAvailable: false,
    badgeText: "Đang phát triển",
    connectActionLabel: "Đang phát triển",
  },
  viber: {
    id: "viber",
    name: "Viber",
    categoryName: "Viber Business",
    description: "Tính năng đang phát triển",
    isAvailable: false,
    badgeText: "Đang phát triển",
    connectActionLabel: "Đang phát triển",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    categoryName: "LinkedIn Direct Message",
    description: "Tính năng đang phát triển",
    isAvailable: false,
    badgeText: "Đang phát triển",
    connectActionLabel: "Đang phát triển",
  },
};
