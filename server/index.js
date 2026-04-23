const express = require("express");
const axios = require("axios");
const puppeteer = require("puppeteer");
const app = express();
const PORT = 3000;
const cheerio = require('cheerio');
const cors = require("cors");
const { Cluster } = require('puppeteer-cluster');

let cluster;

app.use(cors());

app.use(express.json())

app.use(express.urlencoded({ extended: true }));

// Cache for TeraBox direct URLs
const urlCache = new Map();


const VIDEO_URL =
    "https://video-downloads.googleusercontent.com/ADGPM2mfKyU9xV4YC-i2OwpVJ62p3TjHVwvzR48CFRGwLfuSqNeHIgaMuIukb3i59Z0U3xQIBsPi1c7LYUV6BnT2KYhGWviGGiDJPWqmqc_7Cr2WjNlkD_SpVnEBmqsDwYgUnNQdz8nR_LVSYDU79sC-YGHFUBNQXQ1-UAJJwlGevUdB041TM4FK4G6gCK1actoDM-w-RnsZusXG5lIZQU2FKld3DlsnG20GUx7MsfJZWFHPiQa84NqbW8ZckG1wnVLOrH0vZj_P";

app.get("/google-video", async (req, res) => {
    try {
        const videoUrl = req.query.url;

        const response = await axios({
            method: "get",
            url: videoUrl,
            responseType: "stream",
            headers: {
                Range: req.headers.range || "bytes=0-",
                "User-Agent": req.headers["user-agent"],
                Referer: "https://drive.google.com/",
                Accept: "*/*",
                "Accept-Encoding": "identity",
            },
            validateStatus: () => true,
        });

        res.writeHead(response.status, {
            ...response.headers,
            "Access-Control-Allow-Origin": "*",
        });

        response.data.pipe(res);
    } catch (err) {
        console.error("Streaming error:", err.message);
        res.status(500).send("Video stream failed");
    }
});

// Function to extract direct video URL from TeraBox using Puppeteer
async function getTeraBoxDirectUrl(sharingUrl) {
    // Check cache first
    if (urlCache.has(sharingUrl)) {
        const cached = urlCache.get(sharingUrl);
        if (Date.now() - cached.timestamp < 300000) { // 5 minutes cache
            console.log("Using cached URL for:", sharingUrl);
            return cached.url;
        }
    }

    console.log("Extracting TeraBox URL with Puppeteer...");

    let browser = null;
    try {
        // Launch Puppeteer with proper configuration
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ]
        });

        const page = await browser.newPage();

        // Set user agent to look like a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Listen for network responses
        let videoUrl = null;
        let downloadUrl = null;

        page.on('response', async (response) => {
            const url = response.url();
            const status = response.status();

            // Look for video files
            if (status === 200) {
                // Check by file extension
                if (url.match(/\.(mp4|avi|mkv|mov|flv|wmv|webm|m3u8)(\?|$)/i)) {
                    console.log("Found video URL:", url);
                    videoUrl = url;
                }

                // Check by content type
                const headers = response.headers();
                const contentType = headers['content-type'] || '';

                if (contentType.includes('video/') ||
                    contentType.includes('application/octet-stream') ||
                    contentType.includes('application/x-mpegURL')) {
                    console.log("Found video by content-type:", url, contentType);
                    videoUrl = url;
                }

                // Check for download links
                if (url.includes('download') && !downloadUrl) {
                    downloadUrl = url;
                }
            }
        });

        // Navigate to the sharing page
        console.log("Navigating to:", sharingUrl);
        await page.goto(sharingUrl, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Wait for page to load - FIXED HERE
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Try to find and click download/view buttons
        const clickSelectors = [
            'button',
            'a',
            '[class*="download"]',
            '[class*="play"]',
            '[class*="view"]'
        ];

        for (const selector of clickSelectors) {
            try {
                // Wait for the element
                await page.waitForSelector(selector, { timeout: 1000 }).catch(() => null);

                // Check if element contains text we want
                const elements = await page.$$(selector);
                for (const element of elements) {
                    const text = await page.evaluate(el => el.textContent.toLowerCase(), element);
                    if (text.includes('download') || text.includes('view') || text.includes('play')) {
                        console.log("Clicking element with text:", text);
                        await element.click();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        break;
                    }
                }
            } catch (e) {
                // Continue to next selector
            }
        }

        // Wait for more network activity
        await new Promise(resolve => setTimeout(resolve, 5000));

        // If no video URL found in network requests, try to extract from page
        if (!videoUrl) {
            videoUrl = await page.evaluate(() => {
                // Try to get video element source
                const video = document.querySelector('video');
                if (video) {
                    return video.src || video.currentSrc || video.querySelector('source')?.src;
                }

                // Look for iframe
                const iframe = document.querySelector('iframe');
                if (iframe && iframe.src) {
                    return iframe.src;
                }

                // Look for data attributes
                const elements = document.querySelectorAll('[data-url], [data-src], [data-video-url]');
                for (const el of elements) {
                    const url = el.getAttribute('data-url') ||
                        el.getAttribute('data-src') ||
                        el.getAttribute('data-video-url');
                    if (url && url.includes('http')) {
                        return url;
                    }
                }

                return null;
            });
        }

        // Close browser
        await browser.close();

        // Use download URL if no video URL found
        const finalUrl = videoUrl || downloadUrl;

        if (finalUrl) {
            // Cache the URL
            urlCache.set(sharingUrl, {
                url: finalUrl,
                timestamp: Date.now()
            });
            console.log("Extracted URL:", finalUrl);
            return finalUrl;
        } else {
            console.log("No video or download URL found");
            return null;
        }

    } catch (error) {
        console.error("Puppeteer error:", error.message);
        if (browser) {
            await browser.close();
        }
        return null;
    }
}

