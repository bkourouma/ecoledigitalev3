# Fix Database Configuration for API Backend

## Problem
The API backend is using the wrong database password, causing authentication to fail.

## Solution

### Option 1: Set Environment Variable (Recommended)

Create or update `apps/api/.env` file with:

```env
DATABASE_URL=postgresql://postgres:<mot-de-passe>@localhost:5432/dbecoledigitale
PORT=4000
NODE_ENV=development
```

### Option 2: Restart API Backend

If the API backend is already running, you need to restart it:

1. Stop the API backend (Ctrl+C in the terminal where it's running)
2. Restart it:
   ```bash
   cd apps/api
   npm run dev
   ```

The API backend will now use the updated password from `config.js`.

## Verify

After restarting, test the login:

```bash
npx tsx scripts/test-parent-login.ts
```

You should see:
```
✅ Login successful!
```

## Current Configuration

- Database: `dbecoledigitale`
- User: `postgres`
- Password: (celui de votre DATABASE_URL)
- Host: `localhost:5432`

