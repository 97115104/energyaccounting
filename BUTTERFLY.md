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
  one SVG body plan with three archetypes (swallowtail, monarch, morpho),
  a three-color palette, and deterministic per-person wing variation derived
  from a seed. The same identity draws the same butterfly on every device.
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

## Privacy boundaries

Three tiers, from most open to most protected:

1. **Identity config** (symbol, archetype, palette, seed, motion) is
   render-only and stored as plaintext JSON on the user row, so the sign-in
   screen can welcome a returning person before anything decrypts.
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
  with bounded lifetimes (1, 30, or 90 days), revocable at any time. Revocation
  deletes the frozen payload. Expired and revoked links return the same calm
  message.

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
works as well as what they did. The trait suggester is the first, deliberately
transparent step: everything it believes is visible, explained, and correctable
on the You page.
