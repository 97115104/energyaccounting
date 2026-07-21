/**
 * Public snapshot view: what a visitor sees when someone shares their
 * butterfly. Read-only, no authentication, rendered entirely from the frozen
 * payload behind the unguessable token. Expired and revoked links land on the
 * same calm message so a URL never reveals whether it once worked.
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Butterfly } from "../components/Butterfly";
import { IdentityMark } from "../components/IdentityMark";
import { ProfileSections } from "../components/ProfileSections";
import { api } from "../lib/api";
import { parseSharePayload, type SharePayload } from "../lib/identityShare";
import { archetypeMeta, symbolMeta } from "../lib/identity";
import { usePrefersReducedMotion } from "../lib/useButterflyDay";

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "gone">("loading");
  const prefersReduced = usePrefersReducedMotion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ payload: unknown }>(`/api/share/${token}`);
        if (cancelled) return;
        const parsed = parseSharePayload(res.payload);
        if (parsed) {
          setPayload(parsed);
          setStatus("ready");
        } else {
          setStatus("gone");
        }
      } catch {
        if (!cancelled) setStatus("gone");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "loading") {
    return (
      <div className="panel share-card">
        <p className="muted">Opening…</p>
      </div>
    );
  }
  if (status === "gone" || !payload) {
    return (
      <div className="panel share-card">
        <h2>This share link is no longer available.</h2>
        <p className="muted">
          The person who created it may have let it expire or taken it back. That choice is
          theirs to make.
        </p>
      </div>
    );
  }

  const { identity } = payload;
  // A shared butterfly beats gently and steadily; the live daily tempo stays
  // private to its person.
  const beat = identity.motion === "still" || prefersReduced ? null : 2200;

  return (
    <div className="panel share-card">
      <div className="share-hero">
        <Butterfly
          identity={identity}
          beatMs={beat}
          size={200}
          title={
            payload.name
              ? `${payload.name}'s butterfly, ${archetypeMeta(identity.archetype).label.toLowerCase()} base`
              : "A shared butterfly"
          }
        />
        <h2>{payload.name ? `${payload.name}'s butterfly` : "A shared butterfly"}</h2>
        <p className="muted share-mark-line">
          <IdentityMark identity={identity} size={28} decorative />
          <span>
            {symbolMeta(identity.symbol).label} · {archetypeMeta(identity.archetype).label}
          </span>
        </p>
      </div>
      <ProfileSections
        variant="share"
        palette={identity.palette}
        name={payload.name}
        about={payload.about}
        communication={payload.communication}
        support={payload.support}
        traits={payload.traits}
        colorMeanings={payload.colorMeanings}
      />
      <p className="muted share-foot">
        Shared with EAJ, an energy accounting journal for neurodivergent people. The butterfly
        is a symbol of becoming; every one is unique to its person.
      </p>
    </div>
  );
}
