# Azure AD SSO Setup for Mission Control

## Step 1: Create Azure AD App Registration

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Click "New registration"
3. **Name:** Mission Control Dashboard
4. **Supported account types:** Single tenant (FBCA org only)
5. **Redirect URI:** 
   - Type: Web
   - URL: `https://bobbot.ngrok.app/auth/callback`
6. Click "Register"

## Step 2: Get Credentials

After registration:
1. **Application (client) ID** — Copy this
2. **Directory (tenant) ID** — Copy this
3. Go to "Certificates & secrets" → "New client secret"
   - Description: Mission Control Secret
   - Expires: 24 months
   - Click "Add"
   - **Copy the secret value immediately** (won't be shown again)

## Step 3: Configure API Permissions

1. Go to "API permissions"
2. Click "Add a permission" → Microsoft Graph → Delegated permissions
3. Add these permissions:
   - `User.Read` (read user profile)
   - `email` (read user email)
   - `profile` (read basic profile)
4. Click "Grant admin consent for FBCA"

## Step 4: Create auth-config.json

```bash
cd ~/.openclaw/workspace/mission-control/api
cp auth-config.json.template auth-config.json
```

Edit `auth-config.json`:
- Replace `YOUR_TENANT_ID` with Directory (tenant) ID
- Replace `YOUR_CLIENT_ID` with Application (client) ID  
- Replace `YOUR_CLIENT_SECRET` with the secret value
- Generate random keys:
  ```bash
  # 32-char encryption key
  node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
  
  # 12-char IV
  node -e "console.log(require('crypto').randomBytes(6).toString('hex'))"
  ```

## Step 5: Deploy

1. Commit and push changes (auth-config.json is gitignored)
2. Copy auth-config.json to server:
   ```bash
   scp api/auth-config.json bnelms@finn-1:/home/bnelms/.openclaw/workspace/mission-control/api/
   ```
3. Restart Mission Control server

## Testing

1. Open https://bobbot.ngrok.app/
2. Should redirect to Microsoft login
3. After login, shows "Welcome, [Your Name]"
4. Share URL with boss/intern — they'll see their own name after login

## Troubleshooting

**"Redirect URI mismatch"**
- Check redirect URI matches exactly: `https://bobbot.ngrok.app/auth/callback`

**"AADSTS50105: User not assigned"**
- In Azure AD → Enterprise applications → Mission Control → Users and groups
- Add users who should have access

**Session expires quickly**
- Increase `cookie.maxAge` in server.js (default: 24 hours)
