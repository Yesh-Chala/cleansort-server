# Server Logging Guide

## Overview

The server now has comprehensive logging at every step. Here's what you'll see in Railway logs and how to interpret them.

## Startup Logs

When the server starts, you'll see:

```
=== Initializing Gemini AI ===
Environment check:
- PORT: 8080
- NODE_ENV: production
- GEMINI_API_KEY: ✅ Set (hidden)
✅ Gemini AI initialized successfully

========================================
🚀 CleanSort OCR Server Started
========================================
Server Info:
  - Port: 8080
  - Host: 0.0.0.0 (all interfaces)
  - Environment: production
  - Gemini AI: ✅ Configured

Available Endpoints:
  - GET  /health
  - POST /api/process-receipt

✅ Server is ready to accept requests
========================================
```

### What to Check:
- ✅ **GEMINI_API_KEY**: Should show "✅ Set (hidden)"
- ✅ **Gemini AI initialized**: Should show "✅ Gemini AI initialized successfully"
- ✅ **Port**: Should match Railway's assigned port
- ✅ **Ready message**: Should see "Server is ready to accept requests"

## Request Logs

### Every Request Gets Logged:

```
[2025-10-27T10:30:45.123Z] POST /api/process-receipt - Origin: https://your-frontend.com
```

This shows:
- Timestamp
- HTTP method
- Endpoint path
- Origin (where the request came from)

## Health Check Logs

```
[2025-10-27T10:30:50.456Z] GET /health - Origin: none
✅ Health check requested
```

**What this means:**
- Railway's health checker is pinging your server
- Server is responding correctly
- Should happen every 10-30 seconds

## OCR Processing Logs

### Successful Processing:

```
========================================
📸 OCR REQUEST RECEIVED
========================================
📋 Request Details:
  - File: receipt-photo.jpg
  - Size: 245.67 KB
  - Type: image/jpeg
  - City: mumbai

🤖 Processing with Gemini API...
  - Model: gemini-1.5-flash
  - City context: mumbai
  - Image converted to base64
  - Sending request to Gemini...
✅ Gemini response received in 1234 ms
  - Response length: 456 chars

📝 Parsing response...
  - Removed ```json``` wrapper
  - Parsing JSON...
  - Successfully parsed JSON
  - Validated as array with 5 items
  - Item 1: Organic Milk 1L (recyclable)
  - Item 2: Bananas (wet)
  - Item 3: Bread Loaf (dry)
  - Item 4: Plastic Bottle (recyclable)
  - Item 5: Battery Pack (hazardous)

✅ SUCCESS - Returning 5 items
⏱️  Total processing time: 1350 ms
========================================
```

### What Each Section Shows:

1. **📸 OCR REQUEST RECEIVED**
   - New request started
   - Includes file details and city

2. **🤖 Processing with Gemini API**
   - Gemini API call in progress
   - Shows model being used
   - Response time in milliseconds

3. **📝 Parsing response**
   - JSON parsing steps
   - Item count and validation
   - Each item extracted

4. **✅ SUCCESS**
   - Total items returned
   - Total processing time

## Error Logs

### Missing File:

```
========================================
📸 OCR REQUEST RECEIVED
========================================
❌ ERROR: No image file provided
```

**Fix:** Frontend needs to send image file in FormData

### Gemini API Error:

```
========================================
📸 OCR REQUEST RECEIVED
========================================
📋 Request Details:
  - File: receipt.jpg
  - Size: 123.45 KB
  - Type: image/jpeg
  - City: delhi

🤖 Processing with Gemini API...
  - Model: gemini-1.5-flash
  - City context: delhi
  - Image converted to base64
  - Sending request to Gemini...

❌ ERROR OCCURRED
  - Error type: Error
  - Error message: API key invalid
  - Duration before error: 567 ms
  - Stack trace: [shows error location]
  - Falling back to mock data
========================================
```

**Fix:** Check GEMINI_API_KEY environment variable in Railway

### JSON Parse Error:

```
📝 Parsing response...
  - Parsing JSON...
❌ ERROR OCCURRED
  - Error type: SyntaxError
  - Error message: Unexpected token in JSON
  - Duration before error: 1245 ms
  - Falling back to mock data
========================================
```

