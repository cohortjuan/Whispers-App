import { useEffect, useState } from 'react';

const SEEN_KEY = 'whispers-splash-seen';

// a one-time "zoom out from the ancestors" intro: the logo starts huge and
// centered, then shrinks down to land exactly where the real navbar logo
// sits, then sparkles. once per browser session, not on every navigation
export default function SplashIntro() {
  const [show, setShow] = useState(() => !sessionStorage.getItem(SEEN_KEY));
  const [theme] = useState(() => document.documentElement.getAttribute('data-theme'));

  useEffect(() => {
    if (!show) return;
    sessionStorage.setItem(SEEN_KEY, '1');
    const timer = setTimeout(() => setShow(false), 2300);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show) return null;

  return (
    <div className="splash-intro" aria-hidden="true">
      <img src={theme === 'dark' ? '/tree-logo-dark.svg' : '/tree-logo.svg'} className="splash-logo" alt="" />
      <span className="splash-sparkle splash-sparkle-1">✨</span>
      <span className="splash-sparkle splash-sparkle-2">✨</span>
      <span className="splash-sparkle splash-sparkle-3">✨</span>
    </div>
  );
}
