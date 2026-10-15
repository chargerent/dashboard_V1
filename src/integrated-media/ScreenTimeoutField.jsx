import {SCREEN_TIMEOUT_DEFAULT_SECONDS,SCREEN_TIMEOUT_MIN_SECONDS,SCREEN_TIMEOUT_MAX_SECONDS} from './stripeUi.js';

export default function ScreenTimeoutField({value=SCREEN_TIMEOUT_DEFAULT_SECONDS,onChange,disabled=false}) {
  return <label className="block h-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
    <span className="flex items-center justify-between gap-4 font-semibold"><span>Screen timeout</span><output aria-label="Selected screen timeout">{value} seconds</output></span>
    <input type="range" aria-label="Screen timeout" min={SCREEN_TIMEOUT_MIN_SECONDS} max={SCREEN_TIMEOUT_MAX_SECONDS} step={5} value={value} disabled={disabled}
      onChange={event=>onChange?.(Number(event.target.value))} className="mt-3 w-full accent-cyan-700 disabled:opacity-50"/>
    <span className="mt-1 flex justify-between text-xs text-slate-500"><span>10 seconds</span><span>120 seconds</span></span>
    <span className="mt-2 block text-xs leading-5 text-slate-500">Inactive screens return to Start after this time. Touching the screen restarts the timer. Payment screens wait at least 45 seconds, and active payments or releases finish safely.</span>
  </label>;
}
