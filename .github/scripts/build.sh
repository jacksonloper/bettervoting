#!/bin/bash

# Build script for GitHub Actions TypeScript files

set -e

echo "🔨 Building TypeScript files..."

# Navigate to scripts directory
cd "$(dirname "$0")"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
npm run clean 2>/dev/null || true

# Compile TypeScript
echo "⚙️  Compiling TypeScript..."
npm run build

# Verify the output file exists
if [ -f "check-stale-issues.js" ]; then
    echo "✅ Build successful! Generated check-stale-issues.js"
    echo "📊 File size: $(wc -c < check-stale-issues.js) bytes"
else
    echo "❌ Build failed! check-stale-issues.js not found"
    exit 1
fi

echo "🎉 Ready for GitHub Actions!"
