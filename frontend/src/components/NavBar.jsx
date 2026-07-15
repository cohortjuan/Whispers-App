import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const THEME_KEY = 'whispers-theme';

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// just the top bar, links to the two main views plus the add-person shortcut
export default function NavBar() {
  const [theme, setTheme] = useState(getInitialTheme);

  // the whole app themes off this one attribute on <html> -- every color in
  // index.css is a css variable that gets redefined under [data-theme="dark"]
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        <img src={theme === 'dark' ? '/tree-logo-dark.svg' : '/tree-logo.svg'} alt="" className="navbar-logo" />
        Whispers App
      </Link>
      <div className="navbar-links">
        <Link to="/">People</Link>
        <Link to="/tree">Family Tree</Link>
        <Link to="/people/new">+ Add Person</Link>
      </div>
      {/* pinned to the corner via css, not part of the navbar-links flow --
          otherwise it wraps down with the other links on narrow screens */}
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        title={theme === 'dark' ? 'switch to light mode' : 'switch to dark mode'}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
    </nav>
  );
}
