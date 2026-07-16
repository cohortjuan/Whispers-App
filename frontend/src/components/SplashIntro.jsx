import { useEffect, useState } from 'react';

// a one-time "zoom out from the ancestors" intro: the logo starts huge and
// centered, then shrinks down to land exactly where the real navbar logo
// sits, then shimmers. plays on every real page load (first visit, refresh,
// coming back later) since this only ever mounts once per load -- react
// router swapping pages underneath it doesn't remount it, so it naturally
// never replays just from clicking around
export default function SplashIntro() {
  const [show, setShow] = useState(true);
  const [theme] = useState(() => document.documentElement.getAttribute('data-theme'));

  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 2300);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="splash-intro" aria-hidden="true">
      <img src={theme === 'dark' ? '/tree-logo-dark.svg' : '/tree-logo.svg'} className="splash-logo" alt="" />
      {/* sits at the logo's landed spot the whole time -- invisible until its
          own delayed keyframe sweeps a shine across it */}
      <div className="splash-shimmer" />
    </div>
  );
}
