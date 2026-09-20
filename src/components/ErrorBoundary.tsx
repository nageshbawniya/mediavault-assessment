import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React only supports error boundaries as class components — there's no
 * hook equivalent (getDerivedStateFromError/componentDidCatch have no
 * hooks form as of React 18). This is the one intentional class component
 * in the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // In a real deployment this would go to an error-tracking service.
    console.error('Unhandled error in MediaVault UI:', error, info.componentStack);
  }

  private handleReset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="crash" role="alert">
          <h2>Something went wrong</h2>
          <p className="muted">
            The page hit an unexpected error. Trying again usually fixes it.
          </p>
          <button onClick={this.handleReset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
