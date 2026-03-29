const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const db = require('./db');

// Local Strategy (Email/Password)
passport.use(new LocalStrategy({
  usernameField: 'email',
  passwordField: 'password'
}, (email, password, done) => {
  try {
    const user = db.getUserByEmail(email);
    if (!user || !user.password_hash) {
      return done(null, false, { message: 'Incorrect email or password.' });
    }
    
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return done(null, false, { message: 'Incorrect email or password.' });
    }
    
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

// Google Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    proxy: true
  }, (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user already exists
      let user = db.getUserByGoogleId(profile.id);
      
      if (!user) {
        // Create new Google user
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const name = profile.displayName;
        const avatar = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
        
        const userId = db.createGoogleUser(profile.id, email, name, avatar);
        user = db.getUserById(userId);
      }
      
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

// Session Serialization
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const user = db.getUserById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
