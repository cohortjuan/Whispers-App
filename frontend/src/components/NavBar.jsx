import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const THEME_KEY = "whispers-theme";

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();

  // index.html's inline script already worked out light-vs-dark (localStorage,
  // falling back to the OS preference) and set it on <html> before react even
  // mounted, so read that instead of re-deriving the same thing a second time
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme"),
  );

  // the whole app themes off this one attribute on <html> -- every color in
  // index.css is a css variable that gets redefined under [data-theme="dark"]
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const handleHomeClick = (event) => {
    event.preventDefault();

    if (location.pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    navigate("/");
  };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        <img
          src={theme === "dark" ? "/tree-logo-dark.svg" : "/tree-logo.svg"}
          alt=""
          className="navbar-logo"
        />
        Whispers App
      </Link>
      <div className="navbar-links">
        <Link to="/">People</Link>
        <Link to="/tree">Family Tree</Link>
        <Link to="/about">🌰 About</Link>
        <Link to="/people/new">+ Add Person</Link>
      </div>
      <button
        type="button"
        className="home-float"
        title="Home"
        aria-label="Home"
        onClick={handleHomeClick}
      >
        <img
          src={theme === "dark" ? "/tree-logo-dark.svg" : "/tree-logo.svg"}
          alt=""
          className="home-float-icon"
        />
      </button>
      {/* pinned to the corner via css, not part of the navbar-links flow --
          otherwise it wraps down with the other links on narrow screens */}
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        title={
          theme === "dark" ? "switch to light mode" : "switch to dark mode"
        }
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    </nav>
  );
}
