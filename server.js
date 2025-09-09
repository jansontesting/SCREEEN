const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure multer for handling form data
const upload = multer();

// Global browser instance
let browser;

// Initialize browser on startup
async function initBrowser() {
  try {
   browser = await puppeteer.launch({
   headless: true,
   executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
   args: [
     '--no-sandbox',
     '--disable-setuid-sandbox',
     '--disable-dev-shm-usage',
     '--disable-accelerated-2d-canvas',
     '--no-first-run',
     '--no-zygote',
     '--single-process',
     '--disable-gpu'
   ]
 });

    console.log('Browser initialized successfully');
  } catch (error) {
    console.error('Failed to initialize browser:', error);
  }
}

// Initialize browser on startup
initBrowser();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'HTML to PNG service is running' });
});

// Root endpoint with API documentation
app.get('/', (req, res) => {
  res.json({
    service: 'HTML to PNG Converter',
    version: '1.0.0',
    endpoints: {
      'POST /convert': 'Convert HTML to PNG',
      'GET /health': 'Health check'
    },
    usage: {
      method: 'POST',
      url: '/convert',
      contentType: 'application/json',
      body: {
        html: 'HTML content as string',
        options: {
          width: 'viewport width (default: 1920)',
          height: 'viewport height (default: 1080)',
          fullPage: 'capture full page (default: true)',
          quality: 'image quality 0-100 (default: 100)',
          type: 'image type: png or jpeg (default: png)'
        }
      }
    },
    example: {
      html: '<html><body><h1>Hello World</h1></body></html>',
      options: {
        width: 800,
        height: 600,
        fullPage: true
      }
    }
  });
});

// Main conversion endpoint
app.post('/convert', upload.none(), async (req, res) => {
  try {
    const { html, options = {} } = req.body;

    if (!html) {
      return res.status(400).json({ 
        error: 'HTML content is required',
        received: typeof html
      });
    }

    // Default options
    const defaultOptions = {
      width: 1920,
      height: 1080,
      fullPage: true,
      quality: 100,
      type: 'png'
    };

    const config = { ...defaultOptions, ...options };

    // Validate image type
    if (!['png', 'jpeg'].includes(config.type)) {
      return res.status(400).json({ 
        error: 'Invalid image type. Use "png" or "jpeg"' 
      });
    }

    // Create new page
    const page = await browser.newPage();

    try {
      // Set viewport
      await page.setViewport({
        width: parseInt(config.width),
        height: parseInt(config.height)
      });

      // Set content
      await page.setContent(html, { 
        waitUntil: ['networkidle0', 'domcontentloaded'],
        timeout: 30000
      });

      // Wait a bit more for any dynamic content
      await page.waitForTimeout(1000);

      // Screenshot options
      const screenshotOptions = {
        type: config.type,
        fullPage: config.fullPage
      };

      // Add quality for JPEG
      if (config.type === 'jpeg') {
        screenshotOptions.quality = parseInt(config.quality);
      }

      // Take screenshot
      const screenshot = await page.screenshot(screenshotOptions);

      // Set response headers
      const mimeType = config.type === 'png' ? 'image/png' : 'image/jpeg';
      const filename = `converted.${config.type}`;

      res.set({
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': screenshot.length
      });

      // Send the image
      res.send(screenshot);

    } finally {
      // Always close the page
      await page.close();
    }

  } catch (error) {
    console.error('Conversion error:', error);
    
    // Handle specific errors
    if (error.name === 'TimeoutError') {
      return res.status(408).json({ 
        error: 'Request timeout. HTML content took too long to load.' 
      });
    }

    res.status(500).json({ 
      error: 'Internal server error during conversion',
      message: error.message
    });
  }
});

// Convert HTML from form data (alternative endpoint)
app.post('/convert-form', upload.single('html_file'), async (req, res) => {
  try {
    let html;

    // Get HTML from file upload or form field
    if (req.file) {
      html = req.file.buffer.toString();
    } else if (req.body.html) {
      html = req.body.html;
    } else {
      return res.status(400).json({ 
        error: 'HTML content required either as file upload or form field' 
      });
    }

    // Extract options from form
    const options = {};
    if (req.body.width) options.width = parseInt(req.body.width);
    if (req.body.height) options.height = parseInt(req.body.height);
    if (req.body.fullPage !== undefined) options.fullPage = req.body.fullPage === 'true';
    if (req.body.quality) options.quality = parseInt(req.body.quality);
    if (req.body.type) options.type = req.body.type;

    // Use the same conversion logic
    req.body = { html, options };
    return app._router.handle({ ...req, method: 'POST', url: '/convert' }, res);

  } catch (error) {
    console.error('Form conversion error:', error);
    res.status(500).json({ 
      error: 'Internal server error during form conversion',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: ['GET /', 'POST /convert', 'POST /convert-form', 'GET /health']
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`HTML to PNG service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API docs: http://localhost:${PORT}/`);
});
