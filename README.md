# CleanSort OCR Server

A Node.js server that handles receipt processing using Google's Gemini AI API. This server acts as a proxy between the frontend and Gemini API to avoid CORS issues.

## Features

- 🖼️ Image upload and processing
- 🤖 Gemini AI integration for receipt OCR
- 🌍 City-specific disposal rules
- 🔒 CORS protection
- 📊 JSON response formatting
- 🛡️ Error handling with fallback data

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` and add your Gemini API key:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3001
   NODE_ENV=development
   ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
   ```

3. **Start the server:**
   ```bash
   # Development mode (with auto-restart)
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status and timestamp.

### Process Receipt
```
POST /api/process-receipt
```

**Request:**
- Content-Type: `multipart/form-data`
- Body:
  - `image`: Image file (max 10MB)
  - `city`: City name (optional)

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "id": "timestamp-index",
      "name": "Item name",
      "quantity": "1L",
      "category": "recyclable",
      "interval": 3,
      "confidence": 0.95
    }
  ],
  "count": 1,
  "city": "mumbai",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Supported Cities

The server includes city-specific disposal rules for:
- Mumbai
- Delhi
- Bangalore
- Chennai
- Kolkata
- Hyderabad
- Pune
- Ahmedabad

## Error Handling

- Returns fallback mock data if Gemini API fails
- Validates file size (max 10MB)
- Handles CORS errors
- Provides detailed error messages

## Development

The server runs on port 3001 by default. Make sure your frontend is configured to send requests to `http://localhost:3001/api/process-receipt`.

## Security

- CORS protection with configurable origins
- File size limits
- Input validation
- Environment variable protection for API keys
