import { Suspense, lazy, type ComponentProps } from 'react';
import { Skeleton } from './ui';

const TrendChart = lazy(() => import('./TrendChart').then((m) => ({ default: m.TrendChart })));

/** Recharts is large; load it only where a chart is shown. */
export function LazyTrendChart(props: ComponentProps<typeof TrendChart>) {
  return (
    <Suspense fallback={<Skeleton height={230} />}>
      <TrendChart {...props} />
    </Suspense>
  );
}
