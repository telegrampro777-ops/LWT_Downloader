# ⚡ LWT Torrent Streamer

LWT (LearnWise Together) is a high-performance, professional torrent streaming platform built for a seamless, software-free experience. Stream any magnet link instantly directly in your browser.

![LWT Header](https://ui-avatars.com/api/?name=LWT&background=6366f1&color=fff&size=128)

## 🚀 Features

- **Instant Streaming**: Start watching movies before the download hits 100%.
- **Secure Auth**: Support for Google OAuth 2.0 and Email/Password login.
- **Premium UI**: Dark glassmorphism design with professional profile management.
- **User History**: Keep track of your streamed torrents in your own private history.
- **Self-Cleaning**: Automatic cleanup of idle torrents to save server resources.

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Streaming Engine**: WebTorrent (v1)
- **Database**: SQLite (via `better-sqlite3`)
- **Authentication**: Passport.js
- **Frontend**: Vanilla HTML5, CSS3, ES6 JavaScript

## 📦 Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/LWT-Torrent-Streamer.git
   cd LWT-Torrent-Streamer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment variables (`.env`):
   ```env
   GOOGLE_CLIENT_ID=your_id
   GOOGLE_CLIENT_SECRET=your_secret
   SESSION_SECRET=your_random_secret
   PORT=3000
   ```

4. Start the server:
   ```bash
   node server.js
   ```

## 🌐 Deployment (Render.com)

1. Create a **Web Service** on Render.
2. Connect this repository.
3. Add your `.env` variables in the **Environment** tab.
4. (Optional) For persistent user data, add a **Render Disk** to store `users.db`.

---
⚡ Powered by **LWT Team**
