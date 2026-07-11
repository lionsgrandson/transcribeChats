import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error?: Error;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('TranscribeChats could not render.', error, info.componentStack);
  }

  private refresh = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const moduleFailed = /dynamically imported module|importing a module script/i.test(error.message);
    return (
      <main className="fatal-page" role="alert">
        <section className="card fatal-card">
          <span className="fatal-icon" aria-hidden="true"><AlertTriangle /></span>
          <h1>TranscribeChats needs a refresh</h1>
          <p>
            {moduleFailed
              ? 'The app was updated while this window was open, so one page file is out of date.'
              : 'The interface could not finish loading. Your locally saved conversations have not been deleted.'}
          </p>
          <Button onClick={this.refresh}><RefreshCw size={17} />Refresh app</Button>
          <small>If this repeats during development, press Ctrl+Shift+R once to bypass the browser cache.</small>
        </section>
      </main>
    );
  }
}
