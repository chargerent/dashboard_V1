// src/pages/ReportingPage.jsx
import { useState, useMemo, useRef, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, ChartDataLabels);

const ReportingPage = ({ onNavigateToDashboard, onNavigateToAnalytics, onLogout, t, rentalData, allStationsData, clientInfo }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [selectedCountry, setSelectedCountry] = useState('');
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [selectedKiosks, setSelectedKiosks] = useState([]);
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);
    const [adjustmentPercentage, setAdjustmentPercentage] = useState(100);
    const [isExporting, setIsExporting] = useState(false);
    const [skipZeroRentalsDays, setSkipZeroRentalsDays] = useState(false);
    const [reportTitle, setReportTitle] = useState('Rental Report');
    const [reportPreparedFor, setReportPreparedFor] = useState('');
    const [uploadedRentalData, setUploadedRentalData] = useState(null);
    const [timeSeriesInterval, setTimeSeriesInterval] = useState('daily'); // 'daily' or 'monthly'
    const chartsRef = useRef(null);

    const resetFilters = () => {
        setSelectedCountry('');
        setSelectedLocations([]);
        setSelectedKiosks([]);
        setStartDate(null);
        setEndDate(null);
        setAdjustmentPercentage(100);
        setSkipZeroRentalsDays(false);
        setReportTitle('Rental Report');
        setReportPreparedFor('');
        setUploadedRentalData(null);
    };

    useEffect(() => {
        resetFilters();
    }, []);

    const clientKiosks = useMemo(() => {
        if (uploadedRentalData) {
            const kioskMap = new Map();
            uploadedRentalData.forEach(r => {
                if (r.rentalStationid && !kioskMap.has(r.rentalStationid)) {
                    const location = r.rentalLocation || '';
                    kioskMap.set(r.rentalStationid, { 
                        stationid: r.rentalStationid, 
                        info: { place: r.rentalPlace || '', location: location, country: location.slice(0, 2) } 
                    });
                }
            });
            return Array.from(kioskMap.values());
        }
        if (clientInfo.username === 'chargerent') {
            return allStationsData;
        }
        if (clientInfo.partner) {
            return allStationsData.filter(kiosk => kiosk.info.rep?.toLowerCase() === clientInfo.clientId?.toLowerCase());
        } else {
            return allStationsData.filter(kiosk => kiosk.info.client === clientInfo.clientId);
        }
    }, [allStationsData, clientInfo, uploadedRentalData]);

    const clientCountries = useMemo(() => {
        const countries = new Set();
        clientKiosks.forEach(kiosk => {
            if (kiosk.info.country) countries.add(kiosk.info.country);
        });
        return Array.from(countries).sort();
    }, [clientKiosks]);

    useEffect(() => {
        if (!selectedCountry && clientCountries.length > 0 && !clientCountries.includes(selectedCountry)) {
            setSelectedCountry(clientCountries[0]);
        }
    }, [clientCountries, selectedCountry]);

    const clientLocations = useMemo(() => {
        const locations = new Set();
        const kiosksInCountry = selectedCountry ? clientKiosks.filter(k => k.info.country === selectedCountry) : clientKiosks;
        kiosksInCountry.forEach(kiosk => {
            if (kiosk.info.location) locations.add(kiosk.info.location);
        });
        return Array.from(locations).sort();
    }, [clientKiosks, selectedCountry]);

    const availableKiosksForFilter = useMemo(() => {
        if (selectedLocations.length === 0) {
            return [];
        }
        return clientKiosks.filter(kiosk =>
            (!selectedCountry || kiosk.info.country === selectedCountry) &&
            selectedLocations.includes(kiosk.info.location)
        );
    }, [clientKiosks, selectedCountry, selectedLocations]);

    const stationToLocationMap = useMemo(() => {
        const map = new Map();
        allStationsData.forEach(station => map.set(station.stationid, station.info.location));
        return map;
    }, [allStationsData]);

    const activeRentalData = uploadedRentalData || rentalData;

    const filteredRentals = useMemo(() => {
        const start = startDate ? new Date(startDate.setHours(0, 0, 0, 0)) : null;
        const end = endDate ? new Date(endDate.setHours(23, 59, 59, 999)) : null;

        if (!start || !end) {
            return []; // Return empty if no date range is selected
        }

        return activeRentalData.filter(rental => {
            if (rental.status === 'purchased') return false;

            const rentalDate = new Date(rental.rentalTime);

            const isAfterStartDate = start ? rentalDate >= start : true;
            const isBeforeEndDate = end ? rentalDate <= end : true;
            if (!isAfterStartDate || !isBeforeEndDate) return false;

            if (selectedKiosks.length > 0) {
                return selectedKiosks.includes(rental.rentalStationid);
            }
            if (selectedLocations.length > 0) {
                // For uploaded data, the location might be directly on the rental object.
                const rentalLocation = rental.rentalLocation || stationToLocationMap.get(rental.rentalStationid);
                return selectedLocations.includes(rentalLocation);
            }
            return true; // No location or kiosk filter applied
        });
    }, [activeRentalData, selectedLocations, selectedKiosks, startDate, endDate, stationToLocationMap]);

    const originalTotalRentals = filteredRentals.length;
    const adjustedTotalRentals = Math.round(originalTotalRentals * (adjustmentPercentage / 100));

    const reportClientName = useMemo(() => {
        if (clientInfo.username !== 'chargerent') {
            return clientInfo.username;
        }
        if (selectedLocations.length > 0) {
            const clientSet = new Set();
            allStationsData.forEach(kiosk => {
                if (selectedLocations.includes(kiosk.info.location) && kiosk.info.client) {
                    clientSet.add(kiosk.info.client);
                }
            });
            return Array.from(clientSet).join(', ') || t('all_clients');
        }
        return t('all_clients');
    }, [clientInfo, selectedLocations, allStationsData, t]);

    const stationInfoMap = useMemo(() => {
        const map = new Map();
        // Prioritize allStationsData to get a complete list
        allStationsData.forEach(station => {
            if (station.stationid) {
                map.set(station.stationid, station.info);
            }
        });
        // Then, overwrite with info from the uploaded file if it exists
        clientKiosks.forEach(station => {
            map.set(station.stationid, station.info);
        });
        return map;
    }, [allStationsData, uploadedRentalData, clientKiosks]);

    const rentalsOverTime = useMemo(() => {
        const byInterval = {};
        filteredRentals.forEach(rental => {
            let intervalKey;
            if (timeSeriesInterval === 'monthly') {
                intervalKey = new Date(rental.rentalTime).toISOString().slice(0, 7); // YYYY-MM
            } else {
                intervalKey = new Date(rental.rentalTime).toISOString().split('T')[0]; // YYYY-MM-DD
            }
            byInterval[intervalKey] = (byInterval[intervalKey] || 0) + 1;
        });
        const sortedIntervals = Object.keys(byInterval).sort();

        return {
            labels: sortedIntervals.map(interval => {
                if (timeSeriesInterval === 'monthly') {
                    // Convert YYYY-MM to a Date object (e.g., 2023-01-01) to format it as a month name
                    return new Date(`${interval}-01`).toLocaleString('default', { month: 'short' });
                }
                // For daily, format YYYY-MM-DD to Month-Day
                const date = new Date(interval);
                return `${date.toLocaleString('default', { month: 'short' })}-${date.getUTCDate()}`;
            }),
            datasets: [{
                label: t('rentals'),
                data: sortedIntervals.map(interval => Math.round(byInterval[interval] * (adjustmentPercentage / 100))),
                borderColor: 'rgb(54, 162, 235)',
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
            }]
        };
    }, [filteredRentals, t, adjustmentPercentage, timeSeriesInterval]);

    const numberOfDaysForAverage = useMemo(() => {
        if (skipZeroRentalsDays) {
            const daysWithRentals = new Set(filteredRentals.map(r => new Date(r.rentalTime).toLocaleDateString())).size;
            return daysWithRentals > 0 ? daysWithRentals : 1;
        }
        if (!startDate || !endDate) return 1;
        const diffTime = Math.abs(new Date(endDate).setHours(23, 59, 59, 999) - new Date(startDate).setHours(0, 0, 0, 0));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 ? diffDays : 1;
    }, [startDate, endDate, skipZeroRentalsDays, filteredRentals]);

    const numberOfKiosksForAverage = useMemo(() => {
        const kiosksWithRentals = new Set(filteredRentals.map(r => r.rentalStationid));
        return kiosksWithRentals.size > 0 ? kiosksWithRentals.size : 1;
    }, [filteredRentals]);

    const averageRentalPeriod = useMemo(() => {
        const returnedRentals = filteredRentals.filter(r => r.rentalPeriod > 0);
        if (returnedRentals.length === 0) return '0m';

        const totalPeriodMs = returnedRentals.reduce((sum, r) => sum + r.rentalPeriod, 0);
        const avgMs = totalPeriodMs / returnedRentals.length;

        const totalSeconds = Math.floor(avgMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);

        return `${days > 0 ? `${days}d ` : ''}${hours > 0 ? `${hours}h ` : ''}${minutes}m`;
    }, [filteredRentals]);

    const rentalsByKiosk = useMemo(() => {
        // Initialize with all selected kiosks to ensure they appear in the chart
        const byKiosk = selectedKiosks.reduce((acc, kioskId) => {
            acc[kioskId] = 0;
            return acc;
        }, {});

        // Always use filteredRentals to respect the date range and other filters.
        filteredRentals.forEach(rental => {
            // Only count rentals for selected kiosks if a selection is made
            if (selectedKiosks.length === 0 || selectedKiosks.includes(rental.rentalStationid)) {
                byKiosk[rental.rentalStationid] = (byKiosk[rental.rentalStationid] || 0) + 1;
            } 
        });

        const sortedKiosks = Object.keys(byKiosk).sort((a, b) => byKiosk[b] - byKiosk[a]);

        return {
            labels: sortedKiosks.map(kioskId => {
                const info = stationInfoMap.get(kioskId);
                if (info && info.place) {
                    return [kioskId, info.place];
                }
                return kioskId;
            }),
            datasets: [{
                label: t('rentals'),
                data: sortedKiosks.map(kiosk => Math.round(byKiosk[kiosk] * (adjustmentPercentage / 100))),
                backgroundColor: 'rgba(255, 99, 132, 0.5)',
            }]
        };
    }, [filteredRentals, selectedKiosks, stationInfoMap, t, adjustmentPercentage]);

    const handleExportToPdf = () => {
        setIsExporting(true);
        const input = chartsRef.current;

        const logoImg = new Image();
        logoImg.src = '/logo.png';
        logoImg.onload = () => {
            // A small delay to allow the UI to update with `isExporting` state before capturing and ensure all elements are rendered
            setTimeout(() => {
                html2canvas(input, { scale: 2, useCORS: true }).then(canvas => { // Reduced scale to 2 for smaller file size
                    const imgData = canvas.toDataURL('image/jpeg', 0.95); // Use JPEG with 95% quality
                    const pdf = new jsPDF('p', 'mm', 'a4');
                    const pdfWidth = pdf.internal.pageSize.getWidth();
                    const pdfHeight = pdf.internal.pageSize.getHeight();
                    const margin = 15;

                    // Header
                    const logoWidth = 25; // Made logo smaller
                    const logoHeight = (logoImg.height * logoWidth) / logoImg.width;
                    const headerY = 15;
                    pdf.addImage(logoImg, 'PNG', margin, headerY, logoWidth, logoHeight);

                    // Main Title
                    pdf.setFontSize(22);
                    pdf.text(reportTitle, pdfWidth - margin, headerY + 5, { align: 'right' });

                    // Subtitle
                    if (reportPreparedFor) {
                        pdf.setFontSize(11);
                        pdf.text(`${t('report_prepared_for')} ${reportPreparedFor}`, pdfWidth - margin, headerY + 12, { align: 'right' });
                    }

                    // Content
                    const contentStartY = headerY + logoHeight + 10;
                    const contentWidth = pdfWidth - 2 * margin;
                    const imgProps = pdf.getImageProperties(imgData);
                    const imgHeight = (imgProps.height * contentWidth) / imgProps.width;

                    pdf.addImage(imgData, 'JPEG', margin, contentStartY, contentWidth, imgHeight, undefined, 'FAST');

                    pdf.save(`rentals-report-${new Date().toISOString().split('T')[0]}.pdf`);
                }).catch(err => console.error("html2canvas error:", err))
                  .finally(() => setIsExporting(false));
            }, 100);
        };
        logoImg.onerror = () => {
            console.error("Could not load logo for PDF export.");
            setIsExporting(false); // Handle error
        };
    };

    const handleFileUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                let fileContent = e.target.result;
                try {
                    // Pre-process the file content to handle non-standard JSON values like NaN.
                    // JSON standard does not support NaN, so we replace it with null.
                    const sanitizedContent = fileContent.replace(/\bNaN\b/g, 'null').replace(/"nan"/g, 'null');
                    const data = JSON.parse(sanitizedContent);
                    if (Array.isArray(data) && (data.length === 0 || 'rentalTime' in data[0])) {
                        setUploadedRentalData(data);
                        if (data.length > 0) {
                            const dates = data.map(r => new Date(r.rentalTime));
                            const minDate = new Date(Math.min.apply(null, dates));
                            const maxDate = new Date(Math.max.apply(null, dates));
                            setStartDate(minDate);
                            setEndDate(maxDate);
                        } else {
                            setStartDate(null);
                            setEndDate(null);
                        }
                        alert(`${data.length} rentals loaded successfully.`);
                    } else {
                        console.error("Uploaded JSON is not a valid rental data array. Please check the file structure.", data);
                        alert('Invalid file format. Please upload a valid JSON array of rental data.');
                    }
                } catch (error) {
                    console.error("Failed to parse uploaded JSON file. Raw content:", fileContent);
                    console.error("Parsing error details:", error);
                    alert('Error parsing JSON file: ' + error.message);
                }
            };
            reader.readAsText(file);
        }
        // Clear the input value to allow re-uploading the same file
        event.target.value = null;
    };

    return (
        <div className="min-h-screen bg-gray-100">
            <header className="bg-white shadow-sm">
                <div className="max-w-screen-xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        {/* Language buttons are now on the left */}
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={onNavigateToDashboard} className="p-2 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300" title={t('back_to_dashboard')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        </button>
                        <button onClick={() => onNavigateToAnalytics(filteredRentals)} className="p-2 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200" title={t('station_analytics')}>
                            <ChartBarIcon className="h-6 w-6" />
                        </button>
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="max-w-screen-xl mx-auto py-6 sm:px-4 lg:px-6">
                <div className="bg-white p-4 rounded-lg shadow-md mb-8">
                    <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                        <div className="flex items-center gap-4">
                            <label htmlFor="file-upload" className="cursor-pointer bg-green-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-green-700">
                                {t('upload_rental_data')}
                            </label>
                            <input id="file-upload" type="file" className="hidden" onChange={handleFileUpload} accept=".json" />
                            {uploadedRentalData && (
                                <button onClick={() => setUploadedRentalData(null)} className="bg-red-500 text-white font-semibold py-2 px-4 rounded-md hover:bg-red-600">
                                    {t('clear_uploaded_data')} ({uploadedRentalData.length} {t('rentals')})
                                </button>
                            )}
                        </div>
                        <button onClick={handleExportToPdf} disabled={isExporting} className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            {isExporting ? t('exporting') : t('export_pdf')}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            {clientCountries.length > 1 && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('country')}</label>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        {clientCountries.map(country => (
                                            <button
                                                key={country || 'all'}
                                                onClick={() => { setSelectedCountry(country); setSelectedLocations([]); setSelectedKiosks([]); }}
                                                className={`px-4 py-2 border text-sm font-medium rounded-md shadow-sm ${selectedCountry === country ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                                            >
                                                {country || t('all_countries')}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('location')}</label>
                                <select multiple value={selectedLocations} onChange={e => { setSelectedLocations(Array.from(e.target.selectedOptions, option => option.value)); setSelectedKiosks([]); }} className="mt-1 block w-full h-48 border border-gray-300 rounded-md">
                                    {clientLocations.map(location => <option key={location} value={location}>{location}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('kiosk')}</label>
                                <select multiple value={selectedKiosks} onChange={e => setSelectedKiosks(Array.from(e.target.selectedOptions, option => option.value))} className="mt-1 block w-full h-24 border border-gray-300 rounded-md" disabled={selectedLocations.length === 0}>
                                    {availableKiosksForFilter.map(kiosk => <option key={kiosk.stationid} value={kiosk.stationid}>{kiosk.stationid} - {kiosk.info.place}</option>)}
                                </select>
                                <div className="flex justify-between mt-1">
                                    <button onClick={() => setSelectedKiosks(availableKiosksForFilter.map(k => k.stationid))} className="text-xs text-blue-600" disabled={selectedLocations.length === 0}>{t('select_all')}</button>
                                    <button onClick={() => setSelectedKiosks([])} className="text-xs text-blue-600" disabled={selectedLocations.length === 0}>{t('clear_selection')}</button>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('start_date')}</label>
                                <DatePicker selected={startDate} onChange={(date) => setStartDate(date)} className="mt-1 block w-full border border-gray-300 rounded-md p-2" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('end_date')}</label>
                                <DatePicker selected={endDate} onChange={(date) => setEndDate(date)} className="mt-1 block w-full border border-gray-300 rounded-md p-2" />
                            </div>
                            <div className="pt-4 border-t border-gray-200">
                                <label className="block text-sm font-medium text-gray-700">{t('report_title')}</label>
                                <input type="text" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)} placeholder={t('rental_report')} className="mt-1 block w-full border border-gray-300 rounded-md p-2" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('report_prepared_for')}</label>
                                <input type="text" value={reportPreparedFor} onChange={(e) => setReportPreparedFor(e.target.value)} placeholder={t('client_name')} className="mt-1 block w-full border border-gray-300 rounded-md p-2" />
                            </div>
                        </div>
                        <div className="space-y-4">
                             <div>
                                <label htmlFor="adjustment" className="block text-sm font-medium text-gray-700">{t('adjust_totals')} ({adjustmentPercentage}%)</label>
                                <input id="adjustment" type="range" min="0" max="500" value={adjustmentPercentage} onChange={e => setAdjustmentPercentage(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer mt-2" />
                            </div>
                            <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-center">
                                <p className="text-sm text-gray-600">{t('total_rentals')}</p>
                                <div className="flex justify-center items-baseline gap-4 mt-1">
                                    <div>
                                        <span className="text-xs text-gray-500">{t('original')}:</span>
                                        <p className="text-2xl font-bold text-gray-700">{originalTotalRentals}</p>
                                    </div>
                                    <div>
                                        <span className="text-xs text-gray-500">{t('adjusted')}:</span>
                                        <p className="text-2xl font-bold text-blue-600">{adjustedTotalRentals}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div ref={chartsRef} className="bg-white p-6 rounded-lg shadow-md">
                    {/* Summary Panel */}
                    <div className={`p-4 border border-gray-200 rounded-lg bg-gray-50`}>
                        <h3 className={`text-lg font-bold text-gray-800 mb-4 text-center ${isExporting ? 'hidden' : ''}`}>{t('rental_summary')}</h3>
                        <div className={`grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-2 text-center`}>
                            <div className="p-1">
                                <p className="text-sm text-gray-500">{t('date_range')}</p>
                                <p className="text-md font-semibold text-gray-800">
                                    {startDate && endDate ? `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}` : '...'}
                                </p>
                                <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>({numberOfDaysForAverage} {t('days')})</p>
                            </div>
                            <div className="p-1">
                                <p className="text-sm text-gray-500">{t('total_rentals')}</p>
                                <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{adjustedTotalRentals}</p>
                                <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>{t('original')}: {originalTotalRentals}</p>
                            </div>
                            <div className="p-1">
                                <div>
                                    <p className="text-sm text-gray-500">{t('avg_rentals_per_day')}</p>
                                    <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{isFinite(adjustedTotalRentals / numberOfDaysForAverage) ? Math.ceil(adjustedTotalRentals / numberOfDaysForAverage) : '0'}</p>
                                    <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>{t('original')}: {isFinite(originalTotalRentals / numberOfDaysForAverage) ? Math.ceil(originalTotalRentals / numberOfDaysForAverage) : '0'}</p>
                                </div>
                                <div className={`flex items-center justify-center gap-1 mt-1 ${isExporting ? 'hidden' : ''}`}>
                                    <label htmlFor="skipDays" className="text-xs text-gray-600">{t('skip_empty_days')}</label>
                                    <input type="checkbox" id="skipDays" checked={skipZeroRentalsDays} onChange={e => setSkipZeroRentalsDays(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                </div>
                            </div>
                            <div className="p-1">
                                <div>
                                    <p className="text-sm text-gray-500">{t('avg_rentals_per_kiosk')}</p>
                                    <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{isFinite(adjustedTotalRentals / numberOfKiosksForAverage) ? Math.ceil(adjustedTotalRentals / numberOfKiosksForAverage) : '0'}</p>
                                    <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>{t('original')}: {isFinite(originalTotalRentals / numberOfKiosksForAverage) ? Math.ceil(originalTotalRentals / numberOfKiosksForAverage) : '0'}</p>
                                </div>
                            </div>
                            <div className="p-1">
                                <p className="text-sm text-gray-500">Avg. Rental / Period</p>
                                <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{averageRentalPeriod}</p>
                            </div>
                        </div>
                    </div>
                    <div className={`grid grid-cols-1 ${isExporting ? '' : 'lg:grid-cols-2'} gap-8 mt-8`}>
                        <div className="flex flex-col">
                            <div className="relative h-96">
                                <Bar options={{ 
                                    responsive: true,
                                    devicePixelRatio: 3, // Render Chart.js at 3x resolution for sharper output
                                    animation: !isExporting, // Disable animation during PDF export
                                    maintainAspectRatio: false, 
                                    barPercentage: 0.5,
                                    plugins: { 
                                        title: { display: true, text: t('rentals_over_time') }, 
                                        legend: { display: false },
                                        datalabels: {
                                            anchor: 'end',
                                            align: 'top',
                                            formatter: Math.round,
                                            font: { weight: 'bold' }
                                        }
                                    }
                                }} data={rentalsOverTime} />
                            </div>
                            <div className={`mt-4 flex items-center space-x-2 self-start ${isExporting ? 'hidden' : ''}`}>
                                <span className="text-xs font-medium text-gray-500">{t('monthly')}</span>
                                <button onClick={() => setTimeSeriesInterval(timeSeriesInterval === 'daily' ? 'monthly' : 'daily')} className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${timeSeriesInterval === 'daily' ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                                    <span aria-hidden="true" className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${timeSeriesInterval === 'daily' ? 'translate-x-5' : 'translate-x-0'}`} />
                                </button>
                                <span className="text-xs font-medium text-gray-500">{t('daily')}</span>
                            </div>
                        </div>
                        <div className="relative h-96">
                            <Bar options={{ 
                            responsive: true,
                            devicePixelRatio: 3, // Render Chart.js at 3x resolution for sharper output
                            animation: !isExporting, // Disable animation during PDF export
                            maintainAspectRatio: false, 
                            barPercentage: 0.5,
                            plugins: { 
                                title: { display: true, text: t('rentals_by_kiosk') },
                                legend: { display: false },
                                datalabels: {
                                    anchor: 'end',
                                    align: 'top',
                                    formatter: Math.round,
                                    font: { weight: 'bold' }
                                }
                            } 
                        }} data={rentalsByKiosk} /></div>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-lg shadow-md mt-8">
                    <h3 className="font-semibold mb-4">{t('raw_rental_data')}</h3>
                    <div className="max-h-96 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-2 py-2 text-left font-medium text-gray-500">{t('date')}</th>
                                    <th className="px-2 py-2 text-left font-medium text-gray-500">{t('kiosk')}</th>
                                    <th className="px-2 py-2 text-left font-medium text-gray-500">{t('charger_sn')}</th>
                                    <th className="px-2 py-2 text-left font-medium text-gray-500">{t('amount')}</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredRentals.map(rental => (
                                    <tr key={rental.orderid || rental.rawid}>
                                        <td className="px-2 py-2 whitespace-nowrap">{new Date(rental.rentalTime).toLocaleString()}</td>
                                        <td className="px-2 py-2 whitespace-nowrap">{rental.rentalStationid}</td>
                                        <td className="px-2 py-2 whitespace-nowrap">{rental.sn}</td>
                                        <td className="px-2 py-2 whitespace-nowrap">{rental.symbol}{(rental.totalCharged ?? 0).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ReportingPage;