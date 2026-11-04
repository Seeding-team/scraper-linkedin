import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawUrl = searchParams.get("url") || "";
    let filename = searchParams.get("filename") || "attachment";

    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Only HTTP/HTTPS protocols are allowed" }, { status: 400 });
    }

    // Loại bỏ ký tự điều khiển tránh header injection
    filename = filename.replace(/[\r\n\t]/g, " ").trim();
    if (!filename) filename = "attachment";

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Upstream resource returned HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    // Chuẩn hóa RFC 5987 / RFC 6266: fallback ASCII và filename* cho tiếng Việt có dấu
    const safeAscii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
    const encodedUtf8 = encodeURIComponent(filename);
    const contentDisposition = `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedUtf8}`;

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", contentDisposition);
    headers.set("Cache-Control", "public, max-age=3600");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to download file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