/* =========================
   1️⃣ INIT CLUSTER (ONLY ONCE)
========================= */
async function initCluster() {
    if (!cluster) {
        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE,
            maxConcurrency: 5, // 🔥 Adjust based on RAM
            puppeteerOptions: {
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
            },
            timeout: 60000,
        });

        console.log("✅ Puppeteer Cluster Started");

        cluster.on("taskerror", (err, data) => {
            console.error(`Error crawling ${data}:`, err.message);
        });
    }
}

initCluster();

/* =========================
   2️⃣ AUTO SCROLL FUNCTION
========================= */
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });
}

/* =========================
   3️⃣ GET STREAM LINK FROM VIDEO PAGE
========================= */
async function getStreamLinkFromVid(url) {
    return cluster.execute(url, async ({ page, data }) => {

        await page.goto(data, { waitUntil: "networkidle2" });

        await autoScroll(page);

        const html = await page.content();
        const $ = cheerio.load(html);

        let stream_link = null;

        $("video").each((i, el) => {
            const src = $(el).attr("src");
            if (src && src.includes("stream")) {
                stream_link = `https://dm.terabox.app${src}`;
            }
        });

        return stream_link;
    });
}

/* =========================
   4️⃣ HANDLE MP4 LOGIC
========================= */
async function handleMp4(element, url, file_type) {

    const img_tag = element.find("img").attr("src");
    if (!img_tag) return null;

    const urlObject = new URL(img_tag);
    const fidValue = urlObject.searchParams.get("fid");
    if (!fidValue) return null;

    const parts = fidValue.split("-");
    const numberYouWant = parts[parts.length - 1];

    const urlObj = new URL(url);
    const surl = urlObj.searchParams.get("surl");
    if (!surl) return null;

    let newUrl = new URL(urlObj.origin + urlObj.pathname);
    newUrl.searchParams.set("surl", surl);

    newUrl = `${newUrl.toString()}&dir=&fsid=${numberYouWant}&fileName=${file_type}`;
    newUrl = newUrl.replace("link", "videoPlay");

    return await getStreamLinkFromVid(newUrl);
}

/* =========================
   5️⃣ MAIN CRAWL FUNCTION
========================= */
async function crawlDynamicContent(url) {

    return cluster.execute(url, async ({ page, data }) => {

        await page.goto(data, { waitUntil: "networkidle2" });

        await page.waitForSelector(".content-class", { timeout: 5000 })
            .catch(() => {});

        await autoScroll(page);

        const html = await page.content();
        const $ = cheerio.load(html);

        const stream_link = [];
        const multi_files = [];

        $("video").each((i, el) => {
            const src = $(el).attr("src");
            if (src && src.includes("stream")) {
                stream_link.push(`https://dm.terabox.app${src}`);
            }
        });

        if (stream_link.length > 0) {
            return stream_link;
        }

        const promises = [];

        $(".common-file-item").each((i, el) => {

            const file_type = $(el).find(".file-item-name-text").text();

            if (file_type.includes(".jpg")) {
                const img = $(el).find("img").attr("src");
                multi_files.push(img);
            }

            if (file_type.includes(".mp4")) {
                promises.push(
                    handleMp4($(el), data, file_type)
                );
            }
        });

        const mp4Results = await Promise.all(promises);
        multi_files.push(...mp4Results.filter(Boolean));

        return multi_files;
    });
}

