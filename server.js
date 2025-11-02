import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getAuth } from 'firebase-admin/auth';

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
let auth;
let messaging;
console.log('=== Initializing Firebase Admin ===');
try {
  if (!getApps().length) {
    // Use service account key if available, otherwise use project ID
    const firebaseConfig = process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
      : { projectId: process.env.FIREBASE_PROJECT_ID || 'clean-sort-bits-2025' };
    
    initializeApp({
      credential: process.env.FIREBASE_SERVICE_ACCOUNT_KEY 
        ? cert(firebaseConfig)
        : undefined,
      projectId: firebaseConfig.project_id || firebaseConfig.projectId || 'clean-sort-bits-2025',
    });
  }
  db = getFirestore();
  auth = getAuth();
  messaging = getMessaging();
  console.log('✅ Firebase Admin initialized successfully');
  console.log('✅ Firebase Auth initialized');
  console.log('✅ Firebase Messaging (FCM) initialized');
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
// Manual trigger endpoint for testing notifications
app.post('/api/notifications/trigger', async (req, res) => {
  try {
    console.log('🔔 Manual notification trigger requested');
    await checkAndSendNotifications();
    res.json({ success: true, message: 'Notification check completed' });
  } catch (error) {
    console.error('Error triggering notifications:', error);
    res.status(500).json({ error: 'Failed to trigger notifications' });
  }
});

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
app.get('/api/items', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    if (db) {
      // Use Firebase Firestore - filter by userId
      const itemsSnapshot = await db.collection('items')
        .where('userId', '==', userId)
        .get();
      const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('GET /api/items - Returning', items.length, 'items from Firestore for user:', userId);
      res.json({ success: true, data: items });
    } else {
      // Fallback to mock data
      const userItems = mockItems.filter(item => item.userId === userId);
      console.log('GET /api/items - Returning', userItems.length, 'items from mock data for user:', userId);
      res.json({ success: true, data: userItems });
    }
  } catch (error) {
    console.error('Error getting items:', error);
    res.status(500).json({ error: 'Failed to get items' });
  }
});

