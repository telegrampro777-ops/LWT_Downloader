const express = require('express');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const db = require('./db');
const router = express.Router();

// ── Google OAuth Routes ─────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login?error=Google login failed' }),
  (req, res) => {
    res.redirect('/');
  }
);

// ── Local Auth Routes ───────────────────────────────────────
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info.message });
    
    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.json({ success: true, user: { name: user.name, avatar: user.avatar } });
    });
  })(req, res, next);
});

router.post('/register', (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  
  try {
    const existing = db.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered.' });
    }
    
    const hash = bcrypt.hashSync(password, 10);
    const userId = db.createUser(email, hash, name, null);
    const user = db.getUserById(userId);
    
    req.logIn(user, (err) => {
      if (err) return res.status(500).json({ error: 'Failed to login after registration.' });
      return res.json({ success: true, user: { name: user.name, avatar: user.avatar } });
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login');
  });
});

// ── User Check Route ────────────────────────────────────────
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      authenticated: true, 
      user: { 
        name: req.user.name, 
        avatar: req.user.avatar, 
        email: req.user.email,
        created_at: req.user.created_at
      } 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ── Delete Account Route ────────────────────────────────────
router.delete('/delete-account', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const userId = req.user.id;
    db.deleteUser(userId);
    req.logout(() => {
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

module.exports = router;
