/** Map in input order while bounding concurrent work (crypto/network safe). */
export async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Concurrency limit must be at least one.");
  const output = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}
