import { Component } from 'react';
import CrashGame from './CrashGame.jsx';

// A render error anywhere below this (a bad API response shaped differently
// than a component expects, etc.) used to blank the entire page with
// nothing in the UI to explain why -- only the browser console showed
// anything. This gives the person a real page instead: the logo, an honest
// "this is on us" instead of corporate error-speak, and a tiny distraction
// to tap at while they decide whether to reload.
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
        <div className="crash-page">
          <img src="/tree-logo.svg" alt="Whispers App" className="crash-logo" />
          <h1>whoops, that's on us</h1>
          <p>
            something broke back there -- not your fault, and your data's
            fine. reload usually sorts it out. in the meantime...
          </p>
          <CrashGame />
          <button className="btn" type="button" onClick={() => window.location.assign('/')}>
            reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
