import React from 'react'

import { Button } from '@/components/ui/button'

type ErrorBoundaryProps = {
  children: React.ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[Renderer] Uncaught React error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[linear-gradient(180deg,#03111f_0%,#071a2d_55%,#0b2236_100%)] text-white flex items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/6 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.35)] p-10">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
              <span className="inline-block size-2 rounded-full bg-[hsl(var(--brand-green))]" />
              Kone Enterprise Recovery
            </div>

            <div className="mt-8 space-y-4">
              <div>
                <h1 className="text-3xl font-black tracking-tight">Something went wrong</h1>
                <p className="mt-3 text-sm leading-6 text-white/72">
                  Kone encountered an unexpected rendering error. The app is still protected, and you can safely reload
                  to restore the workspace.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
                This safeguard prevented a blank screen crash and preserved a controlled recovery path for your session.
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button className="h-10 px-5 text-sm font-semibold" onClick={this.handleReload}>
                Reload App
              </Button>
              <span className="text-xs text-white/45">
                If this keeps happening, please capture logs and contact support.
              </span>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
