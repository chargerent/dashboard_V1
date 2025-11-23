// src/components/Dashboard/FilterPanel.jsx

const FilterButton = ({ filterKey, isActive, onClick, children, className = '' }) => (
    <button
        onClick={() => onClick(filterKey)}
        className={`relative px-4 py-2 text-sm font-bold rounded-md shadow-sm transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border'} ${className}`}
    >
        {children}
    </button>
);

const DisneyIcon = () => (
    <svg xmlnsXlink="http://www.w3.org/1999/xlink" width="26" height="26" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
        <g fill="currentColor">
            <path d="M30.857,21.884C33.841,21.295,36,17.669,36,12.978c0-5.131-2.58-9-6-9s-6,3.869-6,9c0,3.034,0.907,5.619,2.351,7.232
		c-0.766-0.141-1.549-0.232-2.352-0.232c-0.803,0-1.585,0.091-2.351,0.232C23.093,18.597,24,16.012,24,12.978c0-5.131-2.58-9-6-9
		s-6,3.869-6,9c0,4.691,2.159,8.317,5.142,8.906C12.882,24.362,10,28.862,10,32.978c0,5.54,5.218,8.452,12,8.924v-5.924h-2v-4h8v4
		h-2v5.924c6.782-0.471,12-3.384,12-8.924C38,28.862,35.118,24.362,30.857,21.884z M30,7.978c0.581,0,2,1.752,2,5s-1.419,5-2,5
		s-2-1.752-2-5S29.419,7.978,30,7.978z M18,7.978c0.581,0,2,1.752,2,5s-1.419,5-2,5s-2-1.752-2-5S17.419,7.978,18,7.978z M18,30.978
		c-1.105,0-2-0.895-2-2c0-1.104,0.895-2,2-2c1.105,0,2,0.896,2,2C20,30.082,19.104,30.978,18,30.978z M30,30.978
		c-1.105,0-2-0.895-2-2c0-1.104,0.895-2,2-2c1.105,0,2,0.896,2,2C32,30.082,31.104,30.978,30,30.978z" />
        </g>
    </svg>
);