// Video stream proxy for TeraBox
app.get("/terabox-video", async (req, res) => {
    try {
        const sharingUrl = req.query.url;

        if (!sharingUrl) {
            return res.status(400).json({ error: "Missing URL parameter" });
        }

        console.log("Processing TeraBox URL:", sharingUrl);

        // Get direct video URL
        const directUrl = await getTeraBoxDirectUrl(sharingUrl);

        if (!directUrl) {
            return res.status(404).json({
                error: "Could not extract video URL",
                message: "The TeraBox link might require login or the video is not accessible"
            });
        }

        console.log("Streaming from direct URL:", directUrl);

        // Stream the video with proper headers
        const response = await axios({
            method: "get",
            url: directUrl,
            responseType: "stream",
            headers: {
                Range: req.headers.range || "",
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.1024tera.com/",
                "Accept": "*/*",
                "Accept-Encoding": "identity"
            }
        });

        // Get headers from response
        const headers = { ...response.headers };

        // Set proper content type if not present
        if (!headers["content-type"] || headers["content-type"].includes("text/html")) {
            headers["content-type"] = "video/mp4";
        }

        // Add CORS headers
        headers["Access-Control-Allow-Origin"] = "*";
        headers["Access-Control-Allow-Headers"] = "Range";
        headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Range";

        // Set response headers
        res.writeHead(response.status, headers);

        // Pipe the stream
        response.data.pipe(res);

        // Handle stream errors
        response.data.on('error', (err) => {
            console.error("Stream error:", err.message);
            res.end();
        });

        res.on('close', () => {
            response.data.destroy();
        });

    } catch (err) {
        console.error("TeraBox streaming error:", err.message);

        if (err.response) {
            console.error("Response status:", err.response.status);
            console.error("Response headers:", err.response.headers);
        }

        res.status(500).json({
            error: "Streaming failed",
            message: err.message
        });
    }
});

// Alternative: Direct proxy without extraction (for testing)
app.get("/terabox-direct", async (req, res) => {
    try {
        const videoUrl = req.query.url;

        if (!videoUrl) {
            return res.status(400).send("Missing video URL");
        }

        console.log("Direct streaming from:", videoUrl);

        const response = await axios({
            method: "get",
            url: videoUrl,
            responseType: "stream",
            headers: {
                Range: req.headers.range || "",
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://www.1024tera.com/"
            }
        });

        res.writeHead(response.status, response.headers);
        response.data.pipe(res);

    } catch (err) {
        console.error("Direct streaming error:", err.message);
        res.status(500).send("Error: " + err.message);
    }
});

