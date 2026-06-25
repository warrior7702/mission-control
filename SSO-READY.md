# ✅ Mission Control SSO - Ready for Configuration

**Status:** Code deployed, Azure AD setup required

---

## What's Done

✅ **Authentication System**
- Passport.js + Azure AD OpenID Connect
- Session management (24-hour cookies)
- Dev mode fallback (works without SSO)

✅ **Dynamic User Greeting**
- Fetches logged-in user from `/api/user`
- Shows "Good morning, [FirstName]"
- Falls back to "User" if auth fails

✅ **Shareable Dashboard**
- Once SSO is configured, anyone with FBCA M365 account can access
- Each person sees their own name
- Access control via Azure AD user assignment

---

## Next Steps (5-10 minutes)

### 1. Create Azure AD App Registration

https://portal.azure.com → Azure Active Directory → App registrations

**Settings:**
- Name: `Mission Control Dashboard`
- Single tenant (FBCA only)
- Redirect URI: `https://bobbot.ngrok.app/auth/callback`

**Copy 3 values:**
1. Application (client) ID
2. Directory (tenant) ID  
3. Client secret (Certificates & secrets → New secret)

### 2. Set Permissions

API permissions → Microsoft Graph:
- `User.Read`
- `email`
- `profile`

Click "Grant admin consent for FBCA"

### 3. Create auth-config.json

```bash
cd ~/.openclaw/workspace/mission-control/api
cp auth-config.json.template auth-config.json
nano auth-config.json
```

Replace:
- `YOUR_TENANT_ID` → Directory (tenant) ID
- `YOUR_CLIENT_ID` → Application (client) ID
- `YOUR_CLIENT_SECRET` → Secret value

Generate random keys:
```bash
# 32-char key
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# 12-char IV
node -e "console.log(require('crypto').randomBytes(6).toString('hex'))"
```

### 4. Deploy to finn-1

```bash
# Copy config to server
scp api/auth-config.json bnelms@finn-1:/home/bnelms/.openclaw/workspace/mission-control/api/

# SSH to server
tailscale ssh bnelms@finn-1

# Pull latest code
cd /home/bnelms/.openclaw/workspace/mission-control
git pull origin main

# Install new packages
npm install

# Restart server
pkill -f 'node.*server.js'
nohup node api/server.js > /tmp/mc.log 2>&1 &
```

### 5. Test

1. Open https://bobbot.ngrok.app/
2. Should redirect to Microsoft login
3. After login: "Good morning, Billy"
4. Share URL with boss/intern — they see their own name

---

## Assign Users (Optional)

By default, any FBCA M365 user can access.

**To restrict access:**
1. Azure Portal → Enterprise applications → Mission Control Dashboard
2. Properties → "User assignment required?" → Yes
3. Users and groups → Add users
4. Only assigned users can log in

---

## Troubleshooting

**"Redirect URI mismatch"**
- Fix in Azure Portal: Redirect URI must be `https://bobbot.ngrok.app/auth/callback`

**Shows "User" instead of name**
- Check `/tmp/mc.log` for auth errors
- Verify auth-config.json on server

**Server won't start**
- Check for syntax errors: `node api/auth.js` (should exit clean)
- Verify all 3 npm packages installed: `npm list passport passport-azure-ad express-session`

---

## Dev Mode (No SSO)

If `auth-config.json` doesn't exist:
- Dashboard works without login
- Shows "Good morning, Billy"
- Dev only — not for production sharing
