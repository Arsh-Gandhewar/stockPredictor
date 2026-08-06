# QuantX - Premium Indian Stock Market Analytics Platform

QuantX is a production-grade full-stack web application designed for comprehensive Indian stock market analysis, AI-powered investment insights (powered by Google Gemini), and paper trading.

It is built with a highly scalable monorepo architecture designed for production.

## 🚀 Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui, Zustand, TanStack Query, TradingView Lightweight Charts
- **Backend:** NestJS, TypeScript, BullMQ (Queue)
- **Database:** PostgreSQL, Prisma ORM, Redis (Caching/Queue)
- **AI Integration:** Google Gemini API (Configurable models)
- **Authentication:** Clerk

## 📂 Project Structure

This project uses npm workspaces to manage a monorepo structure.

- \`apps/web\`: The Next.js 15 frontend application.
- \`apps/api\`: The NestJS backend service, containing REST APIs and background workers (BullMQ).
- \`packages/db\`: The shared database module containing the Prisma schema, migrations, and exported Prisma Client.

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v20+ recommended)
- npm (v10+)
- PostgreSQL Database (Local or Cloud, e.g., Supabase/Neon)
- Redis Server (Local or Cloud, e.g., Upstash)

## ⚙️ Setup & Installation

### 1. Install Dependencies
Run the following command at the root of the repository to install dependencies for all workspaces:
\`\`\`bash
npm install
\`\`\`

### 2. Environment Variables
Copy the \`.env.template\` file to a new \`.env\` file in the root directory:
\`\`\`bash
cp .env.template .env
\`\`\`
Fill in the necessary credentials in your \`.env\` file, including:
- \`DATABASE_URL\`
- \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\` & \`CLERK_SECRET_KEY\`
- \`REDIS_HOST\`, \`REDIS_PORT\`, \`REDIS_PASSWORD\`
- \`GEMINI_API_KEY\`

### 3. Database Setup (Prisma)
Navigate to the \`packages/db\` directory and push the schema to your database:
\`\`\`bash
cd packages/db
npx prisma db push
npm run generate
cd ../..
\`\`\`

### 4. Running the Development Servers

You can start both the frontend and backend development servers concurrently:

**Start the NestJS Backend:**
\`\`\`bash
cd apps/api
npm run start:dev
\`\`\`
*(Runs on http://localhost:3001)*

**Start the Next.js Frontend:**
\`\`\`bash
cd apps/web
npm run dev
\`\`\`
*(Runs on http://localhost:3000)*

## 🧠 AI Features & Schedulers

The backend uses **BullMQ** with Redis to run scheduled hourly jobs that:
1. Fetch live market prices and historical data for the top 300 Indian stocks (via Yahoo Finance).
2. Compute technical indicators (RSI, MACD, Moving Averages, Bollinger Bands).
3. Fetch news articles and pass them through Gemini Flash for rapid sentiment analysis.
4. Pass the combined fundamental, technical, and sentiment context to **Gemini Pro** to generate precise, structured trading insights (Strong Buy, Hold, Sell, etc.) with associated probabilities and risk factors.

## ⚠️ Disclaimer

**The AI-generated recommendations are for educational and research purposes only. They should not be considered financial or investment advice. Users should conduct their own research or consult a SEBI-registered investment advisor before making investment decisions.**
