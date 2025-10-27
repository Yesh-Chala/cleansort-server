# CleanSort OCR Server

Minimal OCR server for processing receipts using Google Gemini API.

## Features

- ✅ Health check endpoint (`/health`)
- ✅ OCR processing endpoint (`POST /api/process-receipt`)
- ✅ Automatic fallback to mock data if Gemini API fails
- ✅ City-specific waste disposal rules
- ✅ No authentication required (simplified for deployment)
- ✅ No Firebase dependencies

## Environment Variables2

Required:
- `GEMINI_API_KEY` - Your Google Gemini API key
- `PORT` - Server port (default: 3001, Railway sets automatically)

## Endpoints

### GET /health
Health check endpoint that returns server status.

**Response:**
```json
{
  "status": "OK",
  "message": "CleanSort OCR Server is running",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### POST /api/process-receipt
Process receipt image and extract items.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `image`: Image file (required)
  - `city`: City name for location-specific rules (optional)

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "id": "1234567890-0",
      "name": "Organic Milk 1L",
      "quantity": "1 bottle",
      "category": "recyclable",
      "interval": 3,
      "confidence": 0.95
    }
  ],
  "count": 1,
  "city": "mumbai",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## Dependencies

Only essential dependencies:
- `express` - Web framework
- `cors` - CORS middleware
- `multer` - File upload handling
- `dotenv` - Environment variable management
- `@google/generative-ai` - Gemini API client

## Deployment

This server is designed to deploy easily on Railway:

1. Push to your Git repository
2. Connect to Railway
3. Set `GEMINI_API_KEY` environment variable
4. Railway automatically detects Node.js and runs `npm start`

The server binds to `0.0.0.0` and uses Railway's `PORT` environment variable automatically.

## Changes Made

**Removed:**
- Firebase Admin SDK and all Firebase dependencies
- Authentication middleware
- `/api/items`, `/api/reminders`, `/api/settings` routes
- Express validator
- Complex error logging

**Simplified:**
- Single file server (`server.js`)
- No authentication on OCR endpoint
- Graceful fallback to mock data
- Minimal logging
- Clear error messages

## Local Development

```bash
# Install dependencies
npm install

# Create .env file with your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > .env

# Start server
npm start

# Or use watch mode
npm run dev
```

Server will be available at `http://localhost:3001`

