import express from 'express';
import { body, param } from 'express-validator';
import { db, getUserCollectionPath } from '../firebase-config.js';
import { verifyToken, validateRequest } from '../middleware/auth.js';

const router = express.Router();

// GET /api/reminders - Get all user reminders
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const remindersSnapshot = await db.collection(getUserCollectionPath(userId, 'reminders')).get();
    const reminders = [];
    
    remindersSnapshot.forEach(doc => {
      reminders.push(doc.data());
    });
    
    res.json({
      success: true,
      data: reminders
    });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reminders'
    });
  }
});

// PUT /api/reminders/:id - Update reminder
router.put('/:id', verifyToken, [
  param('id').isString().notEmpty().withMessage('Reminder ID is required'),
  body('status').optional().isIn(['upcoming', 'overdue', 'completed']).withMessage('Invalid status'),
  body('dueDate').optional().isISO8601().withMessage('Invalid date format')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const reminderId = req.params.id;
    const updates = req.body;
    
    // Check if reminder exists
    const reminderRef = db.collection(getUserCollectionPath(userId, 'reminders')).doc(reminderId);
    const reminderDoc = await reminderRef.get();
    
    if (!reminderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Reminder not found'
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
    
    // Update reminder
    await reminderRef.update(updateData);
    
    // Get updated reminder
    const updatedReminderDoc = await reminderRef.get();
    
    res.json({
      success: true,
      data: updatedReminderDoc.data()
    });
  } catch (error) {
    console.error('Error updating reminder:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reminder'
    });
  }
});

// DELETE /api/reminders/item/:itemId - Delete reminders by itemId
router.delete('/item/:itemId', verifyToken, [
  param('itemId').isString().notEmpty().withMessage('Item ID is required')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const itemId = req.params.itemId;
    
    // Find reminders for this item
    const remindersSnapshot = await db.collection(getUserCollectionPath(userId, 'reminders'))
      .where('itemId', '==', itemId)
      .get();
    
    if (remindersSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'No reminders found for this item'
      });
    }
    
    // Delete reminders in batch
    const batch = db.batch();
    remindersSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    
    res.json({
      success: true,
      message: `Deleted ${remindersSnapshot.size} reminder(s) for item ${itemId}`
    });
  } catch (error) {
    console.error('Error deleting reminders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete reminders'
    });
  }
});

// POST /api/reminders/bulk-update - Bulk update reminders
router.post('/bulk-update', verifyToken, [
  body('reminderIds').isArray({ min: 1 }).withMessage('Reminder IDs must be a non-empty array'),
  body('updates').isObject().withMessage('Updates must be an object'),
  body('updates.status').optional().isIn(['upcoming', 'overdue', 'completed']).withMessage('Invalid status'),
  body('updates.dueDate').optional().isISO8601().withMessage('Invalid date format')
], validateRequest, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { reminderIds, updates } = req.body;
    
    const batch = db.batch();
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
    
    // Add updates to batch
    for (const reminderId of reminderIds) {
      const reminderRef = db.collection(getUserCollectionPath(userId, 'reminders')).doc(reminderId);
      batch.update(reminderRef, updateData);
    }
    
    await batch.commit();
    
    res.json({
      success: true,
      message: `Updated ${reminderIds.length} reminder(s)`
    });
  } catch (error) {
    console.error('Error bulk updating reminders:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update reminders'
    });
  }
});

export default router;
