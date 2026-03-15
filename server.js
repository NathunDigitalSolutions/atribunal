import express from 'express';
import cors from 'cors';
import axios from 'axios';
import https from 'https';
import * as cheerio from 'cheerio';
import archiver from 'archiver';

const app = express();
const PORT = process.env.PORT || 3001;

// Create axios instance that skips SSL verification (government site has untrusted cert)
const api = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
});

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Search endpoint — proxies to tribunal API and returns structured data
app.post('/api/search', async (req, res) => {
    try {
        const { caseNumber } = req.body;
        if (!caseNumber) {
            return res.status(400).json({ error: 'Case number is required' });
        }

        const response = await api.post(
            'https://atribunal.mp.gov.in/Causedownload/getAwardOrderDetails/',
            `search_text=${encodeURIComponent(caseNumber)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                timeout: 30000,
            }
        );

        const html = response.data;
        const $ = cheerio.load(html);
        const hearings = [];

        $('table.table tbody tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 4) {
                const sno = $(cells[0]).text().trim();
                const reason = $(cells[1]).text().trim();
                const date = $(cells[2]).text().trim();
                const link = $(cells[3]).find('a').attr('href') || '';

                if (sno && date) {
                    hearings.push({
                        sno,
                        reason,
                        date,
                        downloadUrl: link,
                    });
                }
            }
        });

        // Try to get the case number from the table header
        let displayCaseNo = caseNumber;
        $('table.table thead tr').each((i, row) => {
            const th = $(row).find('th').first().text().trim();
            if (th === 'Case No.') {
                displayCaseNo = $(row).find('td').first().text().trim();
            }
        });

        res.json({ caseNumber: displayCaseNo, hearings });
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Failed to fetch case details. Please try again.' });
    }
});

// Download all PDFs as a ZIP
app.get('/api/download-all', async (req, res) => {
    try {
        const { caseNumber } = req.query;
        if (!caseNumber) {
            return res.status(400).json({ error: 'Case number is required' });
        }

        // First fetch the case details to get all download URLs
        const searchResponse = await api.post(
            'https://atribunal.mp.gov.in/Causedownload/getAwardOrderDetails/',
            `search_text=${encodeURIComponent(caseNumber)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                timeout: 30000,
            }
        );

        const html = searchResponse.data;
        const $ = cheerio.load(html);
        const downloads = [];

        $('table.table tbody tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 4) {
                const sno = $(cells[0]).text().trim();
                const date = $(cells[2]).text().trim();
                const link = $(cells[3]).find('a').attr('href') || '';
                if (sno && link) {
                    downloads.push({ sno, date, url: link });
                }
            }
        });

        if (downloads.length === 0) {
            return res.status(404).json({ error: 'No documents found for this case.' });
        }

        // Set response headers for ZIP download
        const safeCaseNumber = caseNumber.replace(/\//g, '-');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${safeCaseNumber}_orders.zip"`);

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to create ZIP' });
            }
        });
        archive.pipe(res);

        // Download each PDF and add to ZIP
        for (const item of downloads) {
            try {
                const pdfResponse = await api.get(item.url, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                });

                const safeDate = item.date.replace(/\s/g, '');
                const filename = `${safeCaseNumber}_${item.sno}_${safeDate}.pdf`;
                archive.append(Buffer.from(pdfResponse.data), { name: filename });
                console.log(`Added: ${filename}`);
            } catch (err) {
                console.error(`Failed to download item ${item.sno}:`, err.message);
                // Continue with remaining files even if one fails
            }
        }

        await archive.finalize();
    } catch (error) {
        console.error('Download error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to download documents.' });
        }
    }
});

// Helper: parse tribunal HTML and return download entries
function parseTribunalHtml(html) {
    const $ = cheerio.load(html);
    const hearings = [];
    let caseNo = '';

    $('table.table thead tr').each((i, row) => {
        const th = $(row).find('th').first().text().trim();
        if (th === 'Case No.') {
            caseNo = $(row).find('td').first().text().trim();
        }
    });

    $('table.table tbody tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 4) {
            const sno = $(cells[0]).text().trim();
            const reason = $(cells[1]).text().trim();
            const date = $(cells[2]).text().trim();
            const link = $(cells[3]).find('a').attr('href') || '';
            if (sno && date) {
                hearings.push({ sno, reason, date, downloadUrl: link });
            }
        }
    });

    return { caseNo, hearings };
}

