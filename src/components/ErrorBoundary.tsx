import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportBoundaryError } from "@/lib/frontend-error-capture";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportBoundaryError(error, { componentStack: info.componentStack ?? undefined });
  }

  reset = (): void => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full space-y-3 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The error has been reported. You can try again or reload the page.
          </p>
          <pre className="text-xs text-left bg-muted/50 rounded p-2 overflow-auto max-h-40">
            {error.message}
          </pre>
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={this.reset}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-muted"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
