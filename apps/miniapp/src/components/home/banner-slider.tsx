import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "@/constants/copy";

const slides = [
  {
    image: `${import.meta.env.BASE_URL}images/tet-travel.jpg`,
    title: copy.banners.tetTitle,
    description: copy.banners.tetDescription,
    action: true,
  },
  {
    image: `${import.meta.env.BASE_URL}images/care-travel.jpg`,
    title: copy.banners.careTitle,
    description: copy.banners.careDescription,
    action: false,
  },
];

export function BannerSlider({ onSearch }: { onSearch: () => void }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const touchX = useRef<number | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((index) => (index + 1) % slides.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [paused, hovered, focused, reducedMotion]);
  const choose = (index: number) => {
    setActive((index + slides.length) % slides.length);
    setPaused(true);
  };
  return (
    <section
      className="pn-banner"
      aria-label={copy.banners.label}
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocused(false);
      }}
      onTouchStart={(event) => {
        touchX.current = event.touches[0].clientX;
      }}
      onTouchEnd={(event) => {
        if (touchX.current === null) return;
        const delta = event.changedTouches[0].clientX - touchX.current;
        if (Math.abs(delta) > 45) choose(active + (delta < 0 ? 1 : -1));
        touchX.current = null;
      }}
      onTouchCancel={() => {
        touchX.current = null;
      }}
    >
      <div className="pn-banner-window">
        <div
          className="pn-banner-track"
          style={{ transform: `translateX(-${active * 100}%)` }}
        >
          {slides.map((slide, index) => (
            <div
              key={slide.image}
              className="pn-banner-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} / ${slides.length}`}
              aria-hidden={index !== active}
            >
              <img
                src={slide.image}
                alt=""
                width="1200"
                height="800"
                fetchPriority={index === 0 ? "high" : "auto"}
                draggable={false}
              />
              <div className="pn-banner-copy">
                <h2>{slide.title}</h2>
                <p>{slide.description}</p>
                {!slide.action && (
                  <Link
                    className="pn-banner-action"
                    tabIndex={index === active ? 0 : -1}
                    to="/offers/care"
                  >
                    {copy.offers.details} →
                  </Link>
                )}
                {slide.action && (
                  <button
                    type="button"
                    className="pn-banner-action"
                    tabIndex={index === active ? 0 : -1}
                    onClick={onSearch}
                  >
                    {copy.search.submit}
                    <span aria-hidden="true"> →</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="pn-banner-controls">
        <button
          type="button"
          className="pn-banner-counter"
          aria-label={`${copy.banners.next}, ${active + 1}/${slides.length}`}
          onClick={() => choose(active + 1)}
        >
          {active + 1} / {slides.length}
        </button>
        {!reducedMotion && (
          <button
            className="pn-banner-pause"
            type="button"
            aria-label={paused ? copy.banners.play : copy.banners.pause}
            onClick={() => setPaused(!paused)}
          >
            {paused ? "▶" : "Ⅱ"}
          </button>
        )}
      </div>
    </section>
  );
}
