export default function DeviceManagementIcon({ className = 'h-6 w-6' }) {
  return (
    <svg
      viewBox="0 0 28 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.5" y="4" width="10" height="12" rx="1.5" />
      <path d="M4.25 20h4.5M6.5 16v4" />
      <path d="M14.25 2.5v19" opacity="0.45" />
      <rect x="17" y="2.5" width="9.5" height="19" rx="1.75" />
      <path d="M20.5 18.75h2.5" />
    </svg>
  );
}
