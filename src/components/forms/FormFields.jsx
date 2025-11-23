// src/components/forms/FormFields.jsx

export const FormInput = ({ label, name, value, section, type = "text", onDataChange, disabled = false, isInvalid = false, errorMessage = null }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <input
            type={type}
            name={name}
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => {
                const val = type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
                onDataChange(section, name, val);
            }}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:text-gray-500 ${isInvalid ? 'border-red-500' : 'border-gray-300'}`}
        />
        {isInvalid && errorMessage && (
            <p className="mt-1 text-xs text-red-600">{errorMessage}</p>
        )}
    </div>
);

export const FormToggle = ({ label, name, checked, section, onDataChange }) => (
    <div className="flex items-center justify-between">
        <span className="block text-sm font-medium text-gray-700">{label}</span>
        <label htmlFor={name} className="relative inline-flex items-center cursor-pointer">
            <input
                type="checkbox"
                id={name}
                name={name}
                className="sr-only"
                checked={checked || false}
                onChange={e => onDataChange(section, name, e.target.checked)}
            />
            <div className={`block w-10 h-6 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
            <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`}></div>
        </label>
    </div>
);

export const FormMultiSwitch = ({ label, name, options, value, section, onDataChange, isInvalid = false }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <div className={`flex flex-wrap gap-2 ${isInvalid ? 'p-1 border border-red-500 rounded-md' : ''}`}>
            {options.map((option) => (
                <button
                    key={option}
                    type="button"
                    onClick={() => onDataChange(section, name, option)}
                    className={`px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm
                        ${value === option ? 'bg-blue-600 text-white z-10' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                    {option}
                </button>
            ))}
        </div>
    </div>
);

export const FormSlider = ({ label, name, value, section, min, max, onDataChange }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label} - <span className="font-bold">{value}%</span></label>
        <input
            type="range"
            min={min}
            max={max}
            value={value || 0}
            name={name}
            onChange={(e) => onDataChange(section, name, e.target.value)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
    </div>
);

export const FormSelect = ({ label, name, value, section, options, onDataChange, isInvalid = false }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <select
            name={name}
            value={options.find(opt => opt.startsWith(value + ' ')) || value || ''}
            onChange={(e) => onDataChange(section, name, e.target.value)}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${isInvalid ? 'border-red-500' : 'border-gray-300'}`}
        >
            {options.map(option => {
                const displayValue = option.split(' ')[0];
                return (
                    <option key={option} value={option}>{option.replace(displayValue, displayValue)}</option>
                );
            })}
        </select>
    </div>
);

export const FormColorPicker = ({ label, name, value, section, onDataChange, isInvalid = false }) => (
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <div className="flex items-center gap-3">
            <div className="relative h-10 w-10 rounded-md border border-gray-300 overflow-hidden">
                <div className="w-full h-full" style={{ backgroundColor: value || '#ffffff' }}></div>
                <input
                    type="color"
                    value={value || '#ffffff'}
                    onChange={(e) => onDataChange(section, name, e.target.value.toUpperCase(), false)}
                    className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                />
            </div>
            <input
                type="text"
                name={name}
                value={value || ''}
                onChange={(e) => onDataChange(section, name, e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${isInvalid ? 'border-red-500' : 'border-gray-300'}`}
            />
        </div>
    </div>
);
