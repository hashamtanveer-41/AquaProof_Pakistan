import type { ReactNode } from "react";
import { ArrowRight, Droplet, Sprout } from "lucide-react";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Droplet size={27} strokeWidth={1.65} />
        <Sprout size={12} strokeWidth={2.1} className="brand-sprout" />
      </span>
      <span>
        <strong>
          AquaProof <em>Pakistan</em>
        </strong>
        <small>AGRICULTURAL INTELLIGENCE</small>
      </span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "outline",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`button ${variant}`}>
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone = "green",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`chip ${tone}`}>
      {dot && <i />}
      {children}
    </span>
  );
}

export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Stat({
  icon,
  value,
  label,
  note,
  tone = "",
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="stat card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {note && <div className="stat-note">{note}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card surface ${className}`}>
      {title && (
        <header className="section-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="stat-icon">
        <Sprout size={21} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="details">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TextAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-action" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}

export function LineChart({
  data,
  secondary,
  labels,
  unit = "",
  color = "#168556",
}: {
  data: number[];
  secondary?: number[];
  labels: string[];
  unit?: string;
  color?: string;
}) {
  const max = Math.ceil(Math.max(...data, ...(secondary ?? []), 1) / 10) * 10;
  const x = (i: number) => 42 + (i * 526) / Math.max(data.length - 1, 1);
  const y = (v: number) => 146 - (v / max) * 124;
  const line = (values: number[]) => values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg
      className="chart"
      viewBox="0 0 607 184"
      role="img"
      aria-label={`Line graph: ${data.map((v, i) => `${labels[i]} ${v}${unit}`).join(", ")}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((n) => (
        <g key={n}>
          <line
            x1="40"
            x2="569"
            y1={y(max * n)}
            y2={y(max * n)}
            stroke="#e8eeeb"
            strokeDasharray="4 4"
          />
          <text x="33" y={y(max * n) + 4} textAnchor="end">
            {Math.round(max * n)}
            {unit}
          </text>
        </g>
      ))}
      <polygon
        points={`42,146 ${line(data)} ${x(data.length - 1)},146`}
        fill={color}
        opacity=".09"
      />
      {secondary && (
        <polyline
          points={line(secondary)}
          fill="none"
          stroke="#d99230"
          strokeWidth="2"
          strokeDasharray="5 5"
          strokeLinejoin="round"
        />
      )}
      <polyline
        points={line(data)}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {data.map((value, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(value)} r="4" fill="white" stroke={color} strokeWidth="2">
            <title>
              {labels[i]}: {value}
              {unit}
              {secondary ? ` · Alternative: ${secondary[i]}${unit}` : ""}
            </title>
          </circle>
          <text x={x(i)} y="170" textAnchor="middle">
            {labels[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}
