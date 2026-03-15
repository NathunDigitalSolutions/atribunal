import { useState, useRef } from 'react';

function App() {
    const [caseNumber, setCaseNumber] = useState('');
    const [hearings, setHearings] = useState([]);
    const [displayCaseNo, setDisplayCaseNo] = useState('');
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState('');

    // Year-wise state
    const [year, setYear] = useState('');
    const [yearLoading, setYearLoading] = useState(false);
    const [yearProgress, setYearProgress] = useState([]);
    const [yearSummary, setYearSummary] = useState(null);
    const [yearError, setYearError] = useState('');
    const [yearDownloading, setYearDownloading] = useState(false);
    const [caseDownloading, setCaseDownloading] = useState({}); // { caseNo: boolean }
    const eventSourceRef = useRef(null);
    const progressEndRef = useRef(null);
    const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

    // Debugging: useful for seeing what URL is actually being hit in production
    if (import.meta.env.PROD) {
        console.log('Production mode detected');
        console.log('API_BASE being used:', API_BASE || '(none, using relative paths)');
    }

    const handleSearch = async () => {
        if (!caseNumber.trim()) {
            setError('Please enter a case number');
            return;
        }

        setLoading(true);
        setError('');
        setHearings([]);
        setDisplayCaseNo('');

        try {
            const res = await fetch(`${API_BASE}/api/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ caseNumber: caseNumber.trim() }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Search failed');
            }

            const data = await res.json();
            setHearings(data.hearings);
            setDisplayCaseNo(data.caseNumber);

            if (data.hearings.length === 0) {
                setError('No hearings found for this case number.');
            }
        } catch (err) {
            setError(err.message || 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadAll = async (targetCase) => {
        const caseToDownload = targetCase || caseNumber.trim();
        if (!caseToDownload) return;

        if (targetCase) {
            setCaseDownloading(prev => ({ ...prev, [targetCase]: true }));
        } else {
            setDownloading(true);
        }

        try {
            const res = await fetch(`${API_BASE}/api/download-all?caseNumber=${encodeURIComponent(caseToDownload)}`);
            if (!res.ok) throw new Error('Download failed');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${caseToDownload.replace(/\//g, '-')}_orders.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            if (targetCase) {
                setYearError(`Failed to download ${targetCase}. Please try again.`);
            } else {
                setError('Failed to download PDFs. Please try again.');
            }
        } finally {
            if (targetCase) {
                setCaseDownloading(prev => ({ ...prev, [targetCase]: false }));
            } else {
                setDownloading(false);
            }
        }
    };

    const handleYearDownload = () => {
        if (!year.trim()) {
            setYearError('Please enter a year');
            return;
        }

        setYearLoading(true);
        setYearError('');
        setYearProgress([]);
        setYearSummary(null);

        const url = `${API_BASE}/api/download-year?year=${encodeURIComponent(year.trim())}`;
        console.log('Connecting to SSE:', url);
        const evtSource = new EventSource(url);
        eventSourceRef.current = evtSource;

        evtSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'found') {
                setYearProgress(prev => [...prev, {
                    type: 'found',
                    caseNumber: data.caseNumber,
                    text: `✅ ${data.caseNumber} — ${data.hearings} hearing(s), ${data.totalFiles} total files`,
                }]);
            } else if (data.type === 'empty') {
                setYearProgress(prev => [...prev, {
                    type: 'empty',
                    text: `⬜ ${data.caseNumber} — no data`,
                }]);
            } else if (data.type === 'error') {
                setYearProgress(prev => [...prev, {
                    type: 'error',
                    text: `❌ ${data.caseNumber} — error`,
                }]);
            } else if (data.type === 'searching') {
                // no-op, just shows that we're scanning
            } else if (data.type === 'ready') {
                setYearSummary({
                    downloadId: data.downloadId,
                    totalFiles: data.totalFiles,
                    totalCases: data.totalCases,
                    year: data.year,
                });
                setYearLoading(false);
                evtSource.close();
            } else if (data.type === 'done' && data.totalFiles === 0) {
                setYearError('No cases found for this year.');
                setYearLoading(false);
                evtSource.close();
            }

            // Auto-scroll progress
            setTimeout(() => {
                progressEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        };

        evtSource.onerror = () => {
            setYearError('Connection lost. Please try again.');
            setYearLoading(false);
            evtSource.close();
        };
    };

    const handleYearZipDownload = async () => {
        if (!yearSummary) return;
        setYearDownloading(true);
        try {
            const res = await fetch(`${API_BASE}/api/download-year-zip?downloadId=${yearSummary.downloadId}&year=${yearSummary.year}`);
            if (!res.ok) throw new Error('Download failed');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `RC_${yearSummary.year}_all_orders.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setYearError('Failed to download ZIP. Please try again.');
        } finally {
            setYearDownloading(false);
        }
    };

    const stopYearDownload = () => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }
        setYearLoading(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleSearch();
    };

    const handleYearKeyDown = (e) => {
        if (e.key === 'Enter') handleYearDownload();
    };

    const casesFound = yearProgress.filter(p => p.type === 'found').length;
    const casesScanned = yearProgress.length;

    return (
        <div className="app">
            <div className="bg-glow bg-glow-1"></div>
            <div className="bg-glow bg-glow-2"></div>

            <header className="header">
                <div className="logo">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <h1>Tribunal PDF Downloader</h1>
                </div>
                <p className="subtitle">
                    Download hearing orders &amp; awards from MP Arbitration Tribunal
                </p>
            </header>

            <main className="main">
                {/* ===== Single Case Search ===== */}
                <div className="search-card">
                    <label htmlFor="caseInput" className="input-label">Case Number</label>
                    <div className="search-row">
                        <input
                            id="caseInput"
                            type="text"
                            className="search-input"
                            placeholder="e.g. RC-44/2022"
                            value={caseNumber}
                            onChange={(e) => setCaseNumber(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            className="btn btn-search"
                            onClick={handleSearch}
                            disabled={loading}
                            id="searchButton"
                        >
                            {loading ? (
                                <span className="spinner"></span>
                            ) : (
                                <>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <circle cx="11" cy="11" r="8" />
                                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                    </svg>
                                    Search
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="error-banner">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        {error}
                    </div>
                )}

                {hearings.length > 0 && (
                    <div className="results-card">
                        <div className="results-header">
                            <div>
                                <h2 className="results-title">Hearing Details</h2>
                                <p className="results-case">
                                    Case: <strong>{displayCaseNo}</strong> &mdash; {hearings.length} hearing(s) found
                                </p>
                            </div>
                            <button
                                className="btn btn-download"
                                onClick={handleDownloadAll}
                                disabled={downloading}
                                id="downloadAllButton"
                            >
                                {downloading ? (
                                    <>
                                        <span className="spinner spinner-light"></span>
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                        Download All PDFs
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="table-wrapper">
                            <table className="results-table" id="hearingsTable">
                                <thead>
                                    <tr>
                                        <th>S.No.</th>
                                        <th>Reason for Hearing</th>
                                        <th>Hearing Date</th>
                                        <th>Order / Award</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {hearings.map((h, idx) => (
                                        <tr key={idx}>
                                            <td className="cell-center">{h.sno}</td>
                                            <td>{h.reason}</td>
                                            <td className="cell-center">{h.date}</td>
                                            <td className="cell-center">
                                                {h.downloadUrl ? (
                                                    <a
                                                        href={h.downloadUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="download-link"
                                                    >
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                            <polyline points="7 10 12 15 17 10" />
                                                            <line x1="12" y1="15" x2="12" y2="3" />
                                                        </svg>
                                                        Download
                                                    </a>
                                                ) : (
                                                    <span className="no-link">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ===== Year-wise Bulk Download ===== */}
                <div className="divider">
                    <span className="divider-text">OR</span>
                </div>

                <div className="search-card year-card">
                    <label htmlFor="yearInput" className="input-label">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}>
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                            <line x1="16" y1="2" x2="16" y2="6" />
                            <line x1="8" y1="2" x2="8" y2="6" />
                            <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        Year-wise Bulk Download
                    </label>
                    <p className="year-desc">
                        Enter a year to download <strong>all</strong> case PDFs (RC-1/{year || '____'}, RC-2/{year || '____'}, ...).
                        Scanning stops after 5 consecutive empty cases.
                    </p>
                    <div className="search-row">
                        <input
                            id="yearInput"
                            type="number"
                            className="search-input"
                            placeholder="e.g. 2022"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            onKeyDown={handleYearKeyDown}
                            min="2000"
                            max="2030"
                        />
                        {yearLoading ? (
                            <button className="btn btn-stop" onClick={stopYearDownload} id="stopYearButton">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <rect x="6" y="6" width="12" height="12" rx="2" />
                                </svg>
                                Stop
                            </button>
                        ) : (
                            <button
                                className="btn btn-year"
                                onClick={handleYearDownload}
                                disabled={yearLoading}
                                id="yearDownloadButton"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                Scan &amp; Download
                            </button>
                        )}
                    </div>
                </div>

                {yearError && (
                    <div className="error-banner">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        {yearError}
                    </div>
                )}

                {(yearProgress.length > 0 || yearSummary) && (
                    <div className="results-card year-results">
                        <div className="results-header">
                            <div>
                                <h2 className="results-title">
                                    {yearLoading ? (
                                        <><span className="spinner spinner-small"></span> Scanning Year {year}...</>
                                    ) : (
                                        <>Scan Complete — Year {yearSummary?.year || year}</>
                                    )}
                                </h2>
                                <p className="results-case">
                                    Scanned {casesScanned} case(s) &mdash; <strong>{casesFound}</strong> with data
                                    {yearSummary && <> &mdash; <strong>{yearSummary.totalFiles}</strong> total files</>}
                                </p>
                            </div>
                            {yearSummary && (
                                <button
                                    className="btn btn-download"
                                    onClick={handleYearZipDownload}
                                    disabled={yearDownloading}
                                    id="yearZipButton"
                                >
                                    {yearDownloading ? (
                                        <>
                                            <span className="spinner spinner-light"></span>
                                            Preparing ZIP...
                                        </>
                                    ) : (
                                        <>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                <polyline points="7 10 12 15 17 10" />
                                                <line x1="12" y1="15" x2="12" y2="3" />
                                            </svg>
                                            Download {yearSummary.totalFiles} Files (ZIP)
                                        </>
                                    )}
                                </button>
                            )}
                        </div>

                        <div className="progress-log">
                            {yearProgress.map((p, i) => (
                                <div key={i} className={`progress-item progress-${p.type}`}>
                                    <span className="progress-text">{p.text}</span>
                                    {p.type === 'found' && p.caseNumber && (
                                        <button
                                            className="btn-tiny btn-case-download"
                                            onClick={() => handleDownloadAll(p.caseNumber)}
                                            disabled={caseDownloading[p.caseNumber]}
                                            title="Download ZIP for this case"
                                        >
                                            {caseDownloading[p.caseNumber] ? (
                                                <span className="spinner spinner-tiny"></span>
                                            ) : (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                    <polyline points="7 10 12 15 17 10" />
                                                    <line x1="12" y1="15" x2="12" y2="3" />
                                                </svg>
                                            )}
                                        </button>
                                    )}
                                </div>
                            ))}
                            <div ref={progressEndRef} />
                        </div>
                    </div>
                )}
            </main>

            <footer className="footer">
                <p>MP Arbitration Tribunal &bull; Case Document Downloader</p>
            </footer>
        </div>
    );
}

export default App;
