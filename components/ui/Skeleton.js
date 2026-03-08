// components/ui/Skeleton.js
// Shared skeleton loader components for loading states across all pages.
//
// Named exports:
//   SkeletonBar   — a single rectangular loading shimmer bar
//   SkeletonCard  — a card-shaped block with a few internal shimmer bars
//   SkeletonTable — N rows × M columns of shimmer cells inside a table tbody
//
// Requires the `.skeleton` utility class and `@keyframes pulse` in globals.css.
// (Added in the Batch 4 globals.css patch.)

/**
 * A single shimmer bar.
 * @param {{ h?: number|string, w?: number|string, radius?: number }} props
 */
export function SkeletonBar({ h = 14, w = '100%', radius = 6 }) {
  return (
    <div
      className="skeleton"
      style={{ height: h, width: w, borderRadius: radius }}
    />
  );
}

/**
 * A card-shaped skeleton with 3 stacked shimmer bars.
 * @param {{ padding?: number, lines?: number }} props
 */
export function SkeletonCard({ padding = 20, lines = 3 }) {
  return (
    <div className="card" style={{ padding }}>
      <SkeletonBar h={14} w="55%" />
      {lines >= 2 && <SkeletonBar h={30} w="45%" radius={4} />}
      {lines >= 3 && <SkeletonBar h={6} radius={3} />}
    </div>
  );
}

/**
 * N rows of skeleton cells inside a `<tbody>`.
 * Use inside an existing `<table>` / `<tbody>`.
 *
 * @param {{ cols?: number, rows?: number }} props
 */
export function SkeletonTable({ cols = 5, rows = 4 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j}>
          <SkeletonBar h={13} w={j === 0 ? '80%' : '60%'} />
        </td>
      ))}
    </tr>
  ));
}

// Default export for convenience when you only need SkeletonBar
export default SkeletonBar;
