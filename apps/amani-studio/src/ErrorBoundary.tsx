import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="page" role="alert">
        <h1>Workspace display unavailable</h1>
        <p>
          The renderer could not display the current snapshot. Engine records
          remain in the local workspace.
        </p>
        <button className="button" onClick={() => location.reload()}>
          Reconnect engine
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
