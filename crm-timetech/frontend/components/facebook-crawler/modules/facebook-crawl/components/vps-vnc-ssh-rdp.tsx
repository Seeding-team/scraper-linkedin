"use client";

import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { MaterialIcon } from "@/components/ui";
import "@xterm/xterm/css/xterm.css";

const API_BASE = process.env.NEXT_PUBLIC_API_FACEBOOK_BASE_URL || "http://127.0.0.1:8000";

// Lấy WebSocket URL (Sử dụng API_BASE để kết nối trực tiếp backend)
const getWsUrl = (path: string) => {
  try {
    const url = new URL(API_BASE || window.location.origin, window.location.origin);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}${path}`;
  } catch (e) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }
};

interface Vps {
  id: string;
  display_name: string;
  ip: string;
  password?: string;
  port?: number;
  vps_protocol_enum?: string;
  username?: string;
  Username?: string;
}

// ── SSH SCREEN COMPONENT ──────────────────────────────────────────────────────
const SshScreen = ({ vps, isFocused, onFocus }: { vps: Vps, isFocused: boolean, onFocus: () => void }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<any>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    terminalRef.current.innerHTML = ""; // Clear React StrictMode duplicates

    let ws: WebSocket;

    // Load xterm modules dynamically
    Promise.all([
      // @ts-ignore
      import("@xterm/xterm"),
      // @ts-ignore
      import("@xterm/addon-fit")
    ]).then(([xtermModule, fitModule]) => {
      const Terminal = xtermModule.Terminal;
      const FitAddon = fitModule.FitAddon;

      const term = new Terminal({
        cursorBlink: true,
        theme: {
          background: "#0f172a", // slate-900
          foreground: "#f8fafc",
          cursor: "#3b82f6",
          selectionBackground: "rgba(59, 130, 246, 0.3)"
        },
        fontFamily: "'Fira Code', 'JetBrains Mono', 'Courier New', monospace",
        fontSize: 14
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(terminalRef.current!);
      fitAddon.fit();
      xtermRef.current = term;

      term.writeln(`\x1b[36m[*] Đang khởi tạo kết nối SSH tới ${vps.ip}...\x1b[0m`);

      const wsUrl = getWsUrl(`/api/all-platform/vnc-vps/ssh/${vps.id}`);
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        term.writeln(`\x1b[32m[*] Đã kết nối thành công tới ${vps.ip}\x1b[0m\r\n`);

        // Gửi thông tin resize ban đầu
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
        }
      };

      ws.onmessage = (event) => {
        // Event data từ WebSocket proxy của asyncssh
        term.write(event.data);
      };

      ws.onerror = () => {
        setStatus("error");
        term.writeln("\x1b[31m[!] Lỗi kết nối WebSocket.\x1b[0m");
      };

      ws.onclose = () => {
        setStatus("disconnected");
        term.writeln("\x1b[33m[*] Kết nối đã bị đóng.\x1b[0m");
      };

      // Xử lý khi user gõ phím
      term.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Handle Resize Window
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
          }
        } catch (e) { }
      });
      resizeObserver.observe(terminalRef.current!);

      return () => {
        resizeObserver.disconnect();
      };
    }).catch(err => {
      setStatus("error");
      console.error("Lỗi load xterm", err);
    });

    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }
    };
  }, [vps.id, vps.ip]);

  const handleClick = () => {
    onFocus();
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  return (
    <div
      className={
        isFocused
          ? "fixed inset-4 md:inset-10 z-[100] flex flex-col rounded-xl overflow-hidden border-2 border-emerald-500 shadow-[0_0_50px_rgba(16,185,129,0.6)] bg-slate-900"
          : "relative flex flex-col rounded-xl overflow-hidden border-2 transition-all duration-200 bg-slate-900 border-slate-700 hover:border-emerald-500/50 aspect-video cursor-pointer"
      }
      onClick={!isFocused ? handleClick : undefined}
    >
      {/* Header Bar */}
      <div className={`flex items-center justify-between px-3 py-1.5 font-bold shrink-0 z-20 ${isFocused ? "bg-emerald-600 text-white py-3 px-4 text-sm" : "bg-slate-800 text-slate-300 text-xs"}`}>
        <div className="flex items-center gap-2">
          <MaterialIcon name={"terminal" as any} className="text-[14px]" />
          <span>{vps.display_name || "Khuyết danh"} ({vps.ip}) {vps.port ? `:${vps.port}` : ""}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {status === "connecting" && <span className="text-yellow-400 animate-pulse">Đang kết nối...</span>}
            {status === "connected" && <span className="text-emerald-300 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300"></span> Trực tuyến</span>}
            {status === "disconnected" && <span className="text-slate-400">Đã ngắt kết nối</span>}
            {status === "error" && <span className="text-red-400">Lỗi kết nối</span>}
          </div>
        </div>
      </div>

      {/* Terminal Container */}
      <div className="flex-1 relative bg-slate-900 p-2 overflow-hidden">
        <div ref={terminalRef} className="w-full h-full [&>.terminal]:h-full [&>.terminal]:w-full" />
      </div>

      {!isFocused && status === "connected" && (
        <div className="absolute inset-0 bg-black/10 z-20 cursor-pointer flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="bg-black/60 text-white px-4 py-2 rounded-full text-sm font-bold backdrop-blur-sm pointer-events-none">
            Click để gõ lệnh
          </div>
        </div>
      )}
    </div>
  );
};



// ── VNC SCREEN COMPONENT ──────────────────────────────────────────────────────
const VncScreen = ({ vps, isFocused, onFocus, onClose }: { vps: Vps, isFocused: boolean, onFocus: () => void, onClose: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const rfbRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear old canvases added by previous useEffect runs (React StrictMode issue)
    containerRef.current.innerHTML = "";

    const wsUrl = getWsUrl(`/api/all-platform/vnc-vps/vnc/${vps.id}`);

    // Sử dụng dynamic import để tránh lỗi SSR (window is not defined)
    // @ts-ignore
    import("@novnc/novnc").then((module) => {
      try {
        const RFB = module.default;
        // Khởi tạo thư viện noVNC
        const rfb = new RFB(containerRef.current, wsUrl, {
          credentials: { password: vps.password || "" },
        });

        rfbRef.current = rfb;

        // Scale viewport to fit container
        rfb.scaleViewport = true;
        // Tắt resizeSession vì VNC ảo trên Linux thường không hỗ trợ đổi độ phân giải động dễ dàng
        rfb.resizeSession = false;

        // Quản lý Focus - noVNC sẽ tự động lấy focus DOM khi click
        rfb.focusOnClick = true;

        rfb.addEventListener("connect", () => {
          setStatus("connected");
        });

        rfb.addEventListener("disconnect", (e: any) => {
          setStatus("disconnected");
          console.log(`VNC ${vps.ip} Disconnected`, e.detail);
        });

      } catch (err) {
        setStatus("error");
        console.error(`Lỗi khởi tạo VNC cho ${vps.ip}`, err);
      }
    }).catch((err) => {
      setStatus("error");
      console.error("Lỗi load thư viện noVNC", err);
    });

    return () => {
      if (rfbRef.current) {
        rfbRef.current.disconnect();
      }
    };
  }, [vps.id, vps.ip, vps.password]);

  // Handle focus states externally for visual indicators
  const handleClick = () => {
    onFocus();
    if (rfbRef.current) {
      rfbRef.current.focus();
    }
  };

  return (
    <div
      className={
        isFocused
          ? "fixed inset-4 md:inset-10 z-[100] flex flex-col rounded-xl overflow-hidden border-2 border-blue-500 shadow-[0_0_50px_rgba(59,130,246,0.6)] bg-slate-900"
          : "relative flex flex-col rounded-xl overflow-hidden border-2 transition-all duration-200 bg-slate-900 border-slate-700 hover:border-slate-500 aspect-video cursor-pointer"
      }
      onClick={!isFocused ? handleClick : undefined}
    >
      {/* Header Bar của màn hình */}
      <div className={`flex items-center justify-between px-3 py-1.5 font-bold shrink-0 z-20 ${isFocused ? "bg-blue-600 text-white py-3 px-4 text-sm" : "bg-slate-800 text-slate-300 text-xs"
        }`}>
        <div className="flex items-center gap-2">
          <MaterialIcon name={"computer" as any} className="text-[14px]" />
          <span>{vps.display_name || "Khuyết danh"} ({vps.ip}) {vps.port ? `:${vps.port}` : ""}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {status === "connecting" && <span className="text-yellow-400 animate-pulse">Đang kết nối...</span>}
            {status === "connected" && <span className="text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Trực tuyến</span>}
            {status === "disconnected" && <span className="text-slate-400">Đã ngắt kết nối</span>}
            {status === "error" && <span className="text-red-400">Lỗi kết nối</span>}
          </div>
          {isFocused && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md transition flex items-center gap-1 cursor-pointer"
            >
              <MaterialIcon name={"close" as any} className="text-[16px]" /> Đóng
            </button>
          )}
        </div>
      </div>

      {/* Khu vực render Canvas của noVNC */}
      <div className="flex-1 w-full relative bg-black flex items-center justify-center overflow-hidden">
        {/* DOM container dành riêng cho noVNC (không chứa component React nào để tránh xung đột khi clear) */}
        <div
          ref={containerRef}
          className="absolute inset-0 z-0 [&>div]:w-full [&>div]:h-full [&_canvas]:!w-full [&_canvas]:!h-full [&_canvas]:!object-contain"
        ></div>

        {status === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-white z-10">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="text-sm font-medium">Đang thiết lập luồng VNC...</p>
          </div>
        )}
      </div>

      {/* Lớp phủ khi mất focus để nhận biết */}
      {!isFocused && status === "connected" && (
        <div className="absolute inset-0 bg-black/10 z-20 cursor-pointer flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="bg-black/60 text-white px-4 py-2 rounded-full text-sm font-bold backdrop-blur-sm pointer-events-none">
            Click để điều khiển
          </div>
        </div>
      )}
    </div>
  );
};

// ── RDP SCREEN COMPONENT ──────────────────────────────────────────────────────
const RdpScreen = ({ vps, isFocused, onFocus, onClose }: { vps: Vps, isFocused: boolean, onFocus: () => void, onClose: () => void }) => {
  const handleDownloadRdp = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Tạo nội dung file .rdp
    const rdpContent = `auto connect:i:1
full address:s:${vps.ip}:${vps.port || 3389}
username:s:${vps.Username || vps.username || "Administrator"}
prompt for credentials:i:1
`;
    const blob = new Blob([rdpContent], { type: "application/x-rdp" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vps.display_name || "VPS"}_${vps.ip}.rdp`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Removed handleOpenRdpUri to use a native <a> tag instead.
  return (
    <div
      className={
        isFocused
          ? "fixed inset-4 md:inset-10 z-[100] flex flex-col rounded-xl overflow-hidden border-2 border-purple-500 shadow-[0_0_50px_rgba(168,85,247,0.6)] bg-slate-900"
          : "relative flex flex-col rounded-xl overflow-hidden border-2 transition-all duration-200 bg-slate-900 border-slate-700 hover:border-purple-500/50 aspect-video cursor-pointer"
      }
      onClick={!isFocused ? onFocus : undefined}
    >
      {/* Header Bar */}
      <div className={`flex items-center justify-between px-3 py-1.5 font-bold shrink-0 z-20 ${isFocused ? "bg-purple-600 text-white py-3 px-4 text-sm" : "bg-slate-800 text-slate-300 text-xs"}`}>
        <div className="flex items-center gap-2">
          <MaterialIcon name={"desktop_windows" as any} className="text-[14px]" />
          <span>{vps.display_name || "Khuyết danh"} ({vps.ip}) {vps.port ? `:${vps.port}` : ""}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-purple-400 font-medium">Chế độ RDP</span>
          </div>
          {isFocused && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md transition flex items-center gap-1 cursor-pointer"
            >
              <MaterialIcon name={"close" as any} className="text-[16px]" /> Đóng
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      {/* Content Area */}
      <div className="flex-1 relative w-full bg-slate-900 p-6 flex flex-col justify-center overflow-hidden">
        <div className="w-[90%] max-w-[450px] mx-auto text-center flex flex-col items-center">
          <MaterialIcon 
            name={"desktop_windows" as any} 
            className={`${isFocused ? 'text-[80px]' : 'text-[64px]'} text-purple-500/50 mb-4 transition-all`} 
          />

          <h3 className={`${isFocused ? 'text-xl' : 'text-lg'} font-bold text-white mb-2`}>
            Remote Desktop
          </h3>

          {isFocused && (
            <div className="w-full mt-2">
              <p className="text-slate-400 text-sm w-full mb-8">
                Giao thức RDP của Windows yêu cầu sử dụng phần mềm Remote Desktop có sẵn trên máy tính của bạn để đảm bảo tốc độ mượt mà nhất.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 w-full">
                <button
                  onClick={handleDownloadRdp}
                  className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-4 rounded-xl transition cursor-pointer shadow-lg shadow-purple-600/20 whitespace-nowrap"
                >
                  <MaterialIcon name={"download" as any} />
                  Tải File .rdp
                </button>

                <a
                  href={`ms-rd:server=${vps.ip}:${vps.port || 3389}`}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-xl transition cursor-pointer border border-slate-600 whitespace-nowrap"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MaterialIcon name={"launch" as any} />
                  Mở Ứng Dụng
                </a>
              </div>

              <div className="mt-8 p-4 bg-slate-800/50 rounded-lg border border-slate-700 text-left w-full">
                <p className="text-xs text-slate-400 font-mono mb-1">Mật khẩu mặc định (Click để copy):</p>
                <div
                  className="text-sm text-emerald-400 font-bold bg-black/30 p-2 rounded cursor-pointer hover:bg-black/50 transition flex justify-between items-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(vps.password || "");
                    alert("Đã copy mật khẩu!");
                  }}
                >
                  <span>{vps.password || "Không có mật khẩu"}</span>
                  <MaterialIcon name={"content_copy" as any} className="text-[16px]" />
                </div>
              </div>
            </div>
          )}
        </div>

        {!isFocused && (
          <div className="absolute inset-0 bg-black/10 z-20 cursor-pointer flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <div className="bg-black/60 text-white px-4 py-2 rounded-full text-sm font-bold backdrop-blur-sm pointer-events-none">
              Click để mở rộng
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── MANAGER CHÍNH ─────────────────────────────────────────────────────────────
export function VpsVncManager() {
  const [focusedVpsId, setFocusedVpsId] = useState<string | null>(null);
  const [protocolFilter, setProtocolFilter] = useState<"all" | "vnc" | "ssh" | "rdp">("all");

  // Fetch danh sách VPS
  const { data: vpsList = [], isLoading, error } = useQuery<Vps[]>({
    queryKey: ["vps_vnc_list"],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/all-platform/vnc-vps`);
      return res.data.data || [];
    },
    staleTime: 10000,
  });

  const filteredVpsList = vpsList.filter(vps => {
    if (protocolFilter === "all") return true;
    const protocol = vps.vps_protocol_enum || "vnc"; // Default is vnc
    return protocol.toLowerCase() === protocolFilter;
  });

  return (
    <div className="flex w-full h-full flex-col gap-4 font-sans bg-slate-50 p-4 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">Giám Sát Đa VPS (VNC/SSH/RDP)</h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Quản lý trực tiếp giao diện đồ họa và dòng lệnh máy ảo từ trình duyệt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Bộ lọc giao thức */}
          <div className="bg-white p-1 rounded-lg shadow-sm border border-slate-200 flex text-sm font-bold">
            <button
              className={`px-4 py-1.5 rounded-md transition cursor-pointer ${protocolFilter === "all" ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
              onClick={() => setProtocolFilter("all")}
            >
              Tất cả
            </button>
            <button
              className={`px-4 py-1.5 rounded-md transition cursor-pointer flex items-center gap-1 ${protocolFilter === "vnc" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
              onClick={() => setProtocolFilter("vnc")}
            >
              <MaterialIcon name={"computer" as any} className="text-[16px]" /> VNC
            </button>
            <button
              className={`px-4 py-1.5 rounded-md transition cursor-pointer flex items-center gap-1 ${protocolFilter === "ssh" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
              onClick={() => setProtocolFilter("ssh")}
            >
              <MaterialIcon name={"terminal" as any} className="text-[16px]" /> SSH
            </button>
            <button
              className={`px-4 py-1.5 rounded-md transition cursor-pointer flex items-center gap-1 ${protocolFilter === "rdp" ? "bg-purple-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100"}`}
              onClick={() => setProtocolFilter("rdp")}
            >
              <MaterialIcon name={"desktop_windows" as any} className="text-[16px]" /> RDP
            </button>
          </div>

          <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-200 flex items-center gap-3">
            <div className="text-sm font-bold text-slate-600">
              Tổng: <span className="text-blue-600">{filteredVpsList.length}</span>
            </div>
            <div className="w-px h-4 bg-slate-300"></div>
            <button
              className="text-sm font-bold text-slate-500 hover:text-slate-800 transition flex items-center gap-1 cursor-pointer"
              onClick={() => setFocusedVpsId(null)}
            >
              <MaterialIcon name={"close" as any} className="text-[16px]" />
              Thoát Focus (Esc)
            </button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center p-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-200 text-sm font-medium">
          Không thể tải danh sách VPS. Vui lòng kiểm tra kết nối tới Backend.
        </div>
      )}

      {/* Lớp phủ mờ (Backdrop) khi có một màn hình được phóng to */}
      {focusedVpsId && (
        <div
          className="fixed inset-0 bg-black/80 z-[90] backdrop-blur-sm transition-all"
          onClick={() => setFocusedVpsId(null)}
        />
      )}

      {/* Grid Layout chứa các màn hình VPS */}
      {!isLoading && !error && filteredVpsList.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 flex-1 auto-rows-fr">
          {filteredVpsList.map((vps) => {
            const protocol = vps.vps_protocol_enum?.toLowerCase() || "vnc";

            if (protocol === "ssh") {
              return (
                <SshScreen
                  key={vps.id}
                  vps={vps}
                  isFocused={focusedVpsId === vps.id}
                  onFocus={() => setFocusedVpsId(vps.id)}
                />
              );
            }
            if (protocol === "rdp") {
              return (
                <RdpScreen
                  key={vps.id}
                  vps={vps}
                  isFocused={focusedVpsId === vps.id}
                  onFocus={() => setFocusedVpsId(vps.id)}
                  onClose={() => setFocusedVpsId(null)}
                />
              );
            }
            return (
              <VncScreen
                key={vps.id}
                vps={vps}
                isFocused={focusedVpsId === vps.id}
                onFocus={() => setFocusedVpsId(vps.id)}
                onClose={() => setFocusedVpsId(null)}
              />
            );
          })}
        </div>
      )}

      {!isLoading && !error && filteredVpsList.length === 0 && (
        <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-slate-300 rounded-2xl bg-white text-slate-400">
          <MaterialIcon name={"error" as any} className="text-[48px] mb-4 opacity-50" />
          <p className="font-bold">Chưa có VPS nào trong hệ thống</p>
          <p className="text-sm">Vui lòng thêm VPS ở phần cấu hình.</p>
        </div>
      )}
    </div>
  );
}
