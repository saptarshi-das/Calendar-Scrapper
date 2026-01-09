# 📅 Course Schedule Sync - Calendar Scrapper

A modern web application that automatically syncs course schedules from Google Sheets to Google Calendar with real-time updates and cancellation alerts.

## ✨ Features

### **🔐 Secure Authentication**
- Google OAuth with domain restriction (`@iimranchi.ac.in` only)
- Role-based access: Admin can scrape, all users can sync

### **🎯 Centralized Architecture**
- **Single Source of Truth**: Only admin account scrapes the Google Sheet (no wasteful duplicate scraping)
- **Firestore Backend**: All users read from centralized Firestore database
- **Efficient**: Scales to unlimited users without additional API calls

### **👀 Preview Before Sync**
- **Visual Preview**: See exactly how events will appear in your calendar
- **One-Time Confirmation**: Review and confirm before initial sync
- **Informed Decisions**: View all your classes organized by date

### **🔄 Automated Daily Sync**
- Cloud function runs daily at 11:00 PM IST
- Admin's sheet scraping updates Firestore
- All users' calendars automatically updated
- No manual intervention needed after initial setup

### **❌ Smart Cancellation Detection**
- Detects cancelled classes (strikethrough text & red cells)
- Automatically updates calendar events
- Marks cancelled classes in red

### **📱 Modern UI**
- Beautiful dark mode with glassmorphism
- Responsive design (desktop & mobile)
- Smooth animations and transitions
- Premium aesthetic





## 🏗️ Architecture

### System Flow

```
Admin Account (saptarshi.dasi21@iimranchi.ac.in)
    ↓ Daily at 11:00 PM IST
Scrapes Google Sheet → Stores in Firestore
    ↓
All Users select courses → Preview → Confirm
    ↓
Cloud Function syncs everyone's calendar daily
```

**Key Benefits:**
- Only 1 Google Sheets API call per day (admin)
- Unlimited users, no extra API costs
- One-time setup, fully automated
- Centralized data ensures consistency

## 🚀 Getting Started

### Prerequisites

- Node.js v20+ (currently using v18, consider upgrading)
- npm or yarn
- Firebase project
- Google Cloud Project with enabled APIs:
  - Google Sheets API
  - Google Calendar API
  - Google Sign-In API

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd Calendar-Scrapper
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   
   Update `.env.local` with your credentials:
   ```env
   # Firebase Configuration
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_app_id

   # Google API Configuration
   VITE_GOOGLE_CLIENT_ID=your_google_client_id
   VITE_GOOGLE_API_KEY=your_google_api_key

   # Google Sheets Configuration
   VITE_SCHEDULE_SHEET_ID=1jis4IowMXM72jJUlz3Yanv2YBu7ilcvU
   VITE_SCHEDULE_SHEET_GID=752189081

   # Domain Restriction
   VITE_ALLOWED_DOMAIN=@iimranchi.ac.in
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to `http://localhost:5173`

## 🏗️ Project Structure

```
Calendar-Scrapper/
├── src/
│   ├── components/           # React components
│   │   ├── LoginPage.tsx
│   │   ├── CourseSelector.tsx
│   │   └── Dashboard.tsx
│   ├── services/             # Business logic
│   │   ├── sheetScraper.ts   # Google Sheets scraping
│   │   └── googleCalendar.ts # Google Calendar API
│   ├── types/                # TypeScript type definitions
│   │   └── index.ts
│   ├── firebase.ts           # Firebase configuration
│   ├── App.tsx               # Main App component
│   └── main.tsx              # Entry point
├── .env.example              # Environment variables template
├── package.json
└── README.md
```

## 🔧 Configuration

### Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Google Authentication
3. Add authorized domains
4. Copy your Firebase config to `.env.local`

### Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the following APIs:
   - Google Sheets API
   - Google Calendar API
4. Create OAuth 2.0 credentials
5. Add authorized JavaScript origins and redirect URIs
6. Copy your Client ID and API Key to `.env.local`

### Google Sheets Configuration

The app expects a schedule sheet with the following format:

| Week | Days | Time Slot 1 | Time Slot 2 | ... |
|------|------|-------------|-------------|-----|
| Week 1 | Mon | COURSE (SECTION)<br>Professor Name | ... | ... |

- **Cancelled classes**: Marked with strikethrough text or red cell background
- **Course format**: `COURSE-CODE (SECTION-ID)`

## 📱 Deployment

### Vercel (Recommended for Frontend)

```bash
npm run build
vercel --prod
```

### Cloud Functions (For Daily Sync)

The daily sync job needs to run in the cloud. Options:

1. **Google Cloud Functions**
2. **AWS Lambda**
3. **Vercel Serverless Functions**
4. **Railway**

TODO: Implement cloud function for daily synchronization.

## 🎯 Roadmap

- [x] Authentication with Google
- [x] Course selection UI
- [x] Google Sheets scraping
- [x] Google Calendar sync
- [x] Cancellation detection (basic)
- [ ] Enhanced cancellation detection (API-based)
- [ ] Firestore integration for user preferences
- [ ] Daily cloud sync automation
- [ ] Email notifications for cancellations
- [ ] Mobile app (React Native)
- [ ] Admin dashboard

## 🐛 Known Issues

1. **Node.js Version**: Current Vite requires Node.js v20+. You're on v18. Consider upgrading:
   ```bash
   nvm install 20
   nvm use 20
   ```

2. **Strikethrough Detection**: Currently not implemented. Requires Google Sheets API with HTML parsing.

3. **Red Cell Detection**: Currently not implemented. Requires Google Sheets API with cell formatting.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 👤 Author

Created for IIM Ranchi students

## 🙏 Acknowledgments

- IIM Ranchi for the course schedule
- Google for providing excellent APIs
- The React and Firebase communities

---

**Note**: This is an educational project. Make sure to comply with your institution's policies regarding automated access to their resources.
