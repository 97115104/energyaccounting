/** A memory-only generation token for decrypted personal-data snapshots. */
let generation = 0;

export function personalDataGeneration(): number {
  return generation;
}

export function invalidatePersonalData(): void {
  generation += 1;
}
