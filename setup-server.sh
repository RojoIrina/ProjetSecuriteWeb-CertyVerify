#!/bin/bash
# ================================================================
# CERTIVERIFY — Server Setup Script
# Run from the project root: bash setup-server.sh
# ================================================================
set -e

echo "
┌─────────────────────────────────────────────┐
│     🛡️  CertiVerify — Server Setup         │
└─────────────────────────────────────────────┘
"

# 1. Install server dependencies
echo "📦 Installing server dependencies..."
cd server
npm install

# 2. Generate JWT RSA key pair
echo ""
echo "🔐 Generating JWT RSA-2048 key pair..."
mkdir -p keys
openssl genrsa -out keys/jwt-private.pem 2048 2>/dev/null
openssl rsa -in keys/jwt-private.pem -pubout -out keys/jwt-public.pem 2>/dev/null
echo "   ✅ keys/jwt-private.pem (KEEP SECRET)"
echo "   ✅ keys/jwt-public.pem"

# 3. Generate Prisma client
echo ""
echo "🗄️  Generating Prisma client..."
npx prisma generate

# 4. Check PostgreSQL and push schema
echo ""
echo "🗄️  Pushing schema to PostgreSQL..."
echo "   (Make sure PostgreSQL is running and DATABASE_URL is set in server/.env)"
npx prisma db push 2>&1 || {
  echo ""
  echo "⚠️  Database push failed. Make sure:"
  echo "   1. PostgreSQL is running"
  echo "   2. The database 'certiverify_db' exists"
  echo "   3. DATABASE_URL in server/.env is correct"
  echo ""
  echo "   To create the database manually:"
  echo "   psql -U postgres -c 'CREATE DATABASE certiverify_db;'"
  echo ""
  exit 1
}

# 5. Seed the database
echo ""
echo "🌱 Seeding database with initial data..."
npx tsx prisma/seed.ts

cd ..

echo ""
echo "
┌─────────────────────────────────────────────┐
│     ✅  Setup Complete!                     │
├─────────────────────────────────────────────┤
│                                             │
│  Start the server:                          │
│    cd server && npm run dev                 │
│                                             │
│  Start the frontend:                        │
│    npm run dev                              │
│                                             │
│  Test credentials:                          │
│    Admin:   admin@certiverify.com / admin123│
│    Student: jean@student.com / student123   │
│                                             │
│  API:      http://localhost:3001/api        │
│  Frontend: http://localhost:3000            │
│                                             │
└─────────────────────────────────────────────┘
"