app.post('/api/items', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const itemData = {
      ...req.body,
      userId: userId, // Add userId to item
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
        userId: userId, // Add userId to reminder
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

// Bulk items endpoint
app.post('/api/items/bulk', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { items } = req.body;
    
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    
    const savedItems = [];
    const savedReminders = [];
    
    if (db) {
      // Use Firebase Firestore - batch write for better performance
      const batch = db.batch();
      
      for (const itemData of items) {
        const itemRef = db.collection('items').doc();
        const itemWithUser = {
          ...itemData,
          userId: userId,
          createdAt: new Date().toISOString()
        };
        batch.set(itemRef, itemWithUser);
        
        // Create automatic reminder for each item
        const disposalDate = new Date();
        disposalDate.setDate(disposalDate.getDate() + (itemData.interval || 7));
        
        const reminderRef = db.collection('reminders').doc();
        const reminderData = {
          itemId: itemRef.id,
          itemName: itemData.name,
          category: itemData.category,
          userId: userId,
          dueDate: disposalDate.toISOString(),
          status: "upcoming",
          createdAt: new Date().toISOString()
        };
        batch.set(reminderRef, reminderData);
        
        savedItems.push({ id: itemRef.id, ...itemWithUser });
        savedReminders.push({ id: reminderRef.id, ...reminderData });
      }
      
      await batch.commit();
      console.log('POST /api/items/bulk - Added', items.length, 'items and reminders to Firestore');
      res.json({ success: true, data: { items: savedItems, reminders: savedReminders } });
    } else {
      // Fallback to mock data
      for (const itemData of items) {
        const item = {
          ...itemData,
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          userId: userId,
          createdAt: new Date().toISOString()
        };
        mockItems.push(item);
        
        const disposalDate = new Date();
        disposalDate.setDate(disposalDate.getDate() + (itemData.interval || 7));
        
        const reminder = {
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          itemId: item.id,
          itemName: itemData.name,
          category: itemData.category,
          userId: userId,
          dueDate: disposalDate.toISOString(),
          status: "upcoming",
          createdAt: new Date().toISOString()
        };
        mockReminders.push(reminder);
        
        savedItems.push(item);
        savedReminders.push(reminder);
      }
      
      console.log('POST /api/items/bulk - Added', items.length, 'items and reminders to mock data');
      res.json({ success: true, data: { items: savedItems, reminders: savedReminders } });
    }
  } catch (error) {
    console.error('Error saving bulk items:', error);
    res.status(500).json({ error: 'Failed to save bulk items' });
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

// Authentication middleware - verify Firebase ID token
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    if (!auth || !token) {
      return res.status(401).json({ error: 'Authentication service not available' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Reminders API endpoints
app.get('/api/reminders', verifyToken, async (req, res) => {
  try {
    const userId = req.userId;
    if (db) {
      // Use Firebase Firestore - filter by userId
      const remindersSnapshot = await db.collection('reminders')
        .where('userId', '==', userId)
        .get();
      const reminders = remindersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('GET /api/reminders - Returning', reminders.length, 'reminders from Firestore for user:', userId);
      res.json({ success: true, data: reminders });
    } else {
      // Fallback to mock data
      const userReminders = mockReminders.filter(reminder => reminder.userId === userId);
      console.log('GET /api/reminders - Returning', userReminders.length, 'reminders from mock data for user:', userId);
      res.json({ success: true, data: userReminders });
    }
  } catch (error) {
    console.error('Error getting reminders:', error);
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

// FCM Token Registration endpoint
app.post('/api/fcm/register', verifyToken, async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.userId;

    if (!token) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    if (!db) {
      console.log('POST /api/fcm/register - Firebase not available, skipping token registration');
      return res.json({ success: true, message: 'Token registration skipped (mock mode)' });
    }

    // Store token in Firestore: fcm_tokens/{userId}/tokens/{tokenId}
    // Use the token itself as the document ID (or hash it) to prevent duplicates
    const tokenDoc = {
      token,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deviceInfo: req.headers['user-agent'] || 'unknown',
    };

    // Check if token already exists for this user
    const tokensRef = db.collection('fcm_tokens').doc(userId).collection('tokens');
    const existingTokens = await tokensRef.where('token', '==', token).get();

    if (!existingTokens.empty) {
      // Update existing token
      const existingDoc = existingTokens.docs[0];
      await existingDoc.ref.update({
        updatedAt: new Date().toISOString(),
        deviceInfo: tokenDoc.deviceInfo,
      });
      console.log('PUT /api/fcm/register - Updated existing token for user:', userId);
      return res.json({ success: true, message: 'Token updated' });
    } else {
      // Add new token
      await tokensRef.add(tokenDoc);
      console.log('POST /api/fcm/register - Registered new token for user:', userId);
      return res.json({ success: true, message: 'Token registered' });
    }
  } catch (error) {
    console.error('Error registering FCM token:', error);
    res.status(500).json({ error: 'Failed to register FCM token' });
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

// Notification Scheduler - Check and send reminder notifications
async function checkAndSendNotifications() {
  if (!db || !messaging) {
    console.log('⏭️  Skipping notification check - Firebase not available');
    return;
  }

  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour buffer
    
    console.log('\n🔔 Checking for due reminders...');
    console.log('  - Current time:', now.toISOString());
    console.log('  - Checking reminders due before:', oneHourFromNow.toISOString());

    // Find reminders that are due (or due within 1 hour)
    // Query by date only (no composite index needed), then filter by status in code
    const allRemindersSnapshot = await db.collection('reminders')
      .where('dueDate', '<=', oneHourFromNow.toISOString())
      .get();
    
    // Filter by status in JavaScript (upcoming or overdue, not completed)
    // Also check if notification was already sent recently (within last 5 minutes)
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const remindersSnapshot = {
      docs: allRemindersSnapshot.docs.filter(doc => {
        const reminder = doc.data();
        // Skip if status is not upcoming/overdue
        if (reminder.status !== 'upcoming' && reminder.status !== 'overdue') {
          return false;
        }
        // Skip if notification was sent recently (within last 5 minutes) to prevent spam
        if (reminder.lastNotificationSent && reminder.lastNotificationSent > fiveMinutesAgo) {
          return false;
        }
        return true;
      }),
      size: 0, // Will calculate below
      empty: true // Will calculate below
    };
    
    remindersSnapshot.size = remindersSnapshot.docs.length;
    remindersSnapshot.empty = remindersSnapshot.size === 0;

    console.log('  - Found', remindersSnapshot.size, 'reminders due');

    if (remindersSnapshot.empty) {
      console.log('✅ No reminders due at this time');
      return;
    }

    let sentCount = 0;
    let failedCount = 0;

    // Group reminders by user
    const remindersByUser = {};
    for (const doc of remindersSnapshot.docs) {
      const reminder = { id: doc.id, ...doc.data() };
      
      // Get the item to find the user ID
      // Items might be stored per-user, so check if reminder has userId or get from item
      let userId = reminder.userId;
      
      if (!userId) {
        console.log('  ⚠️  Reminder missing userId, looking up from item:', reminder.id);
        if (!reminder.itemId) {
          console.log('  ❌ Reminder has no itemId, cannot determine user:', reminder.id);
          console.log('  🗑️  Deleting orphaned reminder (no itemId)');
          await db.collection('reminders').doc(reminder.id).delete().catch(console.error);
          continue;
        }
        
        const itemDoc = await db.collection('items').doc(reminder.itemId).get();
        if (!itemDoc.exists) {
          console.log('  ⚠️  Item not found for reminder:', reminder.id, 'itemId:', reminder.itemId);
          console.log('  🗑️  Deleting orphaned reminder (item not found)');
          await db.collection('reminders').doc(reminder.id).delete().catch(console.error);
          continue;
        }
        const item = itemDoc.data();
        userId = item.userId;
        
        // If item also doesn't have userId, it's orphaned - try to find from current user's active reminders
        if (!userId) {
          console.log('  ⚠️  Item also missing userId:', reminder.itemId);
          console.log('  🔍 Attempting to find userId from other reminders for same item...');
          
          // Look for other reminders for the same item that might have userId
          // Note: Firestore doesn't support != null, so we get all and filter
          const otherRemindersSnapshot = await db.collection('reminders')
            .where('itemId', '==', reminder.itemId)
            .limit(10) // Get a few to check
            .get();
          
          // Filter for reminders that have userId
          const otherReminders = {
            docs: otherRemindersSnapshot.docs.filter(doc => {
              const data = doc.data();
              return data.userId && data.userId.trim() !== '';
            }),
            empty: false,
          };
          
          if (otherReminders.docs.length === 0) {
            otherReminders.empty = true;
          }
          
          if (otherReminders.docs.length > 0) {
            userId = otherReminders.docs[0].data().userId;
            console.log('  ✅ Found userId from other reminder for same item:', userId);
            
            // Update both the item and this reminder with the found userId
            await Promise.all([
              db.collection('items').doc(reminder.itemId).update({ userId }),
              db.collection('reminders').doc(reminder.id).update({ userId }),
            ]);
            console.log('  ✅ Updated item and reminder with userId');
          } else {
            console.log('  ❌ No userId found anywhere for reminder:', reminder.id);
            console.log('  🗑️  Deleting orphaned reminder (cannot determine user)');
            await db.collection('reminders').doc(reminder.id).delete().catch(console.error);
            continue;
          }
        } else {
          // If we found userId from item, update the reminder to include it (backfill)
          console.log('  ✅ Found userId from item, updating reminder:', reminder.id);
          await db.collection('reminders').doc(reminder.id).update({
            userId: userId,
          });
        }
      }
      
      if (!userId) {
        console.log('  ❌ No userId found for reminder (even after all lookups):', reminder.id);
        console.log('  🗑️  This should not happen - deleting orphaned reminder');
        await db.collection('reminders').doc(reminder.id).delete().catch(console.error);
        continue;
      }

      if (!remindersByUser[userId]) {
        remindersByUser[userId] = [];
      }
      remindersByUser[userId].push(reminder);
    }

    // Send notifications to each user
    for (const [userId, userReminders] of Object.entries(remindersByUser)) {
      try {
        // Get user's FCM tokens
        const tokensRef = db.collection('fcm_tokens').doc(userId).collection('tokens');
        const tokensSnapshot = await tokensRef.get();

        if (tokensSnapshot.empty) {
          console.log('  ⚠️  No FCM tokens found for user:', userId);
          continue;
        }

        const tokens = tokensSnapshot.docs.map(doc => doc.data().token);
        console.log('  - User:', userId, '- Tokens:', tokens.length);

        // Send notification for each reminder
        for (const reminder of userReminders) {
          const notification = {
            notification: {
              title: 'CleanSort Reminder',
              body: `Time to dispose: ${reminder.itemName}`,
            },
            data: {
              reminderId: reminder.id,
              itemId: reminder.itemId,
              itemName: reminder.itemName,
              category: reminder.category || '',
              dueDate: reminder.dueDate,
            },
            tokens: tokens, // Send to all user's devices
          };

          try {
            const response = await messaging.sendEachForMulticast({
              tokens: tokens,
              notification: notification.notification,
              data: notification.data,
              apns: {
                payload: {
                  aps: {
                    sound: 'default',
                    badge: userReminders.length,
                  },
                },
              },
              android: {
                priority: 'high',
                notification: {
                  sound: 'default',
                  channelId: 'reminders',
                },
              },
            });

            console.log('  ✅ Notification sent to', response.successCount, 'device(s)');
            console.log('  📝 Response details:', {
              successCount: response.successCount,
              failureCount: response.failureCount,
              totalTokens: tokens.length,
            });
            
            // Log detailed response for debugging
            if (response.failureCount > 0) {
              response.responses.forEach((resp, idx) => {
                if (!resp.success && resp.error) {
                  console.log('  ❌ Token', idx, 'failed:', resp.error.code, '-', resp.error.message);
                } else {
                  console.log('  ✅ Token', idx, 'succeeded');
                }
              });
            }
            
            // Mark reminder as notified (optional - add a field to track this)
            await db.collection('reminders').doc(reminder.id).update({
              lastNotificationSent: new Date().toISOString(),
            });

            sentCount += response.successCount;
            
            // Handle failed tokens
            if (response.failureCount > 0) {
              console.log('  ⚠️  Failed to send to', response.responses.length - response.successCount, 'device(s)');
              failedCount += response.failureCount;
              
              // Remove invalid tokens
              response.responses.forEach((resp, idx) => {
                if (!resp.success && resp.error) {
                  const errorCode = resp.error.code;
                  console.log('  🗑️  Removing invalid token:', errorCode);
                  if (errorCode === 'messaging/invalid-registration-token' || 
                      errorCode === 'messaging/registration-token-not-registered') {
                    // Remove invalid token from Firestore
                    tokensSnapshot.docs[idx]?.ref.delete().catch(console.error);
                    console.log('  🗑️  Removed invalid token from database');
                  }
                }
              });
            }
          } catch (sendError) {
            console.error('  ❌ Error sending notification:', sendError.message);
            failedCount++;
          }
        }
      } catch (userError) {
        console.error('  ❌ Error processing user reminders:', userError.message);
      }
    }

    console.log('\n📊 Notification Summary:');
    console.log('  - Sent:', sentCount);
    console.log('  - Failed:', failedCount);
    console.log('✅ Notification check completed\n');

  } catch (error) {
    console.error('❌ Error in notification scheduler:', error);
    console.error('Stack:', error.stack);
  }
}

// Run notification check every hour
let notificationInterval;
function startNotificationScheduler() {
  if (!db || !messaging) {
    console.log('⏭️  Notification scheduler not started - Firebase not available');
    return;
  }

  // Run immediately on startup (after 10 seconds to let server initialize)
  setTimeout(() => {
    console.log('🚀 Starting notification scheduler...');
    checkAndSendNotifications();
  }, 10000);

  // Then run every 5 minutes for active checking (especially during testing)
  notificationInterval = setInterval(() => {
    checkAndSendNotifications();
  }, 5 * 60 * 1000); // 5 minutes

  console.log('✅ Notification scheduler started (runs every 5 minutes)');
}

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
  console.log('  - Firebase:', db ? '✅ Configured' : '⚠️  Not configured (using mock data)');
  console.log('  - FCM Messaging:', messaging ? '✅ Configured' : '⚠️  Not configured');
  console.log('\nAvailable Endpoints:');
  console.log('  - GET  /health');
  console.log('  - POST /api/process-receipt');
  console.log('  - GET  /api/items');
  console.log('  - POST /api/items');
  console.log('  - DELETE /api/items/:id');
  console.log('  - GET  /api/reminders');
  console.log('  - POST /api/fcm/register (protected)');
  console.log('  - GET  /api/settings/city');
  console.log('  - PUT  /api/settings/city');
  console.log('  - GET  /api/settings/onboarding');
  console.log('  - PUT  /api/settings/onboarding');
  console.log('\n✅ Server is ready to accept requests');
  console.log('========================================\n');

  // Start notification scheduler
  startNotificationScheduler();
});

export default app;
