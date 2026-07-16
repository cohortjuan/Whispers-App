// the "why" behind the app -- no data fetching here, just the pitch
export default function About() {
  return (
    <div>
      <div className="page-header">
        <h1>About</h1>
        <h2 className="page-subtitle">Why This Exists</h2>
      </div>

      <div className="about-blurb">
        <p>
          Your kid says "I love you" for the first time at two. At sixteen,
          rolling their eyes at you on the way out the door, they'd rather die
          than say it out loud again -- but it's the same kid under there, and
          you'll want proof someday. The whole family sings happy birthday
          off-key to Grandma every single year. Nobody records it, because why
          would you -- there's always next year. Until, one year, there isn't.
          Grandpa tells the same joke at every holiday. Grandma has the same
          three stories. You've heard them a hundred times, and you'll miss them
          the moment you can't hear them again.
        </p>
        <p>
          Everyone already has these moments buried somewhere in a phone -- a
          camera roll a thousand photos deep, a cloud storage plan you keep
          paying more for every year, findable only by whoever remembers which
          phone, which year, which app. Whispers App is one place built for
          exactly this: clips tied to an actual person and their spot in your
          family tree, simple enough that someone who's never touched an app
          like this before can sit down alone and record their own story, with
          nowhere else it needs to live.
        </p>
        <p>
          Whether it's the toddler voice you'll want to tease them with at
          sixteen, or the story your dad tells the same way every time -- we
          just want you to still be able to hear it.
        </p>
      </div>

      <video
        className="about-video"
        src="/about-video.mp4"
        autoPlay
        loop
        muted
        playsInline
      />
    </div>
  );
}
