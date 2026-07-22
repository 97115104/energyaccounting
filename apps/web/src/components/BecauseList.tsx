/** Evidence lines: no bullet for a single reason; a list only when there are several. */

type BecauseListProps = {
  reasons: string[];
  className?: string;
};

export function BecauseList({ reasons, className }: BecauseListProps) {
  if (reasons.length === 0) return null;
  if (reasons.length === 1) {
    return <p className={className}>{reasons[0]}</p>;
  }
  return (
    <ul className={className}>
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}
