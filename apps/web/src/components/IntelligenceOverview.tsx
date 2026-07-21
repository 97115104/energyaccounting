import type {
  IntelligenceLine,
  PersonalIntelligence,
} from "../lib/personalIntelligence";

function LearnedLine({ line }: { line: IntelligenceLine }) {
  return (
    <li className="intel-line">
      <p>
        {line.text}
        {line.confidence === "emerging" && (
          <span className="intel-confidence">Emerging pattern</span>
        )}
      </p>
      <details>
        <summary>Why this?</summary>
        <ul className="muted">
          {line.because.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export type IntelligenceStatus = "loading" | "ready" | "error";

export function IntelligenceOverview({
  intelligence,
  status,
}: {
  intelligence: PersonalIntelligence | null;
  status: IntelligenceStatus;
}) {
  const learned = intelligence?.overview ?? [];
  const meaning = intelligence?.energyMeaning ?? [];
  const closedDays = intelligence?.coverage.closedDays ?? 0;

  return (
    <section className="panel you-section intel-panel" aria-labelledby="you-intel-title">
      <div className="intel-heading">
        <div>
          <p className="intel-eyebrow">Private to you</p>
          <h3 id="you-intel-title">Your energy intelligence</h3>
        </div>
        {status === "ready" && closedDays > 0 && (
          <span className="intel-coverage">Based on {closedDays} closed days</span>
        )}
      </div>
      <p className="muted">
        Built on this device from the days you already live and log. It stays private unless
        you choose to share it.
      </p>

      {status === "loading" && (
        <p className="intel-empty muted" aria-live="polite">
          Reading your history on this device…
        </p>
      )}
      {status === "error" && (
        <p className="intel-empty" role="status">
          Could not read your encrypted history right now. Unlock your journal key and reopen
          You to try again.
        </p>
      )}
      {status === "ready" && learned.length > 0 && (
        <ul className="intel-lines">
          {learned.map((line) => (
            <LearnedLine key={line.id} line={line} />
          ))}
        </ul>
      )}
      {status === "ready" && learned.length === 0 && (
        <p className="intel-empty">
          Keep closing days. As your history grows, this will reflect what tends to restore you,
          what costs energy, and when your rhythm changes.
        </p>
      )}

      <div className="intel-meaning">
        <h4>What your energy levels mean</h4>
        {status === "ready" && meaning.length > 0 ? (
          <ul className="intel-lines intel-lines-compact">
            {meaning.map((line) => (
              <LearnedLine key={line.id} line={line} />
            ))}
          </ul>
        ) : status === "ready" ? (
          <p className="muted">
            Every day begins with 100 points. After five closed days, you will also see what a
            typical day means for you, and not someone else&apos;s average.
          </p>
        ) : (
          <p className="muted">Personal calibration appears once your history can be read.</p>
        )}
      </div>
    </section>
  );
}
