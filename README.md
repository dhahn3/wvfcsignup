# WVFC Signups (with Positions & Unique Contact Rule)

A simple, modern signup system with:
- Admin login to create/edit/delete events
- Optional event **location**
- **Positions** per event (each with its own capacity limit)
- Public signups and self-removal using a private cancel token
- Contact rule: **Only one signup per email or phone number per event**
- SQLite + Express backend, Tailwind front end

## Run locally
1. `npm install`
2. Copy `.env.example` to `.env` and set strong values
3. `npm run dev`
4. Open http://localhost:8080

## Admin
- Go to `/admin`
- Create events; optionally set overall capacity (still used if there are no positions)
- Click **Positions** to add role slots with per-position capacity
- Roster view shows who signed and their position

## Public
- If an event has positions, users must choose a position and limits are enforced
- The system stores the cancel token in the browser so multiple people can sign up from the same device, but **the same email or phone number can only be used once per event**

## Deploy
- Push to GitHub and deploy the Node app (Render/Fly/railway/VPS/Docker)
- Set environment variables there
- `data.sqlite` is created in the app root (back it up as needed)
