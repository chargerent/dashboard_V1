// src/pages/ReportingPage.jsx
import { useState, useMemo, useRef, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { ChartBarIcon } from '@heroicons/react/24/outline';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { db } from '../firebase-config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { isNewSchemaKiosk } from '../utils/helpers';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, ChartDataLabels);

// Adjusts bar at index by delta (±1). The bar immediately to the right compensates.
// The last bar is read-only — it absorbs all compensation automatically.
function adjustChartValue(dataArray, index, delta) {
    const data = dataArray.map(v => Math.round(v));
    const lastIdx = data.length - 1;
    if (index >= lastIdx) return data; // last bar not editable

    const proposed = data[index] + delta;
    if (proposed < 0) return data;

    const nextVal = data[index + 1] - delta;
    if (nextVal < 0) return data;

    const newData = [...data];
    newData[index] = proposed;
    newData[index + 1] = nextVal;
    return newData;
}

const ReportingPage = ({ onNavigateToDashboard, onNavigateToAnalytics, onLogout, t, rentalData, allStationsData, clientInfo, userMode = false }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [selectedCountry, setSelectedCountry] = useState('');
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [selectedKiosks, setSelectedKiosks] = useState([]);
    const [showV1Kiosks, setShowV1Kiosks] = useState(true);
    const [showV2Kiosks, setShowV2Kiosks] = useState(true);
    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);
    const [adjustmentPercentage, setAdjustmentPercentage] = useState(100);
    const [isExporting, setIsExporting] = useState(false);
    const [skipZeroRentalsDays, setSkipZeroRentalsDays] = useState(false);
    const [reportTitle, setReportTitle] = useState('Rental Report');
    const [reportPreparedFor, setReportPreparedFor] = useState(userMode ? (clientInfo?.username || '') : '');
    const [uploadedRentalData, setUploadedRentalData] = useState(null);
    const [timeSeriesInterval, setTimeSeriesInterval] = useState('monthly'); // 'daily' or 'monthly'
    const [fetchedRentalData, setFetchedRentalData] = useState(null);
    const [isFetchingRentals, setIsFetchingRentals] = useState(false);
    const [timeSeriesOverrides, setTimeSeriesOverrides] = useState(null);
    const [kioskOverrides, setKioskOverrides] = useState(null);
    const [kioskLabelOverrides, setKioskLabelOverrides] = useState(null);
    const [editingLabelIndex, setEditingLabelIndex] = useState(null);
    const chartsRef = useRef(null);

    const resetFilters = () => {
        setSelectedCountry('');
        setSelectedLocations([]);
        setSelectedKiosks([]);
        setShowV1Kiosks(true);
        setShowV2Kiosks(true);
        setStartDate(null);
        setEndDate(null);
        setAdjustmentPercentage(100);
        setSkipZeroRentalsDays(false);
        setReportTitle('Rental Report');
        setReportPreparedFor(userMode ? (clientInfo?.username || '') : '');
        setUploadedRentalData(null);
        setFetchedRentalData(null);
    };

    const setLastMonth = () => {
        const now = new Date();
        setStartDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        setEndDate(new Date(now.getFullYear(), now.getMonth(), 0));
    };

    const setYearToDate = () => {
        setStartDate(new Date(new Date().getFullYear(), 0, 1));
        setEndDate(new Date());
    };

    useEffect(() => {
        resetFilters();
    }, []);

    // Fetch rental data from Firestore for the selected date range.
    // The App.jsx rentalData is limited to 30 days; this allows arbitrary historical reporting.
    useEffect(() => {
        if (uploadedRentalData) return; // Uploaded file takes priority
        if (!startDate || !endDate) {
            setFetchedRentalData(null);
            return;
        }

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        setIsFetchingRentals(true);
        const rentalQuery = query(
            collection(db, 'rentals'),
            where('rentalTime', '>=', start.toISOString()),
            where('rentalTime', '<=', end.toISOString())
        );

        getDocs(rentalQuery)
            .then(snapshot => {
                const rentals = snapshot.docs.map(doc => ({ rawid: doc.id, ...doc.data() }));
                setFetchedRentalData(rentals);
            })
            .catch(err => {
                console.error('[ReportingPage] Failed to fetch rentals:', err);
                setFetchedRentalData(null);
            })
            .finally(() => setIsFetchingRentals(false));
    }, [startDate, endDate, uploadedRentalData]);

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
        if (clientInfo.isAdmin) {
            return allStationsData;
        }
        if (clientInfo.role === 'partner') {
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

    const stationDataById = useMemo(() => {
        const map = new Map();
        allStationsData.forEach(station => {
            if (station.stationid) {
                map.set(station.stationid, station);
            }
        });
        return map;
    }, [allStationsData]);

    const availableKiosksForFilter = useMemo(() => {
        const matchesVersionFilter = (kiosk) => {
            const kioskWithVersionInfo = stationDataById.get(kiosk.stationid) || kiosk;
            const isV2 = isNewSchemaKiosk(kioskWithVersionInfo);
            return isV2 ? showV2Kiosks : showV1Kiosks;
        };

        let kiosksInScope = [];
        if (userMode) {
            kiosksInScope = clientKiosks;
        } else if (selectedLocations.length > 0) {
            kiosksInScope = clientKiosks.filter(kiosk =>
                (!selectedCountry || kiosk.info.country === selectedCountry) &&
                selectedLocations.includes(kiosk.info.location)
            );
        }

        return kiosksInScope.filter(matchesVersionFilter);
    }, [clientKiosks, selectedCountry, selectedLocations, userMode, stationDataById, showV1Kiosks, showV2Kiosks]);

    useEffect(() => {
        const availableKioskIds = new Set(availableKiosksForFilter.map(kiosk => kiosk.stationid));
        setSelectedKiosks(prevSelected => {
            const nextSelected = prevSelected.filter(kioskId => availableKioskIds.has(kioskId));
            return nextSelected.length === prevSelected.length ? prevSelected : nextSelected;
        });
    }, [availableKiosksForFilter]);

    const stationToLocationMap = useMemo(() => {
        const map = new Map();
        allStationsData.forEach(station => map.set(station.stationid, station.info.location));
        return map;
    }, [allStationsData]);

    const activeRentalData = uploadedRentalData || fetchedRentalData || rentalData;

    const filteredRentals = useMemo(() => {
        const start = startDate ? new Date(startDate) : null;
        if (start) start.setHours(0, 0, 0, 0);

        const end = endDate ? new Date(endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

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
            // In user mode, restrict to the user's own kiosks to prevent data leakage
            if (userMode) {
                const clientKioskIds = new Set(clientKiosks.map(k => k.stationid));
                return clientKioskIds.has(rental.rentalStationid);
            }
            return true; // No location or kiosk filter applied (admin/partner)
        });
    }, [activeRentalData, selectedLocations, selectedKiosks, startDate, endDate, stationToLocationMap, userMode, clientKiosks]);

    const originalTotalRentals = filteredRentals.length;
    const adjustedTotalRentals = Math.round(originalTotalRentals * (adjustmentPercentage / 100));

    const commission = Number.isFinite(Number(clientInfo?.revShare ?? clientInfo?.commission))
        ? Number(clientInfo?.revShare ?? clientInfo?.commission)
        : 0;

    const { totalRevenue, currencySymbol } = useMemo(() => {
        const total = filteredRentals.reduce((sum, r) => sum + (parseFloat(r.totalCharged) || 0), 0);
        const symbol = filteredRentals.find(r => r.symbol)?.symbol || '';
        return { totalRevenue: total, currencySymbol: symbol };
    }, [filteredRentals]);

    const userRevenue = totalRevenue * (commission / 100);

    const _reportClientName = useMemo(() => {
        if (!clientInfo.isAdmin) {
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
            const d = new Date(rental.rentalTime);
            if (timeSeriesInterval === 'monthly') {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                intervalKey = `${year}-${month}`;
            } else {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                intervalKey = `${year}-${month}-${day}`;
            }
            byInterval[intervalKey] = (byInterval[intervalKey] || 0) + 1;
        });
        const sortedIntervals = Object.keys(byInterval).sort();

        const rawData = sortedIntervals.map(interval => Math.round(byInterval[interval] * (adjustmentPercentage / 100)));
        const totalAdjusted = Math.round(Object.values(byInterval).reduce((a, b) => a + b, 0) * (adjustmentPercentage / 100));
        if (rawData.length > 0) {
            rawData[rawData.length - 1] = totalAdjusted - rawData.slice(0, -1).reduce((a, b) => a + b, 0);
        }

        return {
            labels: sortedIntervals.map(interval => {
                const [year, month, day] = interval.split('-').map(Number);
                if (timeSeriesInterval === 'monthly') {
                    const date = new Date(year, month - 1);
                    return date.toLocaleString('default', { month: 'short' });
                }
                const date = new Date(year, month - 1, day);
                return `${date.toLocaleString('default', { month: 'short' })}-${date.getDate()}`;
            }),
            datasets: [{
                label: t('rentals'),
                data: rawData,
                borderColor: 'rgb(54, 162, 235)',
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
            }]
        };
    }, [filteredRentals, t, adjustmentPercentage, timeSeriesInterval]);

    // Reset overrides only when the user changes filters, not on background Firestore refreshes
    useEffect(() => {
        setTimeSeriesOverrides(null);
        setKioskOverrides(null);
        setKioskLabelOverrides(null);
        setEditingLabelIndex(null);
    }, [startDate, endDate, selectedKiosks, selectedLocations, adjustmentPercentage, timeSeriesInterval, uploadedRentalData]);

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

        const kioskRawData = sortedKiosks.map(kiosk => Math.round(byKiosk[kiosk] * (adjustmentPercentage / 100)));
        const kioskTotalAdjusted = Math.round(Object.values(byKiosk).reduce((a, b) => a + b, 0) * (adjustmentPercentage / 100));
        if (kioskRawData.length > 0) {
            kioskRawData[kioskRawData.length - 1] = kioskTotalAdjusted - kioskRawData.slice(0, -1).reduce((a, b) => a + b, 0);
        }

        return {
            labels: sortedKiosks.map(kioskId => {
                const info = stationInfoMap.get(kioskId);
                return (info && info.place) ? info.place : kioskId;
            }),
            datasets: [{
                label: t('rentals'),
                data: kioskRawData,
                backgroundColor: 'rgba(255, 99, 132, 0.5)',
            }]
        };
    }, [filteredRentals, selectedKiosks, stationInfoMap, t, adjustmentPercentage]);

    const timeSeriesChartData = useMemo(() => {
        if (!timeSeriesOverrides) return rentalsOverTime;
        return { ...rentalsOverTime, datasets: [{ ...rentalsOverTime.datasets[0], data: timeSeriesOverrides }] };
    }, [rentalsOverTime, timeSeriesOverrides]);

    const kioskChartData = useMemo(() => {
        let base = !kioskOverrides
            ? rentalsByKiosk
            : { ...rentalsByKiosk, datasets: [{ ...rentalsByKiosk.datasets[0], data: kioskOverrides }] };
        if (kioskLabelOverrides && Object.keys(kioskLabelOverrides).length > 0) {
            const newLabels = base.labels.map((label, i) => kioskLabelOverrides[i] ?? label);
            base = { ...base, labels: newLabels };
        }
        return base;
    }, [rentalsByKiosk, kioskOverrides, kioskLabelOverrides]);

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
                    const _pdfHeight = pdf.internal.pageSize.getHeight();
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
                        {!userMode && (
                            <button onClick={() => onNavigateToAnalytics(filteredRentals)} className="p-2 rounded-md bg-indigo-100 text-indigo-700 hover:bg-indigo-200" title={t('station_analytics')}>
                                <ChartBarIcon className="h-6 w-6" />
                            </button>
                        )}
                        <button onClick={onLogout} className="p-2 rounded-md bg-red-500 text-white hover:bg-red-600" title={t('logout')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>
            <main className="max-w-screen-xl mx-auto py-6 sm:px-4 lg:px-6">
                <div className="bg-white p-4 rounded-lg shadow-md mb-8">
                    <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
                        {!userMode && (
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
                        )}
                        <button onClick={handleExportToPdf} disabled={isExporting} className="bg-blue-600 text-white font-semibold py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            {isExporting ? t('exporting') : t('export_pdf')}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            {!userMode && clientCountries.length > 1 && (
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
                            {!userMode && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">{t('location')}</label>
                                    <select multiple value={selectedLocations} onChange={e => { setSelectedLocations(Array.from(e.target.selectedOptions, option => option.value)); setSelectedKiosks([]); }} className="mt-1 block w-full h-48 border border-gray-300 rounded-md">
                                        {clientLocations.map(location => <option key={location} value={location}>{location}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700">{t('kiosk')}</label>
                                <div className="mt-1 flex items-center gap-4">
                                    <div className="flex items-center">
                                        <input
                                            id="reporting-show-v1"
                                            type="checkbox"
                                            checked={showV1Kiosks}
                                            onChange={(e) => setShowV1Kiosks(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <label htmlFor="reporting-show-v1" className="ml-2 text-sm text-gray-900">V1</label>
                                    </div>
                                    <div className="flex items-center">
                                        <input
                                            id="reporting-show-v2"
                                            type="checkbox"
                                            checked={showV2Kiosks}
                                            onChange={(e) => setShowV2Kiosks(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                        />
                                        <label htmlFor="reporting-show-v2" className="ml-2 text-sm text-gray-900">V2</label>
                                    </div>
                                </div>
                                <select multiple value={selectedKiosks} onChange={e => setSelectedKiosks(Array.from(e.target.selectedOptions, option => option.value))} className={`mt-1 block w-full ${userMode ? 'h-48' : 'h-24'} border border-gray-300 rounded-md`} disabled={!userMode && selectedLocations.length === 0}>
                                    {availableKiosksForFilter.map(kiosk => <option key={kiosk.stationid} value={kiosk.stationid}>{kiosk.stationid} - {kiosk.info.place}</option>)}
                                </select>
                                <div className="flex justify-between mt-1">
                                    <button onClick={() => setSelectedKiosks(availableKiosksForFilter.map(k => k.stationid))} className="text-xs text-blue-600" disabled={!userMode && selectedLocations.length === 0}>{t('select_all')}</button>
                                    <button onClick={() => setSelectedKiosks([])} className="text-xs text-blue-600" disabled={!userMode && selectedLocations.length === 0}>{t('clear_selection')}</button>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <button onClick={setLastMonth} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-md border border-gray-300">Last Month</button>
                                <button onClick={setYearToDate} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-md border border-gray-300">Year to Date</button>
                            </div>
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
                                <input type="text" value={reportPreparedFor} onChange={(e) => !userMode && setReportPreparedFor(e.target.value)} readOnly={userMode} placeholder={t('client_name')} className={`mt-1 block w-full border border-gray-300 rounded-md p-2 ${userMode ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`} />
                            </div>
                        </div>
                        <div className="space-y-4">
                            {!userMode && (
                                <div>
                                    <label htmlFor="adjustment" className="block text-sm font-medium text-gray-700">{t('adjust_totals')} ({adjustmentPercentage}%)</label>
                                    <input id="adjustment" type="range" min="100" max="500" value={adjustmentPercentage} onChange={e => setAdjustmentPercentage(Math.max(100, Number(e.target.value)))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer mt-2" />
                                </div>
                            )}
                            <div className="bg-gray-50 p-3 rounded-md border border-gray-200 text-center">
                                <p className="text-sm text-gray-600">{t('total_rentals')}</p>
                                {isFetchingRentals ? (
                                    <p className="text-sm text-gray-500 mt-2">Loading...</p>
                                ) : userMode ? (
                                    <p className="text-2xl font-bold text-gray-700 mt-1">{originalTotalRentals}</p>
                                ) : (
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
                                )}
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
                                <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{userMode ? originalTotalRentals : adjustedTotalRentals}</p>
                                {!userMode && <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>{t('original')}: {originalTotalRentals}</p>}
                            </div>
                            <div className="p-1">
                                <div>
                                    <p className="text-sm text-gray-500">{t('avg_rentals_per_day')}</p>
                                    <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{userMode ? (isFinite(originalTotalRentals / numberOfDaysForAverage) ? Math.ceil(originalTotalRentals / numberOfDaysForAverage) : '0') : (isFinite(adjustedTotalRentals / numberOfDaysForAverage) ? Math.ceil(adjustedTotalRentals / numberOfDaysForAverage) : '0')}</p>
                                    {!userMode && <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>{t('original')}: {isFinite(originalTotalRentals / numberOfDaysForAverage) ? Math.ceil(originalTotalRentals / numberOfDaysForAverage) : '0'}</p>}
                                </div>
                                {!userMode && (
                                    <div className={`flex items-center justify-center gap-1 mt-1 ${isExporting ? 'hidden' : ''}`}>
                                        <label htmlFor="skipDays" className="text-xs text-gray-600">{t('skip_empty_days')}</label>
                                        <input type="checkbox" id="skipDays" checked={skipZeroRentalsDays} onChange={e => setSkipZeroRentalsDays(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    </div>
                                )}
                            </div>
                            <div className="p-1">
                                <div>
                                    <p className="text-sm text-gray-500">{t('avg_rentals_per_kiosk')}</p>
                                    <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{userMode ? (isFinite(originalTotalRentals / numberOfKiosksForAverage) ? Math.ceil(originalTotalRentals / numberOfKiosksForAverage) : '0') : (isFinite(adjustedTotalRentals / numberOfKiosksForAverage) ? Math.ceil(adjustedTotalRentals / numberOfKiosksForAverage) : '0')}</p>
                                    {!userMode && <p className={`text-xs text-gray-500 ${isExporting ? 'hidden' : ''}`}>{t('original')}: {isFinite(originalTotalRentals / numberOfKiosksForAverage) ? Math.ceil(originalTotalRentals / numberOfKiosksForAverage) : '0'}</p>}
                                </div>
                            </div>
                            <div className="p-1">
                                <p className="text-sm text-gray-500">Avg. Rental / Period</p>
                                <p className={`font-bold text-blue-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{averageRentalPeriod}</p>
                            </div>
                            {userMode && (
                                <>
                                    <div className="p-1">
                                        <p className="text-sm text-gray-500">Total Revenue</p>
                                        <p className={`font-bold text-green-600 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{currencySymbol}{totalRevenue.toFixed(2)}</p>
                                    </div>
                                    <div className="p-1">
                                        <p className="text-sm text-gray-500">Your Share ({commission}%)</p>
                                        <p className={`font-bold text-green-700 ${isExporting ? 'text-2xl' : 'text-3xl'}`}>{currencySymbol}{userRevenue.toFixed(2)}</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-8 mt-8">
                        <div className="flex flex-col">
                            <div className="relative h-96">
                                <Bar options={{
                                    responsive: true,
                                    devicePixelRatio: 3,
                                    animation: !isExporting,
                                    maintainAspectRatio: false,
                                    barPercentage: 0.5,
                                    scales: { x: { ticks: { display: userMode || isExporting } } },
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
                                }} data={timeSeriesChartData} />
                            </div>
                            {!userMode && !isExporting && timeSeriesChartData.labels.length > 0 && (
                                <div className="mt-1">
                                    <div className="flex">
                                        {timeSeriesChartData.labels.map((label, i) => {
                                            const isLast = i === timeSeriesChartData.datasets[0].data.length - 1;
                                            const val = Math.round(timeSeriesChartData.datasets[0].data[i]);
                                            return (
                                                <div key={i} className="flex-1 flex items-center justify-center gap-0.5 text-xs overflow-hidden px-0.5 h-5">
                                                    {!isLast && <span role="button" tabIndex={0} onClick={() => setTimeSeriesOverrides(adjustChartValue(timeSeriesChartData.datasets[0].data, i, 1))} className="text-gray-300 hover:text-blue-500 shrink-0 cursor-pointer select-none" style={{ lineHeight: 1 }}>▲</span>}
                                                    <span className={`font-mono shrink-0 ${isLast ? 'text-gray-400' : 'font-semibold text-gray-700'}`} style={{ lineHeight: 1 }}>{val}</span>
                                                    {!isLast && <span role="button" tabIndex={0} onClick={() => setTimeSeriesOverrides(adjustChartValue(timeSeriesChartData.datasets[0].data, i, -1))} className="text-gray-300 hover:text-blue-500 shrink-0 cursor-pointer select-none" style={{ lineHeight: 1 }}>▼</span>}
                                                    <span className="text-gray-400 truncate min-w-0" style={{ lineHeight: 1 }}>{label}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {timeSeriesOverrides && <button onClick={() => setTimeSeriesOverrides(null)} className="text-xs text-red-400 hover:text-red-600 mt-1">Reset</button>}
                                </div>
                            )}
                            <div className={`mt-3 flex items-center space-x-2 self-start ${isExporting ? 'hidden' : ''}`}>
                                <span className="text-xs font-medium text-gray-500">{t('monthly')}</span>
                                <button onClick={() => setTimeSeriesInterval(timeSeriesInterval === 'daily' ? 'monthly' : 'daily')} className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${timeSeriesInterval === 'daily' ? 'bg-indigo-600' : 'bg-gray-200'}`}>
                                    <span aria-hidden="true" className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${timeSeriesInterval === 'daily' ? 'translate-x-5' : 'translate-x-0'}`} />
                                </button>
                                <span className="text-xs font-medium text-gray-500">{t('daily')}</span>
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <div className="relative h-96">
                                <Bar options={{
                                    responsive: true,
                                    devicePixelRatio: 3,
                                    animation: !isExporting,
                                    maintainAspectRatio: false,
                                    barPercentage: 0.5,
                                    scales: { x: { ticks: { display: userMode || isExporting } } },
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
                                }} data={kioskChartData} />
                            </div>
                            {!userMode && !isExporting && kioskChartData.labels.length > 0 && (
                                <div className="mt-1">
                                    <div className="flex">
                                        {kioskChartData.labels.map((label, i) => {
                                            const isLast = i === kioskChartData.datasets[0].data.length - 1;
                                            const val = Math.round(kioskChartData.datasets[0].data[i]);
                                            const displayLabel = kioskLabelOverrides?.[i] ?? (Array.isArray(label) ? (label[1] || label[0]) : label);
                                            return (
                                                <div key={i} className="flex-1 flex items-center justify-center gap-0.5 text-xs overflow-hidden px-0.5 h-5">
                                                    {!isLast && <span role="button" tabIndex={0} onClick={() => setKioskOverrides(adjustChartValue(kioskChartData.datasets[0].data, i, 1))} className="text-gray-300 hover:text-blue-500 shrink-0 cursor-pointer select-none" style={{ lineHeight: 1 }}>▲</span>}
                                                    <span className={`font-mono shrink-0 ${isLast ? 'text-gray-400' : 'font-semibold text-gray-700'}`} style={{ lineHeight: 1 }}>{val}</span>
                                                    {!isLast && <span role="button" tabIndex={0} onClick={() => setKioskOverrides(adjustChartValue(kioskChartData.datasets[0].data, i, -1))} className="text-gray-300 hover:text-blue-500 shrink-0 cursor-pointer select-none" style={{ lineHeight: 1 }}>▼</span>}
                                                    {editingLabelIndex === i ? (
                                                        <input
                                                            className="border-b border-blue-400 outline-none bg-transparent text-gray-600 min-w-0 w-16 text-xs"
                                                            value={displayLabel}
                                                            onChange={e => setKioskLabelOverrides(prev => ({ ...(prev || {}), [i]: e.target.value }))}
                                                            onBlur={() => setEditingLabelIndex(null)}
                                                            autoFocus
                                                            style={{ lineHeight: 1 }}
                                                        />
                                                    ) : (
                                                        <span className="text-gray-400 truncate min-w-0 cursor-pointer hover:text-blue-500" title={displayLabel} onClick={() => setEditingLabelIndex(i)} style={{ lineHeight: 1 }}>{displayLabel}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {(kioskOverrides || kioskLabelOverrides) && <button onClick={() => { setKioskOverrides(null); setKioskLabelOverrides(null); }} className="text-xs text-red-400 hover:text-red-600 mt-1">Reset</button>}
                                </div>
                            )}
                        </div>
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
