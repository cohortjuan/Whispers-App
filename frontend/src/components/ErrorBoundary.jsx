import { Component } from 'react';

// A render error anywhere below this (a bad API response shaped differently
// than a component expects, etc.) used to blank the entire page with
// nothing in the UI to explain why -- only the browser console showed
// anything. This at least gives the person a way back in instead of a
// dead white screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>something went wrong</h1>
          <p>
            this page hit an unexpected error. reloading usually fixes it --
            if it keeps happening, signing out and back in might help.
          </p>
          <button className="btn" type="button" onClick={() => window.location.assign('/')}>
            reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
