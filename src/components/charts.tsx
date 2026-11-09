import type { TooltipContentProps } from 'recharts';

/**
 * Shared Recharts tooltip. Recharts passes `active`, `payload` and `label`;
 * we render a compact card that matches the app surface.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: Partial<TooltipContentProps<number, string>> & {
  formatter?: (value: number, name?: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-lg">
      {label ? (
        <p className="mb-1 text-[11.5px] font-medium text-muted">{String(label)}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, index) => {
          const raw = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
          const text = formatter
            ? formatter(raw, String(entry.name ?? ''))
            : raw.toLocaleString();
          return (
            <li key={`${entry.name}-${index}`} className="flex items-center gap-2 text-[12px]">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color ?? 'var(--pl-primary)' }}
              />
              <span className="text-text-soft">{String(entry.name ?? '')}</span>
              <span className="pl-tabular ml-auto font-semibold text-text">{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
