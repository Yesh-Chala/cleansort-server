import express from 'express';
import { body, param } from 'express-validator';
import { db, getUserCollectionPath, generateId } from '../firebase-config.js';
import { verifyToken, validateRequest } from '../middleware/auth.js';

const router = express.Router();

// Validation rules
const itemValidation = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('category').isIn(['dry', 'wet', 'medical', 'hazardous', 'recyclable', 'e-waste']).withMessage('Invalid category'),
  body('quantity').isNumeric().isFloat({ min: 0.1 }).withMessage('Quantity must be a positive number'),
  body('unit').trim().isLength({ min: 1, max: 20 }).withMessage('Unit must be 1-20 characters'),
  body('interval').isInt({ min: 1, max: 365 }).withMessage('Interval must be 1-365 days')
];

const bulkItemValidation = [
  body('items').isArray({ min: 1 }).withMessage('Items must be a non-empty array'),
  body('items.*.name').trim().isLength({ min: 2, max: 100 }).withMessage('Each item name must be 2-100 characters'),
  body('items.*.category').isIn(['dry', 'wet', 'medical', 'hazardous', 'recyclable', 'e-waste']).withMessage('Invalid category for each item'),
  body('items.*.quantity').isNumeric().isFloat({ min: 0.1 }).withMessage('Each item quantity must be a positive number'),
  body('items.*.unit').trim().isLength({ min: 1, max: 20 }).withMessage('Each item unit must be 1-20 characters'),
  body('items.*.interval').isInt({ min: 1, max: 365 }).withMessage('Each item interval must be 1-365 days')
];

// Helper function to create reminder for an item
const createReminder = async (userId, item) => {
  const reminderId = generateId();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + item.interval);
  
  const reminder = {
    id: reminderId,
    itemId: item.id,
    itemName: item.name,
    category: item.category,
    dueDate: dueDate.toISOString(),
    status: 'upcoming',
    createdAt: new Date().toISOString()
  };
  
  await db.collection(getUserCollectionPath(userId, 'reminders')).doc(reminderId).set(reminder);
  return reminder;
};

// POST /api/items - Create single item
router.post('/', verifyToken, itemValidation, validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { name, category, quantity, unit, interval } = req.body;
    
    const itemId = generateId();
    const now = new Date().toISOString();
    
    const item = {
      id: itemId,
      name: name.trim(),
      category,
      quantity: parseFloat(quantity),
      unit: unit.trim(),
      interval: parseInt(interval),
      createdAt: now
    };
    
    // Save item to Firestore
    await db.collection(getUserCollectionPath(userId, 'items')).doc(itemId).set(item);
    
    // Create reminder for the item
    const reminder = await createReminder(userId, item);
    
    res.status(201).json({
      success: true,
      data: {
        item,
        reminder
      }
    });
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create item'
    });
  }
});

// POST /api/items/bulk - Create multiple items
router.post('/bulk', verifyToken, bulkItemValidation, validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { items } = req.body;
    
    const now = new Date().toISOString();
    const createdItems = [];
    const createdReminders = [];
    
    // Process items in batches to avoid Firestore limits
    const batch = db.batch();
    const reminderBatch = db.batch();
    
    for (const itemData of items) {
      const itemId = generateId();
      
      const item = {
        id: itemId,
        name: itemData.name.trim(),
        category: itemData.category,
        quantity: parseFloat(itemData.quantity),
        unit: itemData.unit.trim(),
        interval: parseInt(itemData.interval),
        createdAt: now
      };
      
      createdItems.push(item);
      
      // Add item to batch
      const itemRef = db.collection(getUserCollectionPath(userId, 'items')).doc(itemId);
      batch.set(itemRef, item);
      
      // Create reminder
      const reminderId = generateId();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + item.interval);
      
      const reminder = {
        id: reminderId,
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        dueDate: dueDate.toISOString(),
        status: 'upcoming',
        createdAt: now
      };
      
      createdReminders.push(reminder);
      
      // Add reminder to batch
      const reminderRef = db.collection(getUserCollectionPath(userId, 'reminders')).doc(reminderId);
      reminderBatch.set(reminderRef, reminder);
    }
    
    // Commit both batches
    await batch.commit();
    await reminderBatch.commit();
    
    res.status(201).json({
      success: true,
      data: {
        items: createdItems,
        reminders: createdReminders
      }
    });
  } catch (error) {
    console.error('Error creating bulk items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create items'
    });
  }
});

// GET /api/items - Get all user items
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const itemsSnapshot = await db.collection(getUserCollectionPath(userId, 'items')).get();
    const items = [];
    
    itemsSnapshot.forEach(doc => {
      items.push(doc.data());
    });
    
    res.json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch items'
    });
  }
});

// PUT /api/items/:id - Update item
router.put('/:id', verifyToken, [
  param('id').isString().notEmpty().withMessage('Item ID is required'),
  body('name').optional().trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('category').optional().isIn(['dry', 'wet', 'medical', 'hazardous', 'recyclable', 'e-waste']).withMessage('Invalid category'),
  body('quantity').optional().isNumeric().isFloat({ min: 0.1 }).withMessage('Quantity must be a positive number'),
  body('unit').optional().trim().isLength({ min: 1, max: 20 }).withMessage('Unit must be 1-20 characters'),
  body('interval').optional().isInt({ min: 1, max: 365 }).withMessage('Interval must be 1-365 days')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const itemId = req.params.id;
    const updates = req.body;
    
    // Check if item exists
    const itemRef = db.collection(getUserCollectionPath(userId, 'items')).doc(itemId);
    const itemDoc = await itemRef.get();
    
    if (!itemDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }
    
    // Prepare updates
    const updateData = {
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    // Clean up undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    // Update item
    await itemRef.update(updateData);
    
    // If interval changed, update associated reminders
    if (updates.interval) {
      const remindersSnapshot = await db.collection(getUserCollectionPath(userId, 'reminders'))
        .where('itemId', '==', itemId)
        .get();
      
      const newDueDate = new Date();
      newDueDate.setDate(newDueDate.getDate() + parseInt(updates.interval));
      
      const reminderBatch = db.batch();
      remindersSnapshot.forEach(doc => {
        reminderBatch.update(doc.ref, {
          dueDate: newDueDate.toISOString(),
          status: 'upcoming'
        });
      });
      
      await reminderBatch.commit();
    }
    
    // Get updated item
    const updatedItemDoc = await itemRef.get();
    
    res.json({
      success: true,
      data: updatedItemDoc.data()
    });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update item'
    });
  }
});

// DELETE /api/items/:id - Delete item and associated reminders
router.delete('/:id', verifyToken, [
  param('id').isString().notEmpty().withMessage('Item ID is required')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const itemId = req.params.id;
    
    // Check if item exists
    const itemRef = db.collection(getUserCollectionPath(userId, 'items')).doc(itemId);
    const itemDoc = await itemRef.get();
    
    if (!itemDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }
    
    // Delete associated reminders
    const remindersSnapshot = await db.collection(getUserCollectionPath(userId, 'reminders'))
      .where('itemId', '==', itemId)
      .get();
    
    const batch = db.batch();
    remindersSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Delete the item
    batch.delete(itemRef);
    
    await batch.commit();
    
    res.json({
      success: true,
      message: 'Item and associated reminders deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete item'
    });
  }
});

export default router;
