'use client';

import { Component, type ReactNode } from 'react';

/**
 * Catches any render/runtime error in the app and shows a recoverable screen instead of
 * a blank crash. In a Telegram Mini App a thrown error otherwise leaves the user staring
 * at a white page with no way back — this at least offers a reload and shows what broke,
 * which is also how we learn about device-specific failures we can't reproduce.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Best-effort: surface it wherever a console is available.
    try {
      console.error('App crashed:', error);
    } catch {
      /* ignore */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash-emoji">😵</div>
          <div className="crash-title">Something went wrong</div>
          <div className="crash-msg">Reopen the game to keep playing. Your balance is safe.</div>
          <button className="crash-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          <div className="crash-detail">{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
