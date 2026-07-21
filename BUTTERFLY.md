# The Butterfly

EAJ's identity system: one living mark per person, grown from their own days.

## Why a butterfly

The butterfly is the app's symbol of becoming: change that looks like struggle
from the inside. It draws on Jean-Dominique Bauby's *The Diving Bell and the
Butterfly*, where a mind stayed vivid inside a body that could barely speak.
Many neurodivergent people know a version of that bandwidth gap, thinking far
faster than any channel can carry. The butterfly holds both truths at once:
locked in, and becoming.

## The pieces

- **Butterfly** ([apps/web/src/components/Butterfly.tsx](apps/web/src/components/Butterfly.tsx)):
  one SVG body plan that composes flat render layers produced by the wing
  grammar. The component holds no shape logic, so onboarding previews, the You
  hero, exports, and the compact seal all share it.
- **Wing grammar** ([apps/web/src/lib/butterflyGeometry.ts](apps/web/src/lib/butterflyGeometry.ts)):
  eight wing families (monarch, morpho, swallowtail, glasswing, longwing, owl,
  sulphur, peacock) crossed with independent traits, so identity comes from
  combination rather than a fixed menu:
  - **edge**: smooth, scalloped, angular
  - **tail**: none, short, long, twin
  - **pattern**: veined, banded, spotted, eyespots, clear panels
  - **complexity**: 0 to 4, visual richness only and never a measure of the
    person. `compatibleTraits` keeps combinations plausible per family (for
    example, glasswing has no tails or eyespots), and `normalizeWing` repairs
    anything out of range. A three-color palette and deterministic per-person
    variation from a seed finish the look, so the same identity draws the same
    butterfly on every device.
- **NeuroMe seal** ([apps/web/src/components/IdentityMark.tsx](apps/web/src/components/IdentityMark.tsx)):
  the compact circular mark used on the header and welcome surfaces. It wraps
  the person's chosen symbol in a vitality ring showing today's remaining
  energy.
- **Identity symbols**: butterfly, rainbow infinity, gold infinity, and rainbow
  pride. The puzzle piece is deliberately not offered, because many autistic
  self-advocates decline it. Inside the app, the You experience is always the
  butterfly.
- **Daily state** ([apps/web/src/lib/butterflyState.ts](apps/web/src/lib/butterflyState.ts)):
  a pure mapping from the day's plaintext numbers to one of five poses
  (resting, steady, lively, recovering, spent). Each pose carries a text label
  and concrete "because" evidence, so color and motion are never the only
  signal. The pose sets the wing-beat tempo.
- **Traits** ([apps/web/src/lib/butterflyTraits.ts](apps/web/src/lib/butterflyTraits.ts)):
  on-device suggestions from the decrypted catalog and numeric history. Every
  suggestion explains its evidence and the person accepts, edits, or dismisses
  it. Nothing is ever applied silently.
- **You profile** ([apps/web/src/lib/youProfile.ts](apps/web/src/lib/youProfile.ts)):
  about, communication, support notes, accepted traits, and personal color
  meanings, encrypted client-side under the person's DEK like journal text.
- **How-to-work-with-me drafting** ([apps/web/src/lib/youDraft.ts](apps/web/src/lib/youDraft.ts)):
  a pure, on-device drafter over the decrypted personal-data model
  ([apps/web/src/lib/personalData.ts](apps/web/src/lib/personalData.ts)). It
  turns recurring givers, hard tasks, draining weekdays, and reflective habits
  into evidence-backed draft lines the person can add, edit in their own voice,
  or dismiss. Drafting can be turned off entirely to write from scratch.
- **Dictation** ([apps/web/src/lib/useDictation.ts](apps/web/src/lib/useDictation.ts),
  [apps/web/src/components/DictatableField.tsx](apps/web/src/components/DictatableField.tsx)):
  one Web Speech capability behind every free-text field. Typing is hard
  sometimes, so any field can be spoken; only one microphone is live at a time.

## Privacy boundaries

Three tiers, from most open to most protected:

1. **Identity config** (symbol, wing family and traits, palette, seed, motion)
   is render-only and stored as plaintext JSON on the user row, allowlisted by
   [apps/server/src/lib/identity.ts](apps/server/src/lib/identity.ts) so it can
   never carry a covert channel. It is also cached locally
   ([apps/web/src/lib/identityCache.ts](apps/web/src/lib/identityCache.ts)) so
   the full sign-in screen can welcome a returning person before anything
   decrypts.
2. **Daily numbers** stay plaintext as they always have; the butterfly state is
   computed from them on the device.
3. **You profile content** crosses the wire only as AES-GCM ciphertext. The
   server cannot read it.

Sharing is the deliberate exception: the person decrypts locally, picks
sections, and only that chosen plaintext is frozen into a snapshot.

## Sharing

- **Local files**: SVG and high-resolution PNG of the butterfly, for avatars
  and posts, plus a print-quality profile document via the browser's print
  dialog (save as PDF).
- **Public links**: unguessable tokens (32 random bytes, hash-only storage)
  with bounded lifetimes (1, 30, or 90 days) by default, plus an explicit
  permanent-until-revoked option. Revocation deletes the frozen payload.
  Expired and revoked links return the same calm message.

## Motion and accessibility

Wing tempo follows the daily state, but the person's own motion setting (follow
my day, calm, still) and the OS `prefers-reduced-motion` setting always win.
When motion is off the pose is still readable through its label and vitality
ring. Every state carries text; the seal exposes a full `aria-label`.

## Deletion

Settings has a full profile deletion behind password (plus TOTP when enabled)
and a typed confirmation, with a last-chance data export in the same dialog.
One user-row delete cascades through days, tasks, catalog, sessions, the You
profile, and every share snapshot.

## Toward a personal machine intelligence

The exported corpus now carries the identity config and decrypted You profile
alongside days and catalog, so a future personal model can learn how its person
works as well as what they did. The trait suggester and the how-to-work-with-me
drafter are the first, deliberately transparent steps: both read only the
on-device personal-data model, everything they believe is visible with its
evidence, and every line is the person's to accept, edit, or dismiss.
