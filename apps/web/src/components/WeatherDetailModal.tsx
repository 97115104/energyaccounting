import { useEffect, useId, useMemo, useRef } from "react";
import { ModalCloseButton } from "./ModalCloseButton";
import { WeatherGlyph } from "./WeatherGlyph";
import {
  uvBand,
  weatherDaySuggestion,
  type DayWeather,
  type WeatherConditionsNow,
  type WeatherFavorite,
} from "../lib/weatherInsight";
import { formatTemp, formatTempRange, weatherLabel, type TemperatureUnit } from "../lib/weatherUi";

type WeatherDetailModalProps = {
  weather: DayWeather;
  /** Live (or history-snapshot) conditions for advice; daily fields stay on `weather`. */
  conditions: WeatherConditionsNow | null;
  tempUnit: TemperatureUnit;
  favorites: WeatherFavorite[];
  isDaylight: boolean;
  isHistorical?: boolean;
  onClose: () => void;
};

function localClock(iso: string | null): string {
  if (!iso) return "Unavailable";
  // Open-Meteo returns location-local ISO times without an offset. Preserve that
  // wall-clock time instead of accidentally converting it to the browser's zone.
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return "Unavailable";
  const clock = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(clock);
}

export function WeatherDetailModal({
  weather,
  conditions,
  tempUnit,
  favorites,
  isDaylight,
  isHistorical = false,
  onClose,
}: WeatherDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  const kind = conditions?.kind ?? "unknown";
  const uvNow = conditions?.uv ?? null;
  const uvNowBand = uvNow == null ? null : uvBand(uvNow);
  const uvMaxBand = weather.uvMax == null ? null : uvBand(weather.uvMax);
  const suggestion = useMemo(
    () =>
      weatherDaySuggestion({
        kind,
        uv: uvNow,
        precip: conditions?.precip ?? weather.precip,
        isDaylight,
        favorites,
      }),
    [favorites, isDaylight, kind, conditions?.precip, weather.precip, uvNow],
  );

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const focusFirst = () => modal?.querySelector<HTMLElement>("button, a[href]")?.focus({ preventScroll: true });
    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !modal) return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!modal.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    // Catch programmatic focus and re-entry from browser chrome, not only Tab
    // events that begin inside the dialog.
    const onFocusIn = (event: FocusEvent) => {
      if (modal && event.target instanceof Node && !modal.contains(event.target)) focusFirst();
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  const temperature =
    weather.tempMin != null && weather.tempMax != null
      ? formatTempRange(weather.tempMin, weather.tempMax, tempUnit)
      : weather.tempMax != null
        ? formatTemp(weather.tempMax, tempUnit)
        : weather.tempMin != null
          ? formatTemp(weather.tempMin, tempUnit)
          : "Unavailable";

  return (
    <div
      className="insight-scrim weather-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="panel insight-modal weather-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <ModalCloseButton label="Close weather details" onClick={onClose} />

        <header className="weather-modal-hero" data-kind={kind}>
          <WeatherGlyph kind={kind} isNight={!isDaylight} />
          <p className="weather-modal-eyebrow">
            {isHistorical ? "This day’s weather" : "Current forecast"}
          </p>
          <h2 id={titleId}>{weatherLabel(kind)}</h2>
          <p className="weather-modal-temperature">
            {isHistorical && weather.tempMin != null && weather.tempMax != null
              ? formatTempRange(weather.tempMin, weather.tempMax, tempUnit)
              : conditions?.temp != null
                ? formatTemp(conditions.temp, tempUnit)
                : temperature}
          </p>
          <p id={descriptionId} className="weather-modal-summary">
            {isHistorical
              ? "Day averages from the forecast, plus a personal idea for planning your energy."
              : "Forecast for right now, plus a personal idea for planning your energy."}
          </p>
        </header>

        <div className="weather-metrics" aria-label="Weather details">
          <div className="weather-metric">
            <span>High</span>
            <strong>
              {weather.tempMax == null ? "Unavailable" : formatTemp(weather.tempMax, tempUnit)}
            </strong>
          </div>
          <div className="weather-metric">
            <span>Low</span>
            <strong>
              {weather.tempMin == null ? "Unavailable" : formatTemp(weather.tempMin, tempUnit)}
            </strong>
          </div>
          <div className="weather-metric">
            <span>Precipitation</span>
            <strong>{weather.precip == null ? "Unavailable" : `${weather.precip} mm`}</strong>
          </div>
          <div className="weather-metric">
            <span>{isHistorical ? "UV (day avg)" : "UV"}</span>
            <strong className="weather-uv">
              {isHistorical ? (
                uvNow == null && weather.uvMax == null ? (
                  "Unavailable"
                ) : (
                  <>
                    <i data-level={(uvNowBand ?? uvMaxBand)?.level} aria-hidden="true" />
                    {uvNow != null ? Math.round(uvNow) : "—"}
                    {weather.uvMax != null &&
                    (uvNow == null || Math.round(uvNow) !== Math.round(weather.uvMax))
                      ? ` · max ${Math.round(weather.uvMax)}`
                      : ""}
                    {uvNowBand ? ` · ${uvNowBand.label}` : uvMaxBand ? ` · ${uvMaxBand.label}` : ""}
                  </>
                )
              ) : uvNow == null && weather.uvMax == null ? (
                "Unavailable"
              ) : (
                <>
                  <i data-level={(uvNowBand ?? uvMaxBand)?.level} aria-hidden="true" />
                  {uvNow != null ? `~${Math.round(uvNow)}` : "—"}
                  {weather.uvMax != null ? ` · max ${Math.round(weather.uvMax)}` : ""}
                  {uvNowBand ? ` · ${uvNowBand.label}` : uvMaxBand ? ` · ${uvMaxBand.label}` : ""}
                </>
              )}
            </strong>
          </div>
          <div className="weather-metric">
            <span>Sunrise</span>
            <strong>{localClock(weather.sunrise)}</strong>
          </div>
          <div className="weather-metric">
            <span>Sunset</span>
            <strong>{localClock(weather.sunset)}</strong>
          </div>
        </div>

        <section className="weather-suggestion" aria-labelledby={`${titleId}-suggestion`}>
          <span className="weather-suggestion-icon" aria-hidden="true">
            ✦
          </span>
          <div>
            <h3 id={`${titleId}-suggestion`}>{suggestion.headline}</h3>
            <p>{suggestion.body}</p>
          </div>
        </section>

        <footer className="weather-modal-footer">
          <p className="muted">
            Forecast by{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
