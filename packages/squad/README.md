# @linkup/squad
**Maintainer:** LinkUp Social Graph Engineering

This micro-frontend manages all real-time social interactions, P2P direct messaging, study group creation, and presence states. It leverages Supabase Realtime channels directly via the core SDK to minimize latency.

### Tech Stack / Guidelines
- Fully autonomous chat components (`UserChat.jsx`).
- Handles complex binary file uploads to Cloudflare R2 / Supabase Storage.