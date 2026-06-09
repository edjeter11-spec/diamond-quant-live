"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional fallback. Defaults to null (silently hides the broken section). */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Wraps a section so a render error inside it does NOT take down the whole
 * page (which would trigger app/error.tsx → "Something broke" overlay).
 * Use for newer/experimental sections that haven't proven themselves.
 */
export default class SafeBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): State {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    if (typeof window !== "undefined") {
      console.error("[SafeBoundary] suppressed:", error);
    }
  }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
