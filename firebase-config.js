import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin SDK
let firebaseApp;

try {
  // Try to get service account key from environment variable
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  
  if (serviceAccountKey) {
    // Parse the JSON string from environment variable
    const serviceAccount = JSON.parse(serviceAccountKey);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  } else {
    // Fallback to service account file (for local development)
    const serviceAccountPath = join(__dirname, 'firebase-service-account.json');
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
    
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
  }
  
  console.log('✅ Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
  console.log('Please ensure you have either:');
  console.log('1. FIREBASE_SERVICE_ACCOUNT_KEY environment variable set');
  console.log('2. firebase-service-account.json file in the server directory');
  console.log('3. FIREBASE_STORAGE_BUCKET environment variable set');
  console.log('⚠️  Server will continue without Firebase (some features may not work)');
  // Don't exit - let the server continue without Firebase
}

// Export Firebase services (only if initialized)
export const db = firebaseApp ? admin.firestore() : null;
export const storage = firebaseApp ? admin.storage() : null;
export const auth = firebaseApp ? admin.auth() : null;

// Firestore settings (only if db is available)
if (db) {
  db.settings({
    ignoreUndefinedProperties: true,
  });
}

// Helper function to get user collection path
export const getUserCollectionPath = (userId, collection) => {
  return `users/${userId}/${collection}`;
};

// Helper function to generate document ID
export const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export default firebaseApp;
