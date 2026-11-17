import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SessionTrendPointDto, TrendPointDto } from '@recall/shared';

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

/* ---------- Score by session ---------- */

const dateTime = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

interface SessionRow {
  n: number;
  point: SessionTrendPointDto;
  practicePct: number | null;
  examPct: number | null;
  practiceAvg: number | null;
  examAvg: number | null;
}

function SessionTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: SessionRow }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const p = row.point;
  return (
    <div className="chart-tip">
      <strong>
        #{row.n} · {p.mode === 'exam' ? 'Exam' : 'Practice'}
      </strong>
      <div style={{ maxWidth: 240, overflowWrap: 'anywhere' }}>{p.title}</div>
      <div>{dateTime.format(new Date(p.submittedAt))}</div>
      <div>
        Score: {p.percent ?? '—'}% ({p.correct}/{p.total})
      </div>
      <div>
        Rolling ({p.rollingSessions} {p.mode} session{p.rollingSessions === 1 ? '' : 's'}):{' '}
        {p.rollingPercent ?? '—'}%
      </div>
    </div>
  );
}

/**
 * One dot per completed session in order (so ten sessions in a day are ten points), plus a
 * rolling line per mode that pools the last few sessions' correct/total.
 */
export function SessionTrendChart({
  points,
  window = 5,
}: {
  points: SessionTrendPointDto[];
  window?: number;
}) {
  if (points.length === 0) {
    return (
      <div className="chart-empty">
        <div>
          <strong>No completed sessions yet</strong>
          <div className="small">
            Finish a practice session or exam and its score appears here as a point.
          </div>
        </div>
      </div>
    );
  }
  const data: SessionRow[] = points.map((p, i) => ({
    n: i + 1,
    point: p,
    practicePct: p.mode === 'practice' ? p.percent : null,
    examPct: p.mode === 'exam' ? p.percent : null,
    practiceAvg: p.mode === 'practice' ? p.rollingPercent : null,
    examAvg: p.mode === 'exam' ? p.rollingPercent : null,
  }));
  const hasPractice = points.some((p) => p.mode === 'practice');
  const hasExam = points.some((p) => p.mode === 'exam');
  const describe = (mode: 'practice' | 'exam') => {
    const list = points.filter((p) => p.mode === mode);
    if (!list.length) return null;
    const first = list[0];
    const last = list[list.length - 1];
    return list.length === 1
      ? `${mode}: one session, ${last?.percent}%`
      : `${mode}: ${list.length} sessions, rolling score from ${first?.rollingPercent}% to ${last?.rollingPercent}%`;
  };
  const summary = [describe('practice'), describe('exam')].filter(Boolean).join('; ');
  const raw = (color: string) => ({
    r: 4,
    fill: color,
    stroke: 'var(--surface)',
    strokeWidth: 1.5,
  });
  return (
    <figure style={{ margin: 0 }}>
      <div className="chart-box" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="n"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickFormatter={(n: number) => `#${n}`}
              padding={{ left: 14, right: 14 }}
              tickLine={false}
              axisLine={false}
              minTickGap={14}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              unit="%"
            />
            <Tooltip content={<SessionTip />} />
            {hasPractice && (
              <Line
                type="monotone"
                dataKey="practiceAvg"
                stroke="var(--accent)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {hasExam && (
              <Line
                type="monotone"
                dataKey="examAvg"
                stroke="var(--positive)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {hasPractice && (
              <Line
                dataKey="practicePct"
                stroke="none"
                dot={raw('var(--accent)')}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {hasExam && (
              <Line
                dataKey="examPct"
                stroke="none"
                dot={raw('var(--positive)')}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="legend" style={{ marginTop: 6 }}>
        {hasPractice && (
          <span>
            <i style={{ background: 'var(--accent)' }} />
            Practice
          </span>
        )}
        {hasExam && (
          <span>
            <i style={{ background: 'var(--positive)' }} />
            Exam
          </span>
        )}
        <span>
          Dots = single sessions · line = pooled score of the last {window} sessions of that mode
        </span>
        <span className="sr-only">{summary}</span>
      </figcaption>
      {points.length < 3 && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          A trend needs a few sessions — complete {3 - points.length} more to see a direction.
        </p>
      )}
    </figure>
  );
}
