const passport = require('passport');
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;
const session = require('express-session');
const fs = require('fs');
const path = require('path');

// Load auth config
let authConfig;
try {
  authConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-config.json'), 'utf8'));
} catch (err) {
  console.error('⚠️  auth-config.json not found. SSO disabled. See AZURE-AD-SETUP.md');
  authConfig = null;
}

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

// Configure Azure AD strategy
if (authConfig) {
  const strategy = new OIDCStrategy({
    identityMetadata: `https://${authConfig.metadata.authority}/${authConfig.credentials.tenantID}/${authConfig.metadata.version}/${authConfig.metadata.discovery}`,
    clientID: authConfig.credentials.clientID,
    responseType: 'code',
    responseMode: 'form_post',
    redirectUrl: authConfig.redirectUrl,
    allowHttpForRedirectUrl: authConfig.allowHttpForRedirectUrl,
    clientSecret: authConfig.credentials.clientSecret,
    validateIssuer: authConfig.settings.validateIssuer,
    passReqToCallback: authConfig.settings.passReqToCallback,
    scope: ['profile', 'email', 'openid'],
    loggingLevel: authConfig.settings.loggingLevel,
    nonceLifetime: null,
    nonceMaxAmount: 5,
    useCookieInsteadOfSession: false,
    cookieEncryptionKeys: authConfig.cookieEncryptionKeys,
    clockSkew: null
  },
  (iss, sub, profile, accessToken, refreshToken, done) => {
    if (!profile.oid) {
      return done(new Error('No OID found in user profile'));
    }
    
    // Extract user info
    const user = {
      oid: profile.oid,
      displayName: profile.displayName || profile.name || 'User',
      email: profile._json.email || profile._json.preferred_username || profile.upn || '',
      firstName: profile._json.given_name || '',
      lastName: profile._json.family_name || ''
    };
    
    return done(null, user);
  });

  passport.use(strategy);
}

// Middleware to require authentication
function ensureAuthenticated(req, res, next) {
  if (!authConfig) {
    // SSO not configured, allow through (dev mode)
    req.user = { displayName: 'Billy', email: 'billy.nelms@fbca.org', firstName: 'Billy' };
    return next();
  }
  
  if (req.isAuthenticated()) {
    return next();
  }
  
  // API requests return 401 instead of redirecting
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required', authenticated: false });
  }
  
  // Store original URL for redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

// Setup auth routes and middleware
function setupAuth(app) {
  if (!authConfig) {
    console.log('ℹ️  Running without SSO (dev mode)');
    return;
  }

  // Session middleware
  app.use(session({
    secret: authConfig.cookieEncryptionKeys[0].key,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      secure: true,
      sameSite: 'none'
    }
  }));

  // Passport middleware
  app.use(passport.initialize());
  app.use(passport.session());

  // Auth routes
  app.get('/auth/login', passport.authenticate('azuread-openidconnect', { 
    failureRedirect: '/auth/error' 
  }));

  app.post('/auth/callback',
    passport.authenticate('azuread-openidconnect', { 
      failureRedirect: '/auth/error' 
    }),
    (req, res) => {
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);
    }
  );

  app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error('Logout error:', err);
      }
      req.session.destroy(() => {
        res.redirect(authConfig.destroySessionUrl);
      });
    });
  });

  // User profile endpoint
  app.get('/api/user', ensureAuthenticated, (req, res) => {
    res.json({
      authenticated: true,
      displayName: req.user.displayName,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName
    });
  });

  console.log('✅ Azure AD SSO configured');
}

module.exports = { setupAuth, ensureAuthenticated };
