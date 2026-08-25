import { Link } from 'react-router-dom';

// The public front door -- what a signed-out visitor sees at "/" instead of
// being dropped straight onto a bare login form. landing-video.mp4 is its
// own asset, separate from about-video.mp4 on the About page. SplashIntro
// still plays on top of this like every other page load -- nothing here
// replaces that, it's a separate, simpler layer underneath it.
export default function Landing() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-nav-brand">
          {/* Always the dark-theme (light-colored) mark, not whichever the
              site's theme toggle currently prefers -- this hero sits on a
              dark scrim over video regardless of that setting, same as
              Gather's own homepage staying dark independent of its toggle. */}
          <img src="/tree-logo-dark.svg" alt="" className="landing-nav-logo" />
          Whispers App
        </div>
        <div className="landing-nav-actions">
          <Link to="/login" className="landing-nav-btn">Sign in</Link>
          <Link to="/signup" className="landing-nav-btn landing-nav-btn-primary">
            Create an account
          </Link>
        </div>
      </nav>

      <header className="landing-hero">
        <video
          className="landing-video"
          src="/landing-video.mp4"
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />
        <div className="landing-hero-content">
          <div className="landing-wordmark">
            <img src="/tree-logo-dark.svg" alt="" className="landing-wordmark-logo" />
            <span className="landing-wordmark-text">Whispers</span>
          </div>
          <h1>
            Their voice deserves<br />somewhere to live.
          </h1>
          <p>
            The birthday songs, the same three stories at every holiday, the
            way your kid says your name right now, at this age, and never
            again after this year. Record it, tie it to their spot in your
            family tree, and keep it somewhere that isn't just a camera roll
            you'll lose track of.
          </p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="btn landing-hero-btn">
              Create an account
            </Link>
            <Link to="/login" className="landing-hero-link">
              Already have an account? Sign in
            </Link>
          </div>
          <p className="landing-hero-reassurance">
            Free to start. No credit card needed.
          </p>
        </div>
      </header>
    </div>
  );
}
