// src/components/admin/MultiSwitch.jsx

export default function MultiSwitch({ label, options, value, onChange }) {
    const normalizedValue = String(value || '').trim().toLowerCase();

    return (
        <div className="flex items-center justify-between py-2 px-3 border-b border-gray-100 last:border-b-0">
            <span className="text-sm font-medium text-gray-700 capitalize">{label}</span>
            <div className="flex shrink-0 items-center rounded-lg bg-gray-200 p-0.5">
                {options.map(optionLabel => {
                    const normalizedOption = String(optionLabel || '').trim().toLowerCase();
                    const isActive = normalizedValue === normalizedOption;
                    const classes = `min-w-[3rem] px-3 py-0.5 text-center text-sm font-bold rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                        isActive 
                            ? 'bg-blue-600 text-white shadow-sm' 
                            : 'text-gray-600 hover:bg-gray-300'
                    }`;
                    return (
                        <button key={optionLabel} type="button" onClick={() => onChange(normalizedOption)} className={classes}>{optionLabel}</button>
                    );
                })}
            </div>
        </div>
    );
}
