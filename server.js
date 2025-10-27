import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

// Initialize Firebase Admin
let db;
console.log('=== Initializing Firebase Admin ===');
try {
  if (!getApps().length) {
    // Use service account key if available, otherwise use project ID
    const firebaseConfig = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
      : { projectId: process.env.FIREBASE_PROJECT_ID || 'clean-sort' };
    
    initializeApp({
      credential: process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
        ? cert(firebaseConfig)
        : undefined,
      projectId: firebaseConfig.project_id || firebaseConfig.projectId || 'clean-sort',
    });
  }
  db = getFirestore();
  console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin:', error.message);
  console.log('⚠️  Will use mock data storage');
}

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
app.get('/api/items', async (req, res) => {
  try {
    if (db) {
      // Use Firebase Firestore
      const itemsSnapshot = await db.collection('items').get();
      const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('GET /api/items - Returning', items.length, 'items from Firestore');
      res.json({ success: true, data: items });
    } else {
      // Fallback to mock data
      console.log('GET /api/items - Returning', mockItems.length, 'items from mock data');
      res.json({ success: true, data: mockItems });
    }
  } catch (error) {
    console.error('Error getting items:', error);
    res.status(500).json({ error: 'Failed to get items' });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const itemData = {
      ...req.body,
      createdAt: new Date().toISOString()
    };
    
    if (db) {
      // Use Firebase Firestore
      const docRef = await db.collection('items').add(itemData);
      const item = { id: docRef.id, ...itemData };
      
      // Create automatic reminder for the item
      const disposalDate = new Date();
      disposalDate.setDate(disposalDate.getDate() + itemData.interval);
      
      const reminderData = {
        itemId: docRef.id,
        itemName: itemData.name,
        category: itemData.category,
        dueDate: disposalDate.toISOString(),
        status: "upcoming",
        createdAt: new Date().toISOString()
      };
      
      const reminderRef = await db.collection('reminders').add(reminderData);
      const reminder = { id: reminderRef.id, ...reminderData };
      
      console.log('POST /api/items - Added item and reminder to Firestore:', docRef.id, reminderRef.id);
      res.json({ success: true, data: { item, reminder } });
    } else {
      // Fallback to mock data
      const item = {
        ...itemData,
        id: Date.now().toString(36) + Math.random().toString(36).substr(2)
      };
      mockItems.push(item);
      
      // Create mock reminder
      const disposalDate = new Date();
      disposalDate.setDate(disposalDate.getDate() + itemData.interval);
      
      const reminder = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        itemId: item.id,
        itemName: itemData.name,
        category: itemData.category,
        dueDate: disposalDate.toISOString(),
        status: "upcoming",
        createdAt: new Date().toISOString()
      };
      mockReminders.push(reminder);
      
      console.log('POST /api/items - Added item and reminder to mock data:', item.id, reminder.id);
      res.json({ success: true, data: { item, reminder } });
    }
  } catch (error) {
    console.error('Error saving item:', error);
    res.status(500).json({ error: 'Failed to save item' });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    const itemId = req.params.id;
    
    if (db) {
      // Use Firebase Firestore
      await db.collection('items').doc(itemId).delete();
      
      // Also delete associated reminders
      const remindersSnapshot = await db.collection('reminders')
        .where('itemId', '==', itemId)
        .get();
      
      const deletePromises = remindersSnapshot.docs.map(doc => doc.ref.delete());
      await Promise.all(deletePromises);
      
      console.log('DELETE /api/items - Removed item and', remindersSnapshot.size, 'reminders from Firestore:', itemId);
      res.json({ success: true });
    } else {
      // Fallback to mock data
      const index = mockItems.findIndex(item => item.id === itemId);
      if (index !== -1) {
        mockItems.splice(index, 1);
        
        // Remove associated reminders
        const reminderIndices = mockReminders
          .map((reminder, idx) => reminder.itemId === itemId ? idx : -1)
          .filter(idx => idx !== -1)
          .reverse(); // Delete from end to avoid index shifting
        
        reminderIndices.forEach(idx => mockReminders.splice(idx, 1));
        
        console.log('DELETE /api/items - Removed item and', reminderIndices.length, 'reminders from mock data:', itemId);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Item not found' });
      }
    }
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Reminders API endpoints
app.get('/api/reminders', async (req, res) => {
  try {
    if (db) {
      // Use Firebase Firestore
      const remindersSnapshot = await db.collection('reminders').get();
      const reminders = remindersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('GET /api/reminders - Returning', reminders.length, 'reminders from Firestore');
      res.json({ success: true, data: reminders });
    } else {
      // Fallback to mock data
      console.log('GET /api/reminders - Returning', mockReminders.length, 'reminders from mock data');
      res.json({ success: true, data: mockReminders });
    }
  } catch (error) {
    console.error('Error getting reminders:', error);
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

// Settings API endpoints
app.get('/api/settings/city', async (req, res) => {
  try {
    if (db) {
      // Use Firebase Firestore
      const settingsDoc = await db.collection('settings').doc('user').get();
      const city = settingsDoc.exists ? settingsDoc.data().city || '' : '';
      console.log('GET /api/settings/city - Returning city from Firestore:', city);
      res.json({ success: true, data: city });
    } else {
      // Fallback to mock data
      console.log('GET /api/settings/city - Returning city from mock data:', mockSettings.city);
      res.json({ success: true, data: mockSettings.city });
    }
  } catch (error) {
    console.error('Error getting city:', error);
    res.status(500).json({ error: 'Failed to get city' });
  }
});

app.put('/api/settings/city', async (req, res) => {
  try {
    const city = req.body.city || '';
    
    if (db) {
      // Use Firebase Firestore
      await db.collection('settings').doc('user').set({ city }, { merge: true });
      console.log('PUT /api/settings/city - Set city in Firestore:', city);
      res.json({ success: true, data: { city } });
    } else {
      // Fallback to mock data
      mockSettings.city = city;
      console.log('PUT /api/settings/city - Set city in mock data:', city);
      res.json({ success: true, data: { city } });
    }
  } catch (error) {
    console.error('Error setting city:', error);
    res.status(500).json({ error: 'Failed to set city' });
  }
});

app.get('/api/settings/onboarding', async (req, res) => {
  try {
    if (db) {
      // Use Firebase Firestore
      const settingsDoc = await db.collection('settings').doc('user').get();
      const onboarding = settingsDoc.exists ? settingsDoc.data().onboarding || false : false;
      console.log('GET /api/settings/onboarding - Returning from Firestore:', onboarding);
      res.json({ success: true, data: onboarding });
    } else {
      // Fallback to mock data
      console.log('GET /api/settings/onboarding - Returning from mock data:', mockSettings.onboarding);
      res.json({ success: true, data: mockSettings.onboarding });
    }
  } catch (error) {
    console.error('Error getting onboarding status:', error);
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

app.put('/api/settings/onboarding', async (req, res) => {
  try {
    const onboarding = req.body.completed || false;
    
    if (db) {
      // Use Firebase Firestore
      await db.collection('settings').doc('user').set({ onboarding }, { merge: true });
      console.log('PUT /api/settings/onboarding - Set in Firestore:', onboarding);
      res.json({ success: true, data: { onboarding } });
    } else {
      // Fallback to mock data
      mockSettings.onboarding = onboarding;
      console.log('PUT /api/settings/onboarding - Set in mock data:', onboarding);
      res.json({ success: true, data: { onboarding } });
    }
  } catch (error) {
    console.error('Error setting onboarding status:', error);
    res.status(500).json({ error: 'Failed to set onboarding status' });
  }
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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
