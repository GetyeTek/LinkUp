import os
import asyncio
import logging
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from supabase import create_client, Client

# --- LOGGING CONFIG ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - [%(levelname)s] - %(message)s'
)
logger = logging.getLogger("ShadowScraper")

# --- ENV CONFIG ---
API_ID = os.getenv("TG_API_ID")
API_HASH = os.getenv("TG_API_HASH")
SESSION_STR = os.getenv("TG_SESSION_STRING")
SB_URL = os.getenv("SUPABASE_URL")
SB_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not all([API_ID, API_HASH, SESSION_STR, SB_URL, SB_KEY]):
    logger.error("Missing critical environment variables. Check your GitHub Secrets.")
    exit(1)

supabase: Client = create_client(SB_URL, SB_KEY)

async def run_scraper():
    logger.info("Connecting to Telegram...")
    async with TelegramClient(StringSession(SESSION_STR), int(API_ID), API_HASH) as client:
        logger.info("Session linked. Fetching private targets from Supabase...")
        
        # 1. Fetch private active channels
        response = supabase.table("campus_channels").select("*").eq("is_private", True).eq("is_active", True).execute()
        channels = response.data

        if not channels:
            logger.info("No active private channels found. Exiting.")
            return

        total_new_messages = 0

        for chan in channels:
            handle = chan.get("channel_handle")
            peer_id = chan.get("telegram_peer_id")
            last_id = chan.get("last_scraped_id") or 0
            
            # Use Peer ID primarily, fallback to handle
            target = peer_id if peer_id else handle
            logger.info(f"Processing: {handle or peer_id} (Last Scraped ID: {last_id})")

            try:
                new_posts = []
                current_highest_id = last_id

                # 2. MTProto Fetch with offset logic (Backfill/Incremental)
                async for message in client.iter_messages(target, min_id=last_id, limit=100):
                    if not message.text and not message.photo:
                        continue

                    # Track highest ID for cursor update
                    if message.id > current_highest_id:
                        current_highest_id = message.id

                    # Extract Image (if exists)
                    img_path = None
                    # Note: We don't download files here to keep the script fast/cheap.
                    # We store that an image exists; Miron usually only needs the text context.

                    new_posts.append({
                        "telegram_id": message.id,
                        "channel_handle": handle or str(peer_id),
                        "full_text": message.text,
                        "image_url": "MEDIA_ATTACHED" if message.photo else None,
                        "telegram_timestamp": message.date.isoformat(),
                        "metadata": {"source": "shadow_scraper", "is_private": True}
                    })

                # 3. Upsert into Data Warehouse
                if new_posts:
                    logger.info(f"Found {len(new_posts)} new messages in {handle or peer_id}. Syncing...")
                    supabase.table("campus_feed").upsert(new_posts, on_conflict="channel_handle, telegram_id").execute()
                    
                    # 4. Update the tracker cursor
                    supabase.table("campus_channels").update({"last_scraped_id": current_highest_id}).eq("id", chan["id"]).execute()
                    total_new_messages += len(new_posts)
                else:
                    logger.info(f"No new content for {handle or peer_id}.")

            except Exception as e:
                logger.error(f"Failed to scrape {handle or peer_id}: {str(e)}")

        logger.info(f"Cycle Complete. Shadow Scraper ingested {total_new_messages} messages.")

if __name__ == "__main__":
    asyncio.run(run_scraper())