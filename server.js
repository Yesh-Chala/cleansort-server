import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables
dotenv.config();

const app = express();
// Railway sets PORT dynamically, but sometimes it's 0 - use fallback
const PORT = process.env.PORT && process.env.PORT !== '0' ? process.env.PORT : 3001;

// Logging middleware - log all requests
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
  next();
});

// CORS configuration - allow all origins for Railway deployment
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for file uploads
const multerStorage = multer.memoryStorage();
const upload = multer({ 
  storage: multerStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
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
let genAI;
console.log('=== Initializing Gemini AI ===');
console.log('Environment check:');
console.log('- PORT from env:', process.env.PORT);
console.log('- PORT using:', PORT);
console.log('- NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('- GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Set (hidden)' : '❌ Not set');

try {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY not configured - will use mock data');
  } else {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ Gemini AI initialized successfully');
  }
} catch (error) {
  console.error('❌ Failed to initialize Gemini AI:', error.message);
  console.error('Stack:', error.stack);
}

// City-specific prompts
const getCityPromptSuffix = (city) => {
  const cityPrompts = {
    'mumbai': '\n\nMumbai: Wet waste (green bins, daily), Dry waste (blue bins, twice weekly)',
    'delhi': '\n\nDelhi: Wet waste (daily collection), Dry waste (weekly collection)',
    'bangalore': '\n\nBangalore: Wet waste (daily), Dry waste (segregation mandatory)',
    'chennai': '\n\nChennai: Wet waste (daily), Dry waste (bi-weekly)',
    'kolkata': '\n\nKolkata: Wet waste (daily), Dry waste (weekly)',
    'hyderabad': '\n\nHyderabad: Wet waste (green bins, daily), Dry waste (bi-weekly)',
    'pune': '\n\nPune: Wet waste (daily), Dry waste (weekly)',
    'ahmedabad': '\n\nAhmedabad: Wet waste (daily), Dry waste (bi-weekly)'
  };
  
  return cityPrompts[city?.toLowerCase()] || '\n\nGeneral disposal guidelines';
};

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('✅ Health check requested');
  res.status(200).json({ 
    status: 'OK', 
    message: 'CleanSort OCR Server is running',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!genAI
  });
});

// Mock data storage (in production, this would be Firestore)
let mockItems = [];
let mockReminders = [];
let mockSettings = { city: '', onboarding: false };

// Items API endpoints
app.get('/api/items', (req, res) => {
  console.log('GET /api/items - Returning', mockItems.length, 'items');
  res.json(mockItems);
});

app.post('/api/items', (req, res) => {
  const item = {
    ...req.body,
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    createdAt: new Date().toISOString()
  };
  mockItems.push(item);
  console.log('POST /api/items - Added item:', item.id);
  res.json({ item });
});

