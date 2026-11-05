"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class KpiErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("KpiErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 border border-red-200 bg-red-50/60 rounded-xl space-y-4 my-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-red-100 rounded-lg text-red-600 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-red-900">
                {this.props.fallbackTitle || "Đã xảy ra lỗi khi hiển thị giao diện KPI"}
              </h3>
              <p className="text-xs text-red-700 font-mono break-all">
                {this.state.error?.message || "Lỗi không xác định"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={this.handleReset}
              className="gap-1.5 text-xs bg-white hover:bg-red-50 text-red-700 border-red-200"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử tải lại
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
