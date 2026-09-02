import { quotaColor } from "@/lib/colors";

/** 180° arc meter: green < 60 %, amber 60–85 %, red ≥ 85 %, always with a text label. */
export function QuotaGauge({ usedPercent }: { usedPercent: number }) {
  const clamped = Math.max(0, Math.min(100, usedPercent));
  const label = `${Math.round(clamped)}%`;
  const color = quotaColor(usedPercent);
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`Weekly quota used: ${label}`}>
      <svg viewBox="0 0 200 110" className="w-full max-w-56" aria-hidden="true">
        <path d="M 15 100 A 85 85 0 0 1 185 100" fill="none" stroke="var(--muted)" strokeWidth={14} strokeLinecap="round" />
        <path
          data-testid="gauge-fill"
          d="M 15 100 A 85 85 0 0 1 185 100"
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${clamped} 100`}
        />
      </svg>
      <div className="-mt-10 text-center">
        <div className="text-3xl font-semibold leading-none">{label}</div>
        <div className="text-xs text-muted-foreground">of weekly quota used</div>
      </div>
    </div>
  );
}
