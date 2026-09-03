/** Inline SVG, because a menu bar card must not wait on (or reach for) an icon font. */

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function RefreshIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path {...stroke} d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path {...stroke} d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export function SettingsIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle {...stroke} cx="8" cy="8" r="2.2" />
      <path
        {...stroke}
        d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
      />
    </svg>
  );
}

export function ExternalIcon(): React.ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
      <path {...stroke} d="M6.5 3H3v10h10V9.5" />
      <path {...stroke} d="M9.5 2.5h4v4M13.5 2.5 7 9" />
    </svg>
  );
}

export function CloseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path {...stroke} d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