// Year-wise bulk download — streams progress via SSE, then sends ZIP download URL
app.get('/api/download-year', async (req, res) => {
    const { year } = req.query;
    if (!year) {
        return res.status(400).json({ error: 'Year is required' });
    }

    // SSE setup for progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent buffering on Render/Nginx
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const allDownloads = []; // { caseNumber, sno, date, url }
    let caseIndex = 1;
    let consecutiveEmpty = 0;
    const MAX_CONSECUTIVE_EMPTY = 5; // stop after 5 consecutive cases with no data

    sendEvent({ type: 'start', message: `Starting year-wise download for ${year}...` });

    while (consecutiveEmpty < MAX_CONSECUTIVE_EMPTY) {
        const caseNumber = `RC-${caseIndex}/${year}`;
        sendEvent({ type: 'searching', caseNumber, caseIndex });

        try {
            const response = await api.post(
                'https://atribunal.mp.gov.in/Causedownload/getAwardOrderDetails/',
                `search_text=${encodeURIComponent(caseNumber)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    },
                    timeout: 30000,
                }
            );

            const { hearings } = parseTribunalHtml(response.data);

            if (hearings.length > 0) {
                consecutiveEmpty = 0;
                const downloads = hearings.filter(h => h.downloadUrl).map(h => ({
                    caseNumber,
                    sno: h.sno,
                    date: h.date,
                    url: h.downloadUrl,
                }));
                allDownloads.push(...downloads);
                sendEvent({
                    type: 'found',
                    caseNumber,
                    caseIndex,
                    hearings: hearings.length,
                    totalFiles: allDownloads.length,
                });
            } else {
                consecutiveEmpty++;
                sendEvent({ type: 'empty', caseNumber, caseIndex, consecutiveEmpty });
            }
        } catch (err) {
            consecutiveEmpty++;
            sendEvent({ type: 'error', caseNumber, caseIndex, message: err.message });
        }

        caseIndex++;
    }

    if (allDownloads.length === 0) {
        sendEvent({ type: 'done', message: 'No cases found for this year.', totalFiles: 0 });
        res.end();
        return;
    }

    sendEvent({
        type: 'downloading',
        message: `Found ${allDownloads.length} files across ${caseIndex - 1 - MAX_CONSECUTIVE_EMPTY} cases. Preparing ZIP...`,
        totalFiles: allDownloads.length,
    });

    // Now collect all PDFs and send as ZIP
    // We need to switch from SSE to binary — so we send a download token and use a separate endpoint
    const downloadId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    pendingDownloads.set(downloadId, allDownloads);

    sendEvent({
        type: 'ready',
        downloadId,
        totalFiles: allDownloads.length,
        totalCases: caseIndex - 1 - MAX_CONSECUTIVE_EMPTY,
        year,
    });

    res.end();
});

// In-memory store for pending year-wise downloads
const pendingDownloads = new Map();

// Serve the actual ZIP for year-wise downloads
app.get('/api/download-year-zip', async (req, res) => {
    const { downloadId, year } = req.query;
    const downloads = pendingDownloads.get(downloadId);

    if (!downloads || downloads.length === 0) {
        return res.status(404).json({ error: 'Download not found or expired.' });
    }

    pendingDownloads.delete(downloadId);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="RC_${year}_all_orders.zip"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to create ZIP' });
        }
    });
    archive.pipe(res);

    for (const item of downloads) {
        try {
            const pdfResponse = await api.get(item.url, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            });

            const safeCaseNumber = item.caseNumber.replace(/\//g, '-');
            const safeDate = item.date.replace(/\s/g, '');
            const filename = `${safeCaseNumber}/${safeCaseNumber}_${item.sno}_${safeDate}.pdf`;
            archive.append(Buffer.from(pdfResponse.data), { name: filename });
            console.log(`Added: ${filename}`);
        } catch (err) {
            console.error(`Failed to download ${item.caseNumber} item ${item.sno}:`, err.message);
        }
    }

    await archive.finalize();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
