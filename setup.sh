#!/bin/bash

echo "🚀 Setting up CleanSort OCR Server..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp env.example .env
    echo "⚠️  Please edit .env file and add your GEMINI_API_KEY"
    echo "   You can get your API key from: https://makersuite.google.com/app/apikey"
else
    echo "✅ .env file already exists"
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file and add your GEMINI_API_KEY"
echo "2. Start the server: npm run dev"
echo "3. Make sure your frontend is configured to use http://localhost:3001"
echo ""
echo "Server will be available at:"
echo "  - Health check: http://localhost:3001/health"
echo "  - OCR endpoint: http://localhost:3001/api/process-receipt"
