import { useState } from 'react';

function App() {
    const [caseNumber, setCaseNumber] = useState('');
    const [hearings, setHearings] = useState([]);
    const [displayCaseNo, setDisplayCaseNo] = useState('');
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState('');

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
            const res = await fetch('/api/search', {
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

    const handleDownloadAll = async () => {
        setDownloading(true);
        try {
            const res = await fetch(`/api/download-all?caseNumber=${encodeURIComponent(caseNumber.trim())}`);
            if (!res.ok) throw new Error('Download failed');

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${caseNumber.trim().replace(/\//g, '-')}_orders.zip`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setError('Failed to download PDFs. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleSearch();
    };

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
            </main>

            <footer className="footer">
                <p>MP Arbitration Tribunal &bull; Case Document Downloader</p>
            </footer>
        </div>
    );
}

export default App;
