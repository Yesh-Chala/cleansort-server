import express from 'express';
import cors from 'cors';
import multer from 'multer';

import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 0;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000'
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// City-specific prompts (copied from frontend)
const getCityPromptSuffix = (city) => {
  const cityPrompts = {
    'mumbai': '\n\nMumbai-specific disposal rules:\n- Wet waste: Collected daily, use green bins\n- Dry waste: Collected twice weekly, use blue bins\n- Hazardous waste: Drop at designated collection points\n- E-waste: Special collection centers available',
    'delhi': '\n\nDelhi-specific disposal rules:\n- Wet waste: Composting encouraged, daily collection\n- Dry waste: Segregation mandatory, weekly collection\n- Hazardous waste: Special handling required\n- E-waste: Authorized recyclers only',
    'bangalore': '\n\nBangalore-specific disposal rules:\n- Wet waste: Daily collection, composting preferred\n- Dry waste: Segregation at source mandatory\n- Hazardous waste: Special collection days\n- E-waste: BBMP collection centers',
    'chennai': '\n\nChennai-specific disposal rules:\n- Wet waste: Daily collection, use designated bins\n- Dry waste: Segregation required, bi-weekly collection\n- Hazardous waste: Special handling protocols\n- E-waste: Corporation collection points',
    'kolkata': '\n\nKolkata-specific disposal rules:\n- Wet waste: Daily collection, composting encouraged\n- Dry waste: Segregation mandatory, weekly collection\n- Hazardous waste: Special collection centers\n- E-waste: Authorized dealers only',
    'hyderabad': '\n\nHyderabad-specific disposal rules:\n- Wet waste: Daily collection, use green bins\n- Dry waste: Segregation at source, bi-weekly collection\n- Hazardous waste: Special handling required\n- E-waste: GHMC collection centers',
    'pune': '\n\nPune-specific disposal rules:\n- Wet waste: Daily collection, composting preferred\n- Dry waste: Segregation mandatory, weekly collection\n- Hazardous waste: Special collection days\n- E-waste: PMC collection points',
    'ahmedabad': '\n\nAhmedabad-specific disposal rules:\n- Wet waste: Daily collection, use designated bins\n- Dry waste: Segregation required, bi-weekly collection\n- Hazardous waste: Special handling protocols\n- E-waste: AMC collection centers'
  };
  
  return cityPrompts[city?.toLowerCase()] || '\n\nGeneral disposal guidelines:\n- Wet waste: Compost or daily collection\n- Dry waste: Recycle when possible\n- Hazardous waste: Special handling required\n- E-waste: Authorized recyclers only';
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'CleanSort OCR Server is running',
    timestamp: new Date().toISOString()
  });
});

// Main OCR processing endpoint
app.post('/api/process-receipt', upload.single('image'), async (req, res) => {
  try {
    console.log('=== OCR SERVER: Processing receipt ===');
    
    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY not found in environment variables');
      return res.status(500).json({
        error: 'Server configuration error: GEMINI_API_KEY not found'
      });
    }

    // Validate request
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided'
      });
    }

    const { city } = req.body;
    console.log('Received city:', city);
    console.log('Image file:', req.file.originalname, req.file.size, 'bytes');

    // Get city-specific prompt
    const cityPromptSuffix = getCityPromptSuffix(city);
    console.log('City prompt suffix:', cityPromptSuffix);

    // Prepare the prompt for Gemini
    const basePrompt = `Extract items from this receipt. Return JSON array with: name, quantity, category (dry/wet/recyclable/hazardous/medical/e-waste), disposalInterval (1-30 days), confidence (0.0-1.0).

Example: [{"name":"Milk","quantity":"1L","category":"recyclable","disposalInterval":3,"confidence":0.95}]`;

    const prompt = basePrompt + cityPromptSuffix;

    // Convert image to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log('Processing with Gemini API...');

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Prepare the request
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: mimeType
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const responseText = response.text();

    console.log('Gemini response received:', responseText);

    // Clean the response text (remove markdown code blocks if present)
    let cleanText = responseText.trim();
    
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    console.log('Cleaned response text:', cleanText);

    // Parse the JSON response
    let items;
    try {
      items = JSON.parse(cleanText);
      console.log('Parsed JSON items:', items);
      console.log('Number of items parsed:', items.length);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Failed to parse text:', cleanText);
      throw new Error(`Failed to parse JSON response: ${parseError.message}`);
    }

    // Validate items structure
    if (!Array.isArray(items)) {
      console.error('Response is not an array:', items);
      throw new Error('Response is not an array');
    }

    // Transform to match frontend ParsedItem interface
    const parsedItems = items.map((item, index) => {
      console.log(`Processing item ${index}:`, item);
      
      return {
        id: `${Date.now()}-${index}`,
        name: item.name,
        quantity: item.quantity,
        category: item.category,
        interval: item.disposalInterval,
        confidence: item.confidence,
      };
    });

    console.log('Final parsed items array:', parsedItems);
    console.log('Total items to return:', parsedItems.length);

    // Return the parsed items
    res.json({
      success: true,
      items: parsedItems,
      count: parsedItems.length,
      city: city,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('OCR processing error:', error);
    
    // Return fallback mock data on error
    console.log('Falling back to mock data...');
    const mockResults = [
      {
        id: `${Date.now()}-1`,
        name: "Organic Milk 1L",
        quantity: "1 bottle",
        category: "recyclable",
        interval: 3,
        confidence: 0.95,
      },
      {
        id: `${Date.now()}-2`,
        name: "Bananas",
        quantity: "1.2 kg",
        category: "wet",
        interval: 1,
        confidence: 0.88,
      },
      {
        id: `${Date.now()}-3`,
        name: "Bread Loaf",
        quantity: "1 pack",
        category: "dry",
        interval: 7,
        confidence: 0.92,
      },
    ];

    res.json({
      success: true,
      items: mockResults,
      count: mockResults.length,
      city: req.body.city,
      timestamp: new Date().toISOString(),
      fallback: true,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum size is 10MB.'
      });
    }
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
const server = app.listen(PORT, () => {
  const actualPort = server.address().port;
  console.log(`🚀 CleanSort OCR Server running on port ${actualPort}`);
  console.log(`📡 Health check: http://localhost:${actualPort}/health`);
  console.log(`🔍 OCR endpoint: http://localhost:${actualPort}/api/process-receipt`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY not found in environment variables');
    console.warn('   Please create a .env file with your Gemini API key');
  }
});

export default app;
