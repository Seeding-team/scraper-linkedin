"use client";

import { BellOff, BellRing, Info, Loader2, Radio, X } from "lucide-react";
import { useZalo } from "@/hooks/useZalo";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { zaloApi } from "@/lib/zaloApiClient";
import type { ZaloAttachment } from "@/lib/zaloMessageContent";
import { ZaloAuthCard } from "./ZaloAuthCard";
import { ZaloChatPanel } from "./ZaloChatPanel";
import { ZaloConversationList } from "./ZaloConversationList";

const PUSH_BTN =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-[30px] border border-[#dce1e8] bg-transparent px-3.5 py-1 text-xs font-medium text-[#2f3e50] transition hover:bg-[#f1f4f8] disabled:opacity-50";

export function ZaloPageContent({
  accountId,
  accountPicker
}: {
  accountId: string;
  accountPicker?: React.ReactNode;
}) {
  const z = useZalo(accountId);
  const push = usePushNotifications();

  const currentConv = z.conversations.find((c) => c.conversation_id === z.openConvId) || null;

  async function handleTogglePush() {
    const wasSubscribed = push.subscribed;
    const result = wasSubscribed ? await push.unsubscribe() : await push.subscribe();
    if (result.ok) {
      z.showToast(wasSubscribed ? "Đã tắt thông báo đẩy." : "Đã bật thông báo đẩy!", true);
    } else {
      z.showToast(result.error || "Thao tác thất bại", false);
    }
  }

  function handleStrangerMessaged(conversationId: string, known: { name: string; avatar: string | null }) {
    void z.openConversation(conversationId, known);
    z.showToast('Đã gửi "Hi".', true);
  }

  function handleFriendRequestSent(conversationId: string, known: { name: string; avatar: string | null }) {
    z.registerStrangerConversation(conversationId, known);
    z.showToast("Đã gửi lời mời kết bạn.", true);
  }

  /**
   * Bấm "Nhắn tin" trên 1 danh thiếp (contact card) có SĐT ngay trong tin
   * nhắn (yêu cầu người dùng 2026-09-18) — tra SĐT ra uid rồi MỞ hội thoại
   * với người đó (openConversation tự nhận biết đã có hội thoại hay chưa,
   * xem useZalo.ts — không cần tự kiểm tra trùng ở đây), KHÔNG tự gửi "Hi"
   * thay người dùng (khác luồng "tra người lạ" ở ZaloConversationList —
   * nhắn gì cho người quen qua danh thiếp là quyết định của nhân viên).
   */
  async function handleContactMessage(a: ZaloAttachment) {
    const phone = a.phone?.trim();
    if (!phone) return;
    try {
      const user = await zaloApi.findUserByPhone(phone, accountId);
      if (!user) {
        z.showToast("Không tìm thấy tài khoản Zalo cho số này.", false);
        return;
      }
      await z.openConversation(user.conversation_id, { name: user.display_name, avatar: user.avatar });
    } catch (e) {
      z.showToast(e instanceof Error ? e.message : "Không mở được hội thoại", false);
    }
  }

  function handleMessageRecalled(messageId: string) {
    // Cập nhật tức thì (không đợi network) rồi vẫn refetch nền để khớp lại
    // với server — xem markMessageRecalledLocally() ở useZalo.ts.
    z.markMessageRecalledLocally(messageId);
    void z.refreshCurrentThread();
  }

  const authToolbar = (
    <>
      <ZaloAuthCard
        variant="inline"
        status={z.loginStatus}
        loading={z.authLoading}
        error={z.authError}
        onImport={z.importFromExtension}
        onCancelImport={z.cancelImportFromExtension}
        onLogout={z.logout}
        onRefresh={z.refreshAuth}
        onReconnect={z.reconnectBridge}
        reconnecting={z.reconnecting}
      />
      {push.supported ? (
        <button
          type="button"
          onClick={() => void handleTogglePush()}
          disabled={push.loading}
          className={PUSH_BTN}
          title={push.subscribed ? "Tắt thông báo đẩy" : "Bật thông báo đẩy khi có tin nhắn mới"}
        >
          {push.loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : push.subscribed ? (
            <BellRing className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
          {push.subscribed ? "Đang bật" : "Thông báo"}
        </button>
      ) : push.iosNeedsHomeScreen ? (
        <details className="group relative">
          <summary
            className={`${PUSH_BTN} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            title="Vì sao chưa thấy nút bật thông báo trên iPhone?"
          >
            <Info className="h-3.5 w-3.5 text-amber-600" />
            Thông báo
          </summary>
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border-l-[3px] border-amber-400 bg-[#fff8e6] px-3 py-3 text-left text-[12px] font-normal leading-relaxed text-[#7a6b3a] shadow-lg">
            <p className="font-semibold">iPhone chưa bật được thông báo đẩy</p>
            <p className="mt-1">Safari chỉ cho bật thông báo khi trang đã được "Thêm vào Màn hình chính":</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>Mở trang này bằng Safari (không phải Chrome hay app khác).</li>
              <li>Bấm nút Chia sẻ (hình vuông mũi tên lên) ở thanh dưới màn hình.</li>
              <li>Chọn "Thêm vào MH chính" (Add to Home Screen).</li>
              <li>Mở lại app từ icon vừa thêm, sau đó bấm nút "Thông báo" ở đây.</li>
            </ol>
          </div>
        </details>
      ) : null}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Chỉ hiện từ lg trở lên (2026-10-03, báo lỗi: dòng trạng thái này chồng
          lấn lên cụm nút header trên mobile, rối mắt) — trên mobile không cần
          dòng debug này, SSE health đã có lưới an toàn (reconnect-on-focus +
          poll 45s) lo phía sau, không cần hiện trạng thái kỹ thuật cho người
          dùng mobile thấy. */}
      {z.sseState !== "closed" && z.sseState !== "open" ? (
        <div className="hidden shrink-0 items-center gap-3 border-b border-[#eef1f5] bg-white px-6 py-2 text-xs lg:flex">
          <span className="inline-flex items-center gap-1.5 text-amber-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            {z.sseState === "connecting" ? "Đang kết nối realtime..." : "Realtime đang reconnect..."}
          </span>
        </div>
      ) : z.sseState === "open" ? (
        <div className="hidden shrink-0 items-center gap-3 border-b border-[#eef1f5] bg-white px-6 py-2 text-xs lg:flex">
          <span className="inline-flex items-center gap-1.5 text-emerald-600">
            <Radio className="h-3 w-3 animate-pulse" />
            Realtime đang bật
          </span>
        </div>
      ) : null}

      {/* Desktop: danh sách hội thoại + chat song song */}
      <div className="hidden min-h-0 flex-1 overflow-hidden lg:flex">
        <div className="flex h-full min-h-0 w-[360px] min-w-[280px] shrink-0 flex-col border-r border-[#e6eaef] bg-[#f8fafc]">
          {accountPicker ? <div className="border-b border-[#eef1f5] px-5 py-3">{accountPicker}</div> : null}
          <div className="min-h-0 flex-1">
            <ZaloConversationList
              conversations={z.conversations}
              loading={z.loadingConvs}
              openConvId={z.openConvId}
              onOpen={z.openConversation}
              onSync={z.syncConversations}
              accountId={accountId}
              onStrangerMessaged={handleStrangerMessaged}
              onFriendRequestSent={handleFriendRequestSent}
              onUpdateTags={z.updateConversationTags}
              onUpdatePin={z.updateConversationPin}
            />
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1">
          <ZaloChatPanel
            conv={currentConv}
            messages={z.messages}
            loading={z.loadingChat}
            sending={z.sending}
            replyText={z.replyText}
            setReplyText={z.setReplyText}
            pendingFiles={z.pendingFiles}
            setPendingFiles={z.setPendingFiles}
            pendingMentions={z.pendingMentions}
            setPendingMentions={z.setPendingMentions}
            onSend={z.sendCurrentMessage}
            onSync={z.syncCurrentChat}
            onMessageRecalled={handleMessageRecalled}
            onSearchMessages={z.searchMessagesInThread}
            onJumpToMessage={z.jumpToMessage}
            highlightedMessageId={z.highlightedMessageId}
            onReactionApplied={z.applyReactionLocally}
            replyingTo={z.replyingTo}
            onStartReply={z.setReplyingTo}
            onCancelReply={z.cancelReply}
            headerActions={authToolbar}
            accountId={accountId}
            conversations={z.conversations}
            onContactMessage={handleContactMessage}
          />
        </div>
      </div>

      {/* Mobile: trải nghiệm giống Zalo — vào /chat sẽ là danh sách hội thoại.
          Chọn một hội thoại thì chuyển toàn màn hình sang khung chat; nút Back
          trên header đưa người dùng quay lại danh sách. */}
      <div className="flex min-h-0 flex-1 overflow-hidden lg:hidden">
        {!z.openConvId ? (
          <div className="flex h-full min-h-0 w-full flex-col bg-[#f8fafc]">
            <div className="shrink-0 border-b border-[#e6eaef] bg-white px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#0a1a2b]">Hội thoại</div>
                {accountPicker ? <div className="mt-2 min-w-0 overflow-x-auto">{accountPicker}</div> : null}
              </div>
              <div className="mt-2 min-w-0 overflow-x-auto">
                <div className="flex w-max min-w-full flex-nowrap items-center gap-1.5 pb-0.5">{authToolbar}</div>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ZaloConversationList
                conversations={z.conversations}
                loading={z.loadingConvs}
                openConvId={z.openConvId}
                onOpen={z.openConversation}
                onSync={z.syncConversations}
                accountId={accountId}
                onStrangerMessaged={handleStrangerMessaged}
                onFriendRequestSent={handleFriendRequestSent}
              onUpdateTags={z.updateConversationTags}
              onUpdatePin={z.updateConversationPin}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            <ZaloChatPanel
              conv={currentConv}
              messages={z.messages}
              loading={z.loadingChat}
              sending={z.sending}
              replyText={z.replyText}
              setReplyText={z.setReplyText}
              pendingFiles={z.pendingFiles}
              setPendingFiles={z.setPendingFiles}
              pendingMentions={z.pendingMentions}
              setPendingMentions={z.setPendingMentions}
              onSend={z.sendCurrentMessage}
              onSync={z.syncCurrentChat}
              onMessageRecalled={handleMessageRecalled}
              onSearchMessages={z.searchMessagesInThread}
              onJumpToMessage={z.jumpToMessage}
              highlightedMessageId={z.highlightedMessageId}
            onReactionApplied={z.applyReactionLocally}
            replyingTo={z.replyingTo}
            onStartReply={z.setReplyingTo}
            onCancelReply={z.cancelReply}
              onBack={z.closeConversation}
              headerActions={authToolbar}
              accountId={accountId}
              conversations={z.conversations}
              onContactMessage={handleContactMessage}
            />
          </div>
        )}
      </div>

      {z.toast && (
        <div
          className={`fixed bottom-4 right-4 z-[60] flex max-w-sm items-start gap-2 rounded-xl px-4 py-3 text-xs font-semibold text-white shadow-lg ${z.toast.ok ? "bg-emerald-600" : "bg-red-600"}`}
        >
          <span className="flex-1">{z.toast.msg}</span>
          <button onClick={() => z.showToast("", true)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
