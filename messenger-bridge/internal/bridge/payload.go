package bridge

import (
	"strconv"

	"go.mau.fi/mautrix-meta/pkg/messagix/table"
	"go.mau.fi/whatsmeow/proto/waConsumerApplication"
	waTypes "go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

// Webhook payloads — field names are the fixed contract in plan.md.

type Attachment struct {
	Kind string `json:"kind"` // image | file
	URL  string `json:"url"`
	Name string `json:"name"`
}

type MessagePayload struct {
	Type        string       `json:"type"` // "message"
	AccountID   string       `json:"account_id"`
	PeerID      string       `json:"peer_id"`
	PeerName    *string      `json:"peer_name"`
	MessageID   string       `json:"message_id"`
	Text        string       `json:"text"`
	IsSelf      bool         `json:"is_self"`
	E2EE        bool         `json:"e2ee"`
	TimestampMS int64        `json:"timestamp_ms"`
	Attachments []Attachment `json:"attachments"`
}

type StatusPayload struct {
	Type      string  `json:"type"` // "status"
	AccountID string  `json:"account_id"`
	Status    string  `json:"status"` // connected | disconnected | checkpoint | expired
	Error     *string `json:"error"`
}

const attachmentPlaceholder = "(Tệp đính kèm)"

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// mapLSMessage converts a plain (non-E2EE) Messenger message. Returns false for messages
// that must not be forwarded (admin/unsent/empty, or not a 1:1 chat).
func mapLSMessage(accountID string, selfID int64, msg *table.WrappedMessage, peerName string) (*MessagePayload, bool) {
	if msg == nil || msg.LSInsertMessage == nil || msg.IsAdminMessage || msg.IsUnsent || msg.MessageId == "" {
		return nil, false
	}
	isSelf := msg.SenderId == selfID
	// In a 1:1 thread the thread key is the other user's FBID, so any third sender means a group.
	if !isSelf && msg.SenderId != msg.ThreadKey {
		return nil, false
	}
	p := &MessagePayload{
		Type:        "message",
		AccountID:   accountID,
		PeerID:      strconv.FormatInt(msg.ThreadKey, 10),
		MessageID:   msg.MessageId,
		Text:        msg.Text,
		IsSelf:      isSelf,
		TimestampMS: msg.TimestampMs,
		Attachments: []Attachment{},
	}
	if !isSelf {
		p.PeerName = strPtr(peerName)
	}
	for _, a := range msg.BlobAttachments {
		p.Attachments = appendAttachment(p.Attachments, a.AttachmentType, a.Filename, a.PlayableUrl, a.PreviewUrl)
	}
	for _, a := range msg.Attachments {
		p.Attachments = appendAttachment(p.Attachments, a.AttachmentType, a.Filename, a.PlayableUrl, a.ImageUrl, a.PreviewUrl)
	}
	hasOther := len(msg.Stickers) > 0 || len(msg.XMAAttachments) > 0 || len(msg.BlobAttachments) > 0 || len(msg.Attachments) > 0
	if p.Text == "" {
		if !hasOther {
			return nil, false
		}
		p.Text = attachmentPlaceholder
	}
	return p, true
}

func appendAttachment(list []Attachment, typ table.AttachmentType, name string, urls ...string) []Attachment {
	for _, u := range urls {
		if u == "" {
			continue
		}
		kind := "file"
		if typ == table.AttachmentTypeImage || typ == table.AttachmentTypeAnimatedImage {
			kind = "image"
		}
		return append(list, Attachment{Kind: kind, URL: u, Name: name})
	}
	return list
}

// mapE2EEMessage converts an end-to-end encrypted 1:1 message. Media is not downloaded/decrypted
// (it would need re-hosting), so it is reported as a placeholder text without attachments.
func mapE2EEMessage(accountID string, evt *events.FBMessage) (*MessagePayload, bool) {
	if evt == nil || evt.Info.Chat.Server != waTypes.MessengerServer || evt.Info.ID == "" {
		return nil, false // groups use GroupServer
	}
	consumer, ok := evt.Message.(*waConsumerApplication.ConsumerApplication)
	if !ok {
		return nil, false
	}
	content := consumer.GetPayload().GetContent()
	text := content.GetMessageText().GetText()
	if text == "" {
		text = content.GetExtendedTextMessage().GetText().GetText()
	}
	if text == "" {
		if content.GetImageMessage() == nil && content.GetVideoMessage() == nil && content.GetAudioMessage() == nil &&
			content.GetDocumentMessage() == nil && content.GetStickerMessage() == nil && content.GetViewOnceMessage() == nil {
			return nil, false // reactions, edits, receipts...
		}
		text = attachmentPlaceholder
	}
	p := &MessagePayload{
		Type:        "message",
		AccountID:   accountID,
		PeerID:      evt.Info.Chat.User,
		MessageID:   evt.Info.ID,
		Text:        text,
		IsSelf:      evt.Info.IsFromMe,
		E2EE:        true,
		TimestampMS: evt.Info.Timestamp.UnixMilli(),
		Attachments: []Attachment{},
	}
	if !p.IsSelf {
		p.PeerName = strPtr(evt.Info.PushName)
	}
	return p, true
}
