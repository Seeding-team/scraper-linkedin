"use client";

import { useState } from "react";
import {
  ExternalLink,
  FileSearch,
  Loader2,
  MessageCircle,
  ThumbsUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { phoneBridgeService } from "@/services/phone-bridge.service";
import type { PhoneBridgeActionResponse } from "@/types/phone-bridge";

interface PhoneBridgeFacebookPanelProps {
  serial: string;
}

type FacebookAction =
  | "open"
  | "prepare-like"
  | "confirm-like"
  | "comment"
  | "create-preview";

function responseMessage(result: PhoneBridgeActionResponse): string {
  if (typeof result.preview === "string") return result.preview;
  if (result.preview) return JSON.stringify(result.preview);
  return result.message ?? "Thao tác đã hoàn tất.";
}

export function PhoneBridgeFacebookPanel({
  serial,
}: PhoneBridgeFacebookPanelProps) {
  const [url, setUrl] = useState("");
  const [comment, setComment] = useState("");
  const [commentPreview, setCommentPreview] = useState<string | null>(null);
  const [postText, setPostText] = useState("");
  const [confirmationToken, setConfirmationToken] = useState("");
  const [busy, setBusy] = useState<FacebookAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [postPreview, setPostPreview] = useState<string | null>(null);

  const execute = async (
    action: FacebookAction,
    task: () => Promise<PhoneBridgeActionResponse>,
    after?: (result: PhoneBridgeActionResponse) => void,
  ) => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const result = await task();
      after?.(result);
      setNotice(responseMessage(result));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Thao tác Facebook thất bại.",
      );
    } finally {
      setBusy(null);
    }
  };

  const prepareLike = () =>
    execute(
      "prepare-like",
      () =>
        phoneBridgeService.prepareFacebookLike(
          serial,
          url.trim() || undefined,
        ),
      (result) => {
        if (!result.confirmationToken) {
          throw new Error("Backend không trả về confirmationToken.");
        }
        setConfirmationToken(result.confirmationToken);
      },
    );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Tương tác bài viết</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mở link trước, sau đó chuẩn bị và xác nhận Like bằng hai bước riêng.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="facebook-post-url">
            URL bài viết Facebook
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="facebook-post-url"
              type="url"
              value={url}
              placeholder="https://www.facebook.com/..."
              disabled={busy !== null}
              onChange={(event) => {
                setUrl(event.target.value);
                setConfirmationToken("");
              }}
            />
            <Button
              variant="outline"
              disabled={!url.trim() || busy !== null}
              onClick={() =>
                void execute("open", () =>
                  phoneBridgeService.openFacebookPost(serial, url.trim()),
                )
              }
            >
              {busy === "open" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ExternalLink />
              )}
              Mở link
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => void prepareLike()}
            >
              {busy === "prepare-like" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ThumbsUp />
              )}
              Chuẩn bị Like
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmationToken || busy !== null}
              onClick={() =>
                void execute(
                  "confirm-like",
                  () =>
                    phoneBridgeService.confirmFacebookLike(
                      serial,
                      confirmationToken,
                    ),
                  () => setConfirmationToken(""),
                )
              }
            >
              {busy === "confirm-like" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ThumbsUp />
              )}
              Xác nhận Like thật
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Nút xác nhận chỉ bật khi bước chuẩn bị trả về token hợp lệ.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="facebook-comment">
            Bình luận
          </label>
          <Textarea
            id="facebook-comment"
            value={comment}
            disabled={busy !== null}
            placeholder="Nội dung bình luận..."
            onChange={(event) => {
              setComment(event.target.value);
              setCommentPreview(null);
            }}
          />
          {commentPreview ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
                Xác nhận bình luận thật
              </p>
              <p className="whitespace-pre-wrap break-words">{commentPreview}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {commentPreview ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => setCommentPreview(null)}
                >
                  Hủy xác nhận
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() =>
                    void execute(
                      "comment",
                      () =>
                        phoneBridgeService.commentOnFacebookPost(
                          serial,
                          commentPreview,
                        ),
                      () => {
                        setComment("");
                        setCommentPreview(null);
                      },
                    )
                  }
                >
                  {busy === "comment" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <MessageCircle />
                  )}
                  Xác nhận gửi bình luận thật
                </Button>
              </>
            ) : (
              <Button
                disabled={!comment.trim() || busy !== null}
                onClick={() => setCommentPreview(comment.trim())}
              >
                <MessageCircle />
                Xem trước bình luận
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Tạo bài viết (chỉ dry-run)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Trial UI không cung cấp điều khiển đăng bài thật.
          </p>
        </div>
        <Textarea
          value={postText}
          disabled={busy !== null}
          className="min-h-36"
          placeholder="Nội dung bài viết cần kiểm tra..."
          onChange={(event) => {
            setPostText(event.target.value);
            setPostPreview(null);
          }}
        />
        <Button
          disabled={!postText.trim() || busy !== null}
          onClick={() =>
            void execute(
              "create-preview",
              () =>
                phoneBridgeService.previewFacebookPost(
                  serial,
                  postText.trim(),
                ),
              (result) => setPostPreview(responseMessage(result)),
            )
          }
        >
          {busy === "create-preview" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileSearch />
          )}
          Xem trước dry-run
        </Button>
        {postPreview ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
              Kết quả dry-run
            </p>
            <p className="whitespace-pre-wrap break-words">{postPreview}</p>
          </div>
        ) : null}
        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </p>
        ) : null}
      </section>
    </div>
  );
}
