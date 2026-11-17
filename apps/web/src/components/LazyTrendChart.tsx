import { Suspense, lazy, type ComponentProps } from 'react';
import { Skeleton } from './ui';

const TrendChart = lazy(() => import('./TrendChart').then((m) => ({ default: m.TrendChart })));
const SessionTrendChart = lazy(() =>
  import('./TrendChart').then((m) => ({ default: m.SessionTrendChart })),
);

/** Recharts is large; load it only where a chart is shown. */
export function LazyTrendChart(props: ComponentProps<typeof TrendChart>) {
  return (
    <Suspense fallback={<Skeleton height={230} />}>
      <TrendChart {...props} />
    </Suspense>
  );
}

export function LazySessionTrendChart(props: ComponentProps<typeof SessionTrendChart>) {
  return (
    <Suspense fallback={<Skeleton height={230} />}>
      <SessionTrendChart {...props} />
    </Suspense>
  );
}