**What this means:** Gemini returned non-JSON text. Server falls back to mock data gracefully.

## 404 Errors

```
⚠️  404 - Endpoint not found: GET /api/wrong-endpoint
```

**What this means:** Frontend is calling wrong endpoint. Check API_BASE_URL.

## File Too Large

```
⚠️  MIDDLEWARE ERROR HANDLER
  - Error: File too large
  - Path: /api/process-receipt
  - Method: POST
  - Type: Multer Error
  - Reason: File too large
```

**Fix:** Image is over 50MB. Frontend should compress images before sending.

## Railway Deployment Logs

### Successful Deployment:

Look for this sequence in Railway logs:

1. **Build Phase:**
```
Using Nixpacks
install    │ npm ci
found 0 vulnerabilities
```

2. **Start Phase:**
```
=== Initializing Gemini AI ===
Environment check:
- PORT: 8080
- NODE_ENV: production
- GEMINI_API_KEY: ✅ Set (hidden)
✅ Gemini AI initialized successfully
```

3. **Server Ready:**
```
🚀 CleanSort OCR Server Started
✅ Server is ready to accept requests
```

4. **Health Checks:**
```
[timestamp] GET /health - Origin: none
✅ Health check requested
```

### Failed Deployment:

If you see this, something is wrong:

```
❌ Failed to initialize Gemini AI: [error message]
```

Or no startup logs at all = server crashed before logging.

## Monitoring Tips

### Good Signs ✅:
- Regular health check logs every 10-30 seconds
- OCR requests complete with "✅ SUCCESS"
- Total processing times under 5 seconds
- No error messages

### Warning Signs ⚠️:
- "Falling back to mock data" (Gemini API issue)
- 404 errors (frontend calling wrong URL)
- Processing times over 10 seconds (slow network/large images)

### Critical Issues ❌:
- No startup logs (server crashed)
- No health check logs (server not responding)
- "GEMINI_API_KEY: ❌ Not set" (missing env variable)
- Constant errors with no fallback

## Testing Your Logs

### 1. Test Health Check:
```bash
curl https://your-server.railway.app/health
```

**Expected logs:**
```
[timestamp] GET /health - Origin: none
✅ Health check requested
```

### 2. Test OCR Endpoint:
```bash
curl -X POST -F "image=@test.jpg" -F "city=mumbai" \
  https://your-server.railway.app/api/process-receipt
```

**Expected logs:**
```
[timestamp] POST /api/process-receipt - Origin: none
========================================
📸 OCR REQUEST RECEIVED
========================================
[... full processing logs ...]
✅ SUCCESS - Returning X items
```

### 3. Test 404:
```bash
curl https://your-server.railway.app/wrong-endpoint
```

**Expected logs:**
```
[timestamp] GET /wrong-endpoint - Origin: none
⚠️  404 - Endpoint not found: GET /wrong-endpoint
```

## Log Levels Summary

| Symbol | Meaning | Action Required |
|--------|---------|-----------------|
| 🚀 | Server started | None - all good |
| ✅ | Success | None - all good |
| 📸 | New OCR request | None - normal operation |
| 🤖 | Processing with AI | None - normal operation |
| 📝 | Parsing response | None - normal operation |
| ⏱️ | Performance metric | Check if time is acceptable |
| ⚠️ | Warning | Review but not critical |
| ❌ | Error | Check error details |

## Quick Debugging Checklist

If something's wrong, check logs for:

1. ✅ Startup logs present?
2. ✅ "Server is ready to accept requests"?
3. ✅ Health checks appearing regularly?
4. ✅ GEMINI_API_KEY configured?
5. ✅ Requests completing successfully?
6. ❌ Any error messages?
7. ❌ Missing expected logs?

## Environment Variables to Check

If you see errors, verify in Railway:

```
GEMINI_API_KEY=your_actual_key_here
```

That's the only one you need!

## Support

If you see unexpected logs or errors, copy the relevant section (from the separator lines) and you'll have all the context needed to debug the issue.

Example:
```
========================================
📸 OCR REQUEST RECEIVED
========================================
[... all logs between separators ...]
========================================
```

This gives complete context of what happened during that request.

