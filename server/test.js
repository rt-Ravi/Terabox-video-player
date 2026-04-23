const express = require('express');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 5000;

const crawlDynamicContent = async (url) => {
  // Launch browser in headless mode (no UI)
  const browser = await puppeteer.launch({ 
    headless: true,           // Changed to true for headless operation
    defaultViewport: null,     // Full viewport (still works headless)
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Often needed on Linux servers
  });
  
  const page = await browser.newPage();
  
  try {
    await page.goto(url, { waitUntil: 'networkidle0' });
    
    // Optional: wait for a specific element if needed
    await page.waitForSelector('.content-class', { timeout: 5000 })
      .catch(() => console.log('Selector not found, continuing anyway'));
    
    // Scroll to bottom to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    
    // Wait for any additional content
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Extract the fully loaded HTML
    const html = await page.content();

    const $ = cheerio.load(html);

    const stream_link = [];

   $('video').each((i, el) => {
        let src = $(el).attr('src');
        if(src.includes('stream')){
            stream_link.push(src);
        }
    })


    if(stream_link){
        return stream_link;
    }
    
  } catch (error) {
    console.error('Error during crawl:', error);
    throw error; // Rethrow to handle in route
  } finally {
    await browser.close();
  }
};

// Health check route
app.get('/', async (req, res) => {
  try {
    const data = await crawlDynamicContent('https://www.terabox.app/sharing/link?surl=24Y8vtwLNq7rrvOFH3Q-0g');
    res.json({ stream_link: `https://dm.terabox.app${data}`});
  } catch (error) {
    res.status(500).json({ error: 'Crawling failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});