app.delete('/api/items/:id', (req, res) => {
  const itemId = req.params.id;
  const index = mockItems.findIndex(item => item.id === itemId);
  if (index !== -1) {
    mockItems.splice(index, 1);
    console.log('DELETE /api/items - Removed item:', itemId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Item not found' });
  }
});

// Reminders API endpoints
app.get('/api/reminders', (req, res) => {
  console.log('GET /api/reminders - Returning', mockReminders.length, 'reminders');
  res.json(mockReminders);
});

// Settings API endpoints
app.get('/api/settings/city', (req, res) => {
  console.log('GET /api/settings/city - Returning city:', mockSettings.city);
  res.json(mockSettings.city);
});

app.put('/api/settings/city', (req, res) => {
  mockSettings.city = req.body.city || '';
  console.log('PUT /api/settings/city - Set city to:', mockSettings.city);
  res.json({ success: true });
});

app.get('/api/settings/onboarding', (req, res) => {
  console.log('GET /api/settings/onboarding - Returning:', mockSettings.onboarding);
  res.json(mockSettings.onboarding);
});

app.put('/api/settings/onboarding', (req, res) => {
  mockSettings.onboarding = req.body.completed || false;
  console.log('PUT /api/settings/onboarding - Set to:', mockSettings.onboarding);
  res.json({ success: true });
});

// Main OCR processing endpoint - NO AUTH for simplicity
app.post('/api/process-receipt', upload.single('image'), async (req, res) => {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('📸 OCR REQUEST RECEIVED');
  console.log('========================================');
  
  try {
    // Validate request
    if (!req.file) {
      console.log('❌ ERROR: No image file provided');
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }

    const { city } = req.body;
    console.log('📋 Request Details:');
    console.log('  - File:', req.file.originalname);
    console.log('  - Size:', (req.file.size / 1024).toFixed(2), 'KB');
    console.log('  - Type:', req.file.mimetype);
    console.log('  - City:', city || 'not specified');

    // Check if Gemini is initialized
    if (!genAI || !process.env.GEMINI_API_KEY) {
      console.log('⚠️  Gemini not configured, returning mock data');
      const mockData = getMockResults();
      console.log('✅ Returning', mockData.length, 'mock items');
      return res.json({
        success: true,
        items: mockData,
        fallback: true
      });
    }

    console.log('\n🤖 Processing with Gemini API...');
    console.log('  - Model: gemini-1.5-flash');
    console.log('  - City context:', city || 'general');

    // Prepare the prompt for Gemini
    const cityPromptSuffix = getCityPromptSuffix(city);
    const basePrompt = `Extract items from this receipt. Return JSON array with: name, quantity, category (dry/wet/recyclable/hazardous/medical/e-waste), disposalInterval (1-30 days), confidence (0.0-1.0).

Example: [{"name":"Milk","quantity":"1L","category":"recyclable","disposalInterval":3,"confidence":0.95}]`;
    const prompt = basePrompt + cityPromptSuffix;

    // Convert image to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    console.log('  - Image converted to base64');

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prepare the request
    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: mimeType
      }
    };

    console.log('  - Sending request to Gemini...');
    const apiStartTime = Date.now();
    
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const responseText = response.text();
    
    const apiDuration = Date.now() - apiStartTime;
    console.log('✅ Gemini response received in', apiDuration, 'ms');
    console.log('  - Response length:', responseText.length, 'chars');

    console.log('\n📝 Parsing response...');
    
    // Clean the response text
    let cleanText = responseText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      console.log('  - Removed ```json``` wrapper');
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      console.log('  - Removed ``` wrapper');
    }

    // Parse the JSON response
    console.log('  - Parsing JSON...');
    const items = JSON.parse(cleanText);
    console.log('  - Successfully parsed JSON');
    
    if (!Array.isArray(items)) {
      console.log('❌ ERROR: Response is not an array, got:', typeof items);
      throw new Error('Response is not an array');
    }
    console.log('  - Validated as array with', items.length, 'items');

    // Transform to match frontend interface
    const parsedItems = items.map((item, index) => {
      console.log(`  - Item ${index + 1}: ${item.name} (${item.category})`);
      return {
        id: `${Date.now()}-${index}`,
        name: item.name,
        quantity: item.quantity,
        category: item.category,
        interval: item.disposalInterval,
        confidence: item.confidence
      };
    });

    const totalDuration = Date.now() - startTime;
    console.log('\n✅ SUCCESS - Returning', parsedItems.length, 'items');
    console.log('⏱️  Total processing time:', totalDuration, 'ms');
    console.log('========================================\n');

    res.json({
      success: true,
      items: parsedItems,
      count: parsedItems.length,
      city: city,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.log('\n❌ ERROR OCCURRED');
    console.log('  - Error type:', error.name);
    console.log('  - Error message:', error.message);
    console.log('  - Duration before error:', totalDuration, 'ms');
    if (error.stack) {
      console.log('  - Stack trace:', error.stack.split('\n').slice(0, 3).join('\n'));
    }
    console.log('  - Falling back to mock data');
    console.log('========================================\n');
    
    // Return fallback mock data on error
    const mockData = getMockResults();
    res.json({
      success: true,
      items: mockData,
      count: mockData.length,
      fallback: true,
      error: error.message
    });
  }
});

// Helper function for mock results
function getMockResults() {
  return [
    {
      id: `${Date.now()}-1`,
      name: "Organic Milk 1L",
      quantity: "1 bottle",
      category: "recyclable",
      interval: 3,
      confidence: 0.95
    },
    {
      id: `${Date.now()}-2`,
      name: "Bananas",
      quantity: "1.2 kg",
      category: "wet",
      interval: 1,
      confidence: 0.88
    },
    {
      id: `${Date.now()}-3`,
      name: "Bread Loaf",
      quantity: "1 pack",
      category: "dry",
      interval: 7,
      confidence: 0.92
    }
  ];
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.log('\n⚠️  MIDDLEWARE ERROR HANDLER');
  console.log('  - Error:', error.message);
  console.log('  - Path:', req.path);
  console.log('  - Method:', req.method);
  
  if (error instanceof multer.MulterError) {
    console.log('  - Type: Multer Error');
    if (error.code === 'LIMIT_FILE_SIZE') {
      console.log('  - Reason: File too large');
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 50MB.'
      });
    }
  }
  
  console.log('  - Type: General server error');
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('⚠️  404 - Endpoint not found:', req.method, req.originalUrl);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('🚀 CleanSort OCR Server Started');
  console.log('========================================');
  console.log('Server Info:');
  console.log('  - Port:', PORT);
  console.log('  - Host: 0.0.0.0 (all interfaces)');
  console.log('  - Environment:', process.env.NODE_ENV || 'development');
  console.log('  - Gemini AI:', genAI ? '✅ Configured' : '⚠️  Not configured (using mock data)');
  console.log('\nAvailable Endpoints:');
  console.log('  - GET  /health');
  console.log('  - POST /api/process-receipt');
  console.log('  - GET  /api/items');
  console.log('  - POST /api/items');
  console.log('  - DELETE /api/items/:id');
  console.log('  - GET  /api/reminders');
  console.log('  - GET  /api/settings/city');
  console.log('  - PUT  /api/settings/city');
  console.log('  - GET  /api/settings/onboarding');
  console.log('  - PUT  /api/settings/onboarding');
  console.log('\n✅ Server is ready to accept requests');
  console.log('========================================\n');
});

export default app;