// Simple test endpoint to check extraction
app.post("/test-extract", async (req, res) => {
    let sharingUrl = req.body.url;

    if (sharingUrl.includes('%3A') || sharingUrl.includes('%2F') || sharingUrl.includes('%3F')) {
        console.log("URL appears to be encoded, decoding...");
        sharingUrl = decodeURIComponent(sharingUrl);
    }

    try {
        const directUrl = await crawlDynamicContent(sharingUrl);

        res.json({
            success: !!directUrl,
            sharingUrl: sharingUrl,
            directUrl: directUrl,
            cached: urlCache.has(sharingUrl),
            message: directUrl ? "URL extracted successfully" : "Failed to extract URL"
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// Simple HTML page for testing
// app.get("/", (req, res) => {
//     res.send(`
// <!DOCTYPE html>
// <html>
// <head>
//     <title>TeraBox Video Streamer</title>
//     <style>
//         * {
//             box-sizing: border-box;
//             margin: 0;
//             padding: 0;
//         }

//         body {
//             font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
//             background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//             min-height: 100vh;
//             padding: 20px;
//             display: flex;
//             justify-content: center;
//             align-items: center;
//         }

//         .container {
//             background: white;
//             border-radius: 20px;
//             padding: 40px;
//             box-shadow: 0 20px 60px rgba(0,0,0,0.3);
//             max-width: 800px;
//             width: 100%;
//         }

//         h1 {
//             color: #333;
//             margin-bottom: 10px;
//             font-size: 2.5em;
//             background: linear-gradient(90deg, #667eea, #764ba2);
//             -webkit-background-clip: text;
//             -webkit-text-fill-color: transparent;
//         }

//         .subtitle {
//             color: #666;
//             margin-bottom: 30px;
//             font-size: 1.1em;
//         }

//         .url-input {
//             width: 100%;
//             padding: 15px;
//             border: 2px solid #e0e0e0;
//             border-radius: 10px;
//             font-size: 16px;
//             margin-bottom: 20px;
//             transition: border-color 0.3s;
//         }

//         .url-input:focus {
//             outline: none;
//             border-color: #667eea;
//         }

//         .button-group {
//             display: flex;
//             gap: 15px;
//             margin-bottom: 30px;
//             flex-wrap: wrap;
//         }

//         button {
//             padding: 15px 30px;
//             border: none;
//             border-radius: 10px;
//             font-size: 16px;
//             font-weight: 600;
//             cursor: pointer;
//             transition: all 0.3s;
//             flex: 1;
//             min-width: 200px;
//         }

//         .primary-btn {
//             background: linear-gradient(90deg, #667eea, #764ba2);
//             color: white;
//         }

//         .secondary-btn {
//             background: #f0f0f0;
//             color: #333;
//         }

//         button:hover {
//             transform: translateY(-2px);
//             box-shadow: 0 10px 20px rgba(0,0,0,0.2);
//         }

//         button:active {
//             transform: translateY(0);
//         }

//         .video-container {
//             background: #000;
//             border-radius: 10px;
//             overflow: hidden;
//             margin-top: 20px;
//             display: none;
//         }

//         video {
//             width: 100%;
//             display: block;
//         }

//         .controls {
//             display: flex;
//             gap: 10px;
//             margin-top: 20px;
//             justify-content: center;
//             flex-wrap: wrap;
//         }

//         .control-btn {
//             padding: 10px 20px;
//             background: #667eea;
//             color: white;
//             border: none;
//             border-radius: 5px;
//             cursor: pointer;
//         }

//         .status {
//             margin-top: 20px;
//             padding: 15px;
//             border-radius: 10px;
//             background: #f8f9fa;
//             display: none;
//         }

//         .status.success {
//             background: #d4edda;
//             color: #155724;
//             border: 1px solid #c3e6cb;
//         }

//         .status.error {
//             background: #f8d7da;
//             color: #721c24;
//             border: 1px solid #f5c6cb;
//         }

//         .status.info {
//             background: #d1ecf1;
//             color: #0c5460;
//             border: 1px solid #bee5eb;
//         }

//         .loader {
//             display: none;
//             text-align: center;
//             margin: 20px 0;
//         }

//         .loader:after {
//             content: " ";
//             display: inline-block;
//             width: 30px;
//             height: 30px;
//             border: 3px solid #e0e0e0;
//             border-radius: 50%;
//             border-top-color: #667eea;
//             animation: spin 1s ease-in-out infinite;
//         }

//         @keyframes spin {
//             to { transform: rotate(360deg); }
//         }

//         @media (max-width: 768px) {
//             .container {
//                 padding: 20px;
//             }

//             h1 {
//                 font-size: 2em;
//             }

//             button {
//                 min-width: 100%;
//             }
//         }
//     </style>
// </head>
// <body>
//     <div class="container">
//         <h1>🎬 TeraBox Video Streamer</h1>
//         <p class="subtitle">Stream videos directly from TeraBox sharing links</p>

//         <input 
//             type="text" 
//             class="url-input" 
//             id="urlInput" 
//             placeholder="Paste TeraBox sharing link here..."
//             value="https://www.1024tera.com/sharing/link?surl=RbDrfrI84tGUeu-7hCIgzQ"
//         >

//         <div class="button-group">
//             <button class="primary-btn" onclick="loadVideo()">
//                 ▶️ Load & Play Video
//             </button>
//             <button class="secondary-btn" onclick="testExtraction()">
//                 🔍 Test URL Extraction
//             </button>
//         </div>

//         <div class="loader" id="loader"></div>

//         <div class="status" id="status"></div>

//         <div class="video-container" id="videoContainer">
//             <video id="videoPlayer" controls>
//                 Your browser does not support the video tag.
//             </video>

//             <div class="controls">
//                 <button class="control-btn" onclick="skip(-10)">⏪ 10s</button>
//                 <button class="control-btn" onclick="skip(10)">⏩ 10s</button>
//                 <button class="control-btn" onclick="toggleFullscreen()">📺 Fullscreen</button>
//                 <button class="control-btn" onclick="togglePlay()">⏯️ Play/Pause</button>
//             </div>
//         </div>

//         <div class="status info" style="margin-top: 30px; display: block;">
//             <strong>Tips:</strong>
//             <ul style="margin-left: 20px; margin-top: 10px;">
//                 <li>Make sure the TeraBox link is publicly accessible</li>
//                 <li>Some videos may require login - those won't work</li>
//                 <li>Large videos may take a moment to start streaming</li>
//                 <li>Use the Test button to check if URL extraction works</li>
//             </ul>
//         </div>
//     </div>

//     <script>
//         let currentVideoUrl = '';

//         function showStatus(message, type = 'info') {
//             const statusDiv = document.getElementById('status');
//             statusDiv.textContent = message;
//             statusDiv.className = 'status ' + type;
//             statusDiv.style.display = 'block';
//         }

//         function showLoader(show) {
//             document.getElementById('loader').style.display = show ? 'block' : 'none';
//         }

//         function showVideo(show) {
//             document.getElementById('videoContainer').style.display = show ? 'block' : 'none';
//         }

//         async function loadVideo() {
//             const url = document.getElementById('urlInput').value.trim();
//             if (!url) {
//                 showStatus('Please enter a TeraBox URL', 'error');
//                 return;
//             }

//             showLoader(true);
//             showStatus('Extracting video URL... This may take up to 30 seconds', 'info');
//             showVideo(false);

//             try {
//                 const videoElement = document.getElementById('videoPlayer');
//                 const proxyUrl = '/terabox-video?url=' + encodeURIComponent(url);
//                 currentVideoUrl = proxyUrl;

//                 // Set video source
//                 videoElement.src = proxyUrl;

//                 // Load the video
//                 videoElement.load();

//                 // Show video container
//                 showVideo(true);
//                 showStatus('Video loaded successfully! Click play to start streaming.', 'success');

//             } catch (error) {
//                 showStatus('Error loading video: ' + error.message, 'error');
//             } finally {
//                 showLoader(false);
//             }
//         }

//         async function testExtraction() {
//             const url = document.getElementById('urlInput').value.trim();
//             if (!url) {
//                 showStatus('Please enter a URL to test', 'error');
//                 return;
//             }

//             showLoader(true);
//             showStatus('Testing URL extraction...', 'info');

//             try {
//                 const response = await fetch('/test-extract?url=' + encodeURIComponent(url));
//                 const data = await response.json();

//                 if (data.success) {
//                     showStatus('✅ URL extraction successful! Direct URL: ' + data.directUrl, 'success');
//                 } else {
//                     showStatus('❌ URL extraction failed: ' + (data.error || 'Unknown error'), 'error');
//                 }
//             } catch (error) {
//                 showStatus('Test failed: ' + error.message, 'error');
//             } finally {
//                 showLoader(false);
//             }
//         }

//         function skip(seconds) {
//             const video = document.getElementById('videoPlayer');
//             video.currentTime = Math.max(0, video.currentTime + seconds);
//         }

//         function toggleFullscreen() {
//             const video = document.getElementById('videoPlayer');
//             if (!document.fullscreenElement) {
//                 video.requestFullscreen().catch(err => {
//                     console.error('Fullscreen error:', err);
//                 });
//             } else {
//                 document.exitFullscreen();
//             }
//         }

//         function togglePlay() {
//             const video = document.getElementById('videoPlayer');
//             if (video.paused) {
//                 video.play();
//             } else {
//                 video.pause();
//             }
//         }

//         // Keyboard shortcuts
//         document.addEventListener('keydown', (e) => {
//             const video = document.getElementById('videoPlayer');
//             if (!video) return;

//             if (e.key === 'ArrowRight') skip(10);
//             if (e.key === 'ArrowLeft') skip(-10);
//             if (e.key === ' ') {
//                 e.preventDefault();
//                 togglePlay();
//             }
//             if (e.key === 'f') toggleFullscreen();
//         });

//         // Auto-load if URL is already in input
//         window.addEventListener('load', () => {
//             const urlInput = document.getElementById('urlInput');
//             if (urlInput.value.includes('terabox.com')) {
//                 // Auto-test extraction on page load
//                 setTimeout(() => testExtraction(), 1000);
//             }
//         });
//     </script>
// </body>
// </html>
//     `);
// });

app.get("/", async (req, res) => {
    const data = await crawlDynamicContent(`https://dm.1024tera.com/sharing/videoPlay?surl=j8Jo1c4mfi5MgZMX6bZPGg&dir=&fsid=96437928591150&fileName=01.mp4`);
    res.json({ html: data });
})

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📹 TeraBox streaming endpoint: http://localhost:${PORT}/terabox-video?url=YOUR_URL`);
    console.log(`🔍 Test extraction: http://localhost:${PORT}/test-extract`);
    console.log(`💡 For direct testing: http://localhost:${PORT}/terabox-direct?url=DIRECT_VIDEO_URL`);
});