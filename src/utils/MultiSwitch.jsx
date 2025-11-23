// src/components/admin/MultiSwitch.jsx

export default function MultiSwitch({ label, options, value, onChange }) {
    return (
        <div className="flex items-center justify-between py-2 px-3 border-b border-gray-100 last:border-b-0">
            <span className="text-sm font-medium text-gray-700 capitalize">{label}</span>
            <div className="flex items-center rounded-lg bg-gray-200 p-0.5">
                {options.map(optionLabel => {
                    const isActive = value === optionLabel.toLowerCase();
                    const classes = `px-3 py-0.5 text-sm font-bold rounded-md transition-colors ${
                        isActive 
                            ? 'bg-blue-600 text-white shadow-sm' 
                            : 'text-gray-600 hover:bg-gray-300'
                    }`;
                    return (
                        <button key={optionLabel} type="button" onClick={() => onChange(optionLabel.toLowerCase())} className={classes}>{optionLabel}</button>
                    );
                })}
            </div>
        </div>
    );
}