import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendPointDto } from '@recall/shared';

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function label(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return shortDate.format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1));
}

interface TipProps {
  active?: boolean;
  payload?: { payload: TrendPointDto }[];
}

function Tip({ active, payload }: TipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const line = (name: string, s: TrendPointDto['practice']) =>
    s.total ? `${name}: ${s.percent}% (${s.correct}/${s.total})` : `${name}: no answers`;
  return (
    <div className="chart-tip">
      <strong>{label(point.date)}</strong>
      <div>{line('Practice', point.practice)}</div>
      <div>{line('Exam', point.exam)}</div>
    </div>
  );
}

/**
 * Accuracy trend. Buckets with no answers are gaps (null), never drawn as 0%.
 * A text summary is provided for screen readers.
 */
export function TrendChart({
  points,
  showExam = true,
}: {
  points: TrendPointDto[];
  showExam?: boolean;
}) {
  const withData = points.filter((p) => p.practice.total || (showExam && p.exam.total));
  if (withData.length === 0) {
    return (
      <div className="chart-empty">
        <div>
          <strong>No answers in this period yet</strong>
          <div className="small">
            The trend appears once you answer questions — empty days are left blank, not shown as
            0%.
          </div>
        </div>
      </div>
    );
  }
  const data = points.map((p) => ({
    ...p,
    practicePct: p.practice.percent,
    examPct: p.exam.percent,
    label: label(p.date),
  }));
  const practiceTotal = points.reduce((n, p) => n + p.practice.total, 0);
  const practiceCorrect = points.reduce((n, p) => n + p.practice.correct, 0);
  const examTotal = points.reduce((n, p) => n + p.exam.total, 0);
  const examCorrect = points.reduce((n, p) => n + p.exam.correct, 0);
  const summary = [
    practiceTotal
      ? `Practice: ${Math.round((practiceCorrect / practiceTotal) * 100)}% of ${practiceTotal} answers`
      : 'No practice answers',
    showExam
      ? examTotal
        ? `exam: ${Math.round((examCorrect / examTotal) * 100)}% of ${examTotal} answers`
        : 'no exam answers'
      : null,
    `active on ${withData.length} of ${points.length} periods.`,
  ]
    .filter(Boolean)
    .join('; ');
  return (
    <figure style={{ margin: 0 }}>
      <div className="chart-box" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={18}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip content={<Tip />} />
            <Line
              type="monotone"
              dataKey="practicePct"
              name="Practice"
              stroke="var(--accent)"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {showExam && (
              <Line
                type="monotone"
                dataKey="examPct"
                name="Exam"
                stroke="var(--positive)"
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="legend" style={{ marginTop: 6 }}>
        <span>
          <i style={{ background: 'var(--accent)' }} />
          Practice accuracy
        </span>
        {showExam && (
          <span>
            <i style={{ background: 'var(--positive)' }} />
            Exam accuracy
          </span>
        )}
        <span className="sr-only">{summary}</span>
      </figcaption>
    </figure>
  );
}