export default function FilterPanel({ activeFilters, onFilterChange, showActiveOnly, onShowActiveOnlyChange, searchTerm, onSearchChange, offlineCount, soldOutCount, disconnectedCount, clientInfo, t }) {
    return (
        <div className="bg-white p-4 rounded-lg shadow-md mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> {/* Removed "filter by:" title */}
                <div className="flex flex-wrap items-center gap-2"> {/* Adjusted spacing for badge */}
                    {clientInfo.username === 'chargerent' && (
                        <>
                            <FilterButton filterKey="master" isActive={activeFilters.master} onClick={onFilterChange} className={activeFilters.master ? 'bg-purple-600 text-white' : 'hover:bg-purple-100'}>MA</FilterButton>
                            {clientInfo.username === 'chargerent' && (
                                <FilterButton filterKey="disney" isActive={activeFilters.disney} onClick={onFilterChange} className={activeFilters.disney ? 'bg-yellow-500 text-white' : 'hover:bg-yellow-100'}>
                                    <DisneyIcon />
                                </FilterButton>
                            )}
                            <div className="h-6 border-l border-gray-300 mx-2"></div>
                        </>
                    )}
                    <FilterButton filterKey="all" isActive={activeFilters.all} onClick={onFilterChange}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.5 7.5 7.5 7.5h5c1 0 1.012-1.77 1.256-2.179a6.006 6.006 0 011.912 2.706c-.244.41-1.256 2.179-1.256 2.179h-5c-1 0-1.012-1.77-1.256-2.179zM12.5 10a2.5 2.5 0 10-5 0 2.5 2.5 0 005 0z" clipRule="evenodd" />
                        </svg>
                    </FilterButton>
                    <FilterButton filterKey="ca" isActive={activeFilters.ca} onClick={onFilterChange}>CA</FilterButton>
                    <FilterButton filterKey="us" isActive={activeFilters.us} onClick={onFilterChange}>{t('us')}</FilterButton>
                    <FilterButton filterKey="fr" isActive={activeFilters.fr} onClick={onFilterChange}>FR</FilterButton>
                    <div className="h-6 border-l border-gray-300 mx-2"></div>
                    <FilterButton filterKey="offline" isActive={activeFilters.offline} onClick={onFilterChange}>
                        <div className="flex items-center">
                            <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 16 16">
                                <path d="m2,1c-0.55,0 -1,0.45 -1,1l0,12c0,0.55 0.45,1 1,1l1,0c0.55,0 1,-0.45 1,-1l0,-12c0,-0.55 -0.45,-1 -1,-1l-1,0zm4,3c-0.55,0 -1,0.45 -1,1l0,9c0,0.55 0.45,1 1,1l1,0c0.55,0 1,-0.45 1,-1l0,-9c0,-0.55 -0.45,-1 -1,-1l-1,0zm4,3c-0.55,0 -1,0.45 -1,1l0,6c0,0.15 0.04,0.29 0.09,0.42c0.09,-0.31 0.26,-0.6 0.5,-0.83l0.58,-0.59l-0.58,-0.59c-0.78,-0.77 -0.78,-2.05 0,-2.82c0.37,-0.38 0.88,-0.59 1.41,-0.59c0.36,0 0.7,0.1 1,0.27l0,-1.27c0,-0.55 -0.45,-1 -1,-1l-1,0zm6,5.83l-0.17,0.17l0.17,0.17l0,-0.34zm0,0" fillOpacity="0.35" />
                                <path d="m11,10c-0.27,0 -0.52,0.11 -0.71,0.29c-0.39,0.39 -0.39,1.03 0,1.42l1.3,1.29l-1.3,1.29c-0.39,0.39 -0.39,1.03 0,1.42s1.03,0.39 1.42,0l1.29,-1.3l1.29,1.3c0.39,0.39 1.03,0.39 1.42,0s0.39,-1.03 0,-1.42l-1.3,-1.29l1.3,-1.29c0.39,-0.39 0.39,-1.03 0,-1.42c-0.19,-0.18 -0.44,-0.29 -0.71,-0.29s-0.52,0.11 -0.71,0.29l-1.29,1.3l-1.29,-1.3c-0.19,-0.18 -0.44,-0.29 -0.71,-0.29zm0,0" fill="#ff0033" />
                            </svg>
                            {offlineCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[0.6rem] font-bold rounded-full px-1 py-0.5 leading-none"> {/* Badge styling */}
                                    {offlineCount}
                                </span>
                            )}
                        </div>
                    </FilterButton>
                    <FilterButton filterKey="soldout" isActive={activeFilters.soldout} onClick={onFilterChange}>
                        <div className="flex items-center"> {/* Icon container */}
                            <span className="font-bold">0</span>
                            {soldOutCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[0.6rem] font-bold rounded-full px-1 py-0.5 leading-none"> {/* Badge styling */}
                                    {soldOutCount}
                                </span>
                            )}
                        </div>
                    </FilterButton>
                    <FilterButton filterKey="disconnected" isActive={activeFilters.disconnected} onClick={onFilterChange}>
                        <div className="flex items-center">
                            <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="m20.7,19.3l-1,-1c-0.4,-0.4 -1,-0.4 -1.4,0s-0.4,1 0,1.4l1,1c0.2,0.2 0.5,0.3 0.7,0.3s0.5,-0.1 0.7,-0.3c0.4,-0.4 0.4,-1 0,-1.4z" />
                                <path d="m14,22c0,0.6 0.4,1 1,1s1,-0.4 1,-1l0,-2c0,-0.6 -0.4,-1 -1,-1s-1,0.4 -1,1l0,2z" />
                                <path d="m22,14l-2,0c-0.6,0 -1,0.4 -1,1s0.4,1 1,1l2,0c0.6,0 1,-0.4 1,-1s-0.4,-1 -1,-1z" />
                                <path d="m20.7,8.4c0,-1.4 -0.5,-2.6 -1.5,-3.6c-1,-1 -2.2,-1.5 -3.6,-1.5s-2.6,0.5 -3.6,1.5l-2.2,2.2c-0.4,0.4 -0.4,1 0,1.4s1,0.4 1.4,0l2.2,-2.2c1.2,-1.2 3.2,-1.2 4.4,0c0.6,0.6 0.9,1.4 0.9,2.2c0,0.8 -0.3,1.6 -0.9,2.2l-2.2,2.2c-0.4,0.4 -0.4,1 0,1.4c0.2,0.2 0.5,0.3 0.7,0.3s0.5,-0.1 0.7,-0.3l2.2,-2.2c1,-1 1.5,-2.2 1.5,-3.6z" />
                                <path d="m3.3,15.6c0,1.4 0.5,2.6 1.5,3.6c1,1 2.2,1.5 3.6,1.5s2.6,-0.5 3.6,-1.5l2.2,-2.2c0.4,-0.4 0.4,-1 0,-1.4s-1,-0.4 -1.4,0l-2.2,2.2c-1.2,1.2 -3.2,1.2 -4.4,0c-0.6,-0.6 -0.9,-1.4 -0.9,-2.2c0,-0.8 0.3,-1.6 0.9,-2.2l2.2,-2.2c0.4,-0.4 0.4,-1 0,-1.4s-1,-0.4 -1.4,0l-2.2,2.2c-1,1 -1.5,2.2 -1.5,3.6z" />
                                <path d="m5.7,4.3l-1,-1c-0.4,-0.4 -1,-0.4 -1.4,0s-0.4,1 0,1.4l1,1c0.2,0.2 0.4,0.3 0.7,0.3s0.5,-0.1 0.7,-0.3c0.4,-0.4 0.4,-1 0,-1.4z" />
                                <path d="m10,4l0,-2c0,-0.6 -0.4,-1 -1,-1s-1,0.4 -1,1l0,2c0,0.6 0.4,1 1,1s1,-0.4 1,-1z" />
                                <path d="m4,10c0.6,0 1,-0.4 1,-1s-0.4,-1 -1,-1l-2,0c-0.6,0 -1,0.4 -1,1s0.4,1 1,1l2,0z" />
                            </svg>
                            {disconnectedCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[0.6rem] font-bold rounded-full px-1 py-0.5 leading-none">
                                    {disconnectedCount}
                                </span>
                            )}
                        </div>
                    </FilterButton>
                    <div className="h-6 border-l border-gray-300 mx-2"></div>
                    <div className="flex items-center">
                        <input
                            id="active-only"
                            type="checkbox"
                            checked={showActiveOnly}
                            onChange={(e) => onShowActiveOnlyChange(e.target.checked)}
                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="active-only" className="ml-2 block text-sm text-gray-900">{t('active')}</label> {/* Changed label text */}
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="relative flex-grow">
                        <input
                            type="text"
                            placeholder={t('search_placeholder')}
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border rounded-md"
                        />
                        <svg className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                        </svg>
                        {searchTerm && (
                            <button
                                onClick={() => onSearchChange('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}