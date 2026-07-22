import type { WeatherKind } from "../lib/weatherUi";

type WeatherGlyphProps = {
  kind: WeatherKind;
  /** Clear skies at night show the moon instead of the sun. */
  isNight?: boolean;
  className?: string;
};

type IconKind = WeatherKind | "moon";

function iconKind(kind: WeatherKind, isNight: boolean): IconKind {
  return kind === "sun" && isNight ? "moon" : kind;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="5.5" />
        <line x1="12" y1="18.5" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5.5" y2="12" />
        <line x1="18.5" y1="12" x2="22" y2="12" />
        <line x1="4.8" y1="4.8" x2="7.2" y2="7.2" />
        <line x1="16.8" y1="16.8" x2="19.2" y2="19.2" />
        <line x1="16.8" y1="7.2" x2="19.2" y2="4.8" />
        <line x1="4.8" y1="19.2" x2="7.2" y2="16.8" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M17 13.2a6.5 6.5 0 1 1-8.4-9.8A5.5 5.5 0 0 0 17 13.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 17.5h9.8a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10-2.1A3.4 3.4 0 0 0 7.2 17.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function RainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 14.5h9.8a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10-2.1A3.4 3.4 0 0 0 7.2 14.5Z"
        fill="currentColor"
      />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <line x1="8.5" y1="17.5" x2="7.5" y2="21" />
        <line x1="12" y1="17.5" x2="11" y2="21" />
        <line x1="15.5" y1="17.5" x2="14.5" y2="21" />
      </g>
    </svg>
  );
}

function SnowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 13.5h9.8a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10-2.1A3.4 3.4 0 0 0 7.2 13.5Z"
        fill="currentColor"
      />
      <g fill="currentColor">
        <circle cx="8.5" cy="18" r="1.1" />
        <circle cx="12" cy="19.2" r="1.1" />
        <circle cx="15.5" cy="18" r="1.1" />
      </g>
    </svg>
  );
}

function FogIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="5" y1="8" x2="19" y2="8" />
        <line x1="4" y1="12" x2="18" y2="12" />
        <line x1="6" y1="16" x2="20" y2="16" />
      </g>
    </svg>
  );
}

function ThunderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 13.5h9.8a3.8 3.8 0 0 0 .4-7.6 5.2 5.2 0 0 0-10-2.1A3.4 3.4 0 0 0 7.2 13.5Z"
        fill="currentColor"
      />
      <path d="M13.2 13.8 10.8 17.8h2.2l-1.4 3.2 4.4-5.4h-2.3l1.5-2.8Z" fill="#ffe066" />
    </svg>
  );
}

function UnknownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      <path
        d="M9.4 9.1a2.8 2.8 0 0 1 5 1.4c0 1.8-2.5 2-2.5 3.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="17.2" r="1" fill="currentColor" />
    </svg>
  );
}

function WeatherIcon({ icon }: { icon: IconKind }) {
  switch (icon) {
    case "sun":
      return <SunIcon />;
    case "moon":
      return <MoonIcon />;
    case "cloud":
      return <CloudIcon />;
    case "rain":
      return <RainIcon />;
    case "snow":
      return <SnowIcon />;
    case "fog":
      return <FogIcon />;
    case "thunder":
      return <ThunderIcon />;
    default:
      return <UnknownIcon />;
  }
}

export function WeatherGlyph({ kind, isNight = false, className = "" }: WeatherGlyphProps) {
  const icon = iconKind(kind, isNight);
  return (
    <span
      className={`weather-glyph${className ? ` ${className}` : ""}`}
      data-kind={kind}
      data-icon={icon}
      aria-hidden="true"
    >
      <WeatherIcon icon={icon} />
    </span>
  );
}
