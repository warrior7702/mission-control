# Mission Control — Git Deploy Setup

## 🎯 What This Is
Live dashboard at **https://bobbot.ngrok.app**
- Backend: `api/server.js` (Node.js + Express, port 3737)
- Frontend: `public/index.html` + `/api/dashboard` data
- Tunnel: ngrok → `bobbot.ngrok.app`

## 🔑 What Was Created Locally (Ready for GitHub Push)

| File | Purpose |
|------|---------|
| `.gitignore` | Excludes node_modules, .env, logs |
| `deploy.sh` | Pull → npm install → restart server |
| `.github/workflows/deploy.yml` | GitHub Actions → POST webhook on push |
| `api/server.js` | Added `POST /webhook/deploy` endpoint |

## 📋 Your Next Steps (3 minutes)

### 1. Create GitHub Repo
- Go here: **https://github.com/new**
- Name: `mission-control` (or whatever)
- Make it **Private** (recommended)
- Don't add README/.gitignore (we already have them)
- **Copy the two git commands**:
  ```
  git remote add origin https://github.com/YOUR_USER/mission-control.git
  git branch -M main
  git push -u origin main
  ```

### 2. Add Secrets
- Go to **Settings → Secrets and variables → Actions**
  | Secret Name | Value |
  |-------------|-------|
  | `DEPLOY_WEBHOOK` | `https://bobbot.ngrok.app/webhook/deploy` |

### 3. Optional: Add Cornerstone as Collaborator
- **Settings → Collaborators → Add people**
- Invite: `cornerstone-username@github`
- Or use this token approach if Cornerstone doesn't have a GitHub account:

## 🔑 Token Approach (No GitHub Account Needed)

**On your Ubuntu machine, generate a token:**
```bash
cd ~/.openclaw/workspace/mission-control

# Create a deploy key (no passphrase)
ssh-keygen -t ed25519 -f .deploy_key -N ""
# Get the public key
cat .deploy_key.pub
cat .deploy_key  # <-- secret key (keep private!)
```

**Add the public key to GitHub:**
- Go to **Settings → Deploy Keys → Add deploy key**
- Paste the `.deploy_key.pub` content
- ✅ Allow write access

**Tell Cornerstone the SSH URL:**
```
git clone git@github.com:YOUR_USER/mission-control.git
# then edit, commit, push — auto-deploys!
```

## ✅ How Deploy Works After Setup

```
Cornerstone edits on Mac → git push origin main
  ↓
GitHub Actions triggers
  ↓
POST https://bobbot.ngrok.app/webhook/deploy
  ↓
Ubuntu server pulls code → restarts server
  ↓
Done! Dashboard updated in ~10 seconds
```

## 🧪 Test It Now

After GitHub setup, run this on your Ubuntu box:
```bash
cd ~/.openclaw/workspace/mission-control
git remote add origin https://github.com/YOUR_USER/mission-control.git
git branch -M main
git push -u origin main
```

Then test the webhook:
```bash
curl -X POST http://localhost:3737/webhook/deploy \
  -H "Content-Type: application/json" \
  -d '{"ref":"refs/heads/main","sha":"abc1234"}'
```

## 📁 File Structure

```
mission-control/
├── api/
│   └── server.js          # Express API (3737)
├── public/
│   ├── index.html         # Dashboard UI
│   └── index.html.backup-*
├── .github/workflows/
│   └── deploy.yml         # GitHub Actions
├── deploy.sh              # Local deploy script
├── start.sh               # Manual start script
├── package.json           # Node deps
└── .gitignore             # Node_modules etc
```

## 🔒 Security Note

The `/webhook/deploy` endpoint currently has **no auth**. That's fine while the URL is secret (ngrok), but if you ever expose it publicly, add a secret header check:

```javascript
const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
app.post('/webhook/deploy', (req, res) => {
  if (req.headers['x-deploy-secret'] !== DEPLOY_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  // ... deploy logic
});
```
