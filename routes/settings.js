import express from 'express';
import { body } from 'express-validator';
import { db, getUserCollectionPath } from '../firebase-config.js';
import { verifyToken, validateRequest } from '../middleware/auth.js';

const router = express.Router();

// GET /api/settings - Get all user settings
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const settingsDoc = await db.collection(getUserCollectionPath(userId, 'settings')).doc('user_settings').get();
    
    if (!settingsDoc.exists) {
      // Return default settings
      const defaultSettings = {
        notifications: true,
        locationServices: true,
        autoSync: true,
        theme: 'system'
      };
      
      return res.json({
        success: true,
        data: defaultSettings
      });
    }
    
    res.json({
      success: true,
      data: settingsDoc.data()
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings'
    });
  }
});

// PUT /api/settings - Update settings
router.put('/', verifyToken, [
  body('notifications').optional().isBoolean().withMessage('Notifications must be boolean'),
  body('locationServices').optional().isBoolean().withMessage('Location services must be boolean'),
  body('autoSync').optional().isBoolean().withMessage('Auto sync must be boolean'),
  body('theme').optional().isIn(['light', 'dark', 'system']).withMessage('Invalid theme')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const settings = req.body;
    
    const settingsRef = db.collection(getUserCollectionPath(userId, 'settings')).doc('user_settings');
    
    // Merge with existing settings
    const existingDoc = await settingsRef.get();
    const existingSettings = existingDoc.exists ? existingDoc.data() : {};
    
    const updatedSettings = {
      ...existingSettings,
      ...settings,
      updatedAt: new Date().toISOString()
    };
    
    await settingsRef.set(updatedSettings);
    
    res.json({
      success: true,
      data: updatedSettings
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
});

// GET /api/settings/city - Get selected city
router.get('/city', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const profileDoc = await db.collection(getUserCollectionPath(userId, 'profile')).doc('user_profile').get();
    
    if (!profileDoc.exists) {
      return res.json({
        success: true,
        data: 'Bengaluru, Karnataka' // Default city
      });
    }
    
    const profile = profileDoc.data();
    
    res.json({
      success: true,
      data: profile.selectedCity || 'Bengaluru, Karnataka'
    });
  } catch (error) {
    console.error('Error fetching selected city:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch selected city'
    });
  }
});

// PUT /api/settings/city - Update selected city
router.put('/city', verifyToken, [
  body('city').trim().isLength({ min: 1, max: 100 }).withMessage('City must be 1-100 characters')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { city } = req.body;
    
    const profileRef = db.collection(getUserCollectionPath(userId, 'profile')).doc('user_profile');
    
    // Get existing profile or create new one
    const profileDoc = await profileRef.get();
    const existingProfile = profileDoc.exists ? profileDoc.data() : {};
    
    const updatedProfile = {
      ...existingProfile,
      selectedCity: city.trim(),
      updatedAt: new Date().toISOString()
    };
    
    await profileRef.set(updatedProfile);
    
    res.json({
      success: true,
      data: city.trim()
    });
  } catch (error) {
    console.error('Error updating selected city:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update selected city'
    });
  }
});

// GET /api/settings/onboarding - Get onboarding status
router.get('/onboarding', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const profileDoc = await db.collection(getUserCollectionPath(userId, 'profile')).doc('user_profile').get();
    
    if (!profileDoc.exists) {
      return res.json({
        success: true,
        data: false
      });
    }
    
    const profile = profileDoc.data();
    
    res.json({
      success: true,
      data: profile.onboardingCompleted || false
    });
  } catch (error) {
    console.error('Error fetching onboarding status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch onboarding status'
    });
  }
});

// PUT /api/settings/onboarding - Set onboarding completed
router.put('/onboarding', verifyToken, [
  body('completed').isBoolean().withMessage('Completed must be boolean')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { completed } = req.body;
    
    const profileRef = db.collection(getUserCollectionPath(userId, 'profile')).doc('user_profile');
    
    // Get existing profile or create new one
    const profileDoc = await profileRef.get();
    const existingProfile = profileDoc.exists ? profileDoc.data() : {};
    
    const updatedProfile = {
      ...existingProfile,
      onboardingCompleted: completed,
      updatedAt: new Date().toISOString()
    };
    
    await profileRef.set(updatedProfile);
    
    res.json({
      success: true,
      data: completed
    });
  } catch (error) {
    console.error('Error updating onboarding status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update onboarding status'
    });
  }
});

// GET /api/export - Export all user data
router.get('/export', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // Get all user data
    const [itemsSnapshot, remindersSnapshot, settingsDoc, profileDoc] = await Promise.all([
      db.collection(getUserCollectionPath(userId, 'items')).get(),
      db.collection(getUserCollectionPath(userId, 'reminders')).get(),
      db.collection(getUserCollectionPath(userId, 'settings')).doc('user_settings').get(),
      db.collection(getUserCollectionPath(userId, 'profile')).doc('user_profile').get()
    ]);
    
    const items = [];
    const reminders = [];
    
    itemsSnapshot.forEach(doc => {
      items.push(doc.data());
    });
    
    remindersSnapshot.forEach(doc => {
      reminders.push(doc.data());
    });
    
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    const profile = profileDoc.exists ? profileDoc.data() : {};
    
    const exportData = {
      items,
      reminders,
      settings,
      profile,
      exportedAt: new Date().toISOString(),
      version: '1.0.0'
    };
    
    res.json({
      success: true,
      data: exportData
    });
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export data'
    });
  }
});

export default router;
