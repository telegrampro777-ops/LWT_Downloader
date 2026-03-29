const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'users.db');

// Initialize database
const db = new Database(DB_PATH);

// Create users table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    name TEXT,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = {
  db,
  
  // User Helpers
  getUserById: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  getUserByEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email),
  getUserByGoogleId: (googleId) => db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId),
  
  createUser: (email, passwordHash, name, avatar) => {
    const info = db.prepare('INSERT INTO users (email, password_hash, name, avatar) VALUES (?, ?, ?, ?)')
      .run(email, passwordHash, name, avatar);
    return info.lastInsertRowid;
  },
  
  createGoogleUser: (googleId, email, name, avatar) => {
    const info = db.prepare('INSERT INTO users (google_id, email, name, avatar) VALUES (?, ?, ?, ?)')
      .run(googleId, email, name, avatar);
    return info.lastInsertRowid;
  },
  
  deleteUser: (id) => {
    return db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
};
