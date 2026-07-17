import os
import asyncio
import logging
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import FloodWaitError
from telethon.tl.types import (
    ChannelParticipantAdmin, 
    ChannelParticipantCreator, 
    ChatParticipantAdmin, 
    ChatParticipantCreator
)
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
        logger.info("Session linked. Fetching all active group targets from Supabase...")
        
        # 1. Fetch ALL active targets (public and private)
        response = supabase.table("campus_channels").select("*").eq("is_active", True).execute()
        channels = response.data

        if not channels:
            logger.info("No active channels found. Exiting.")
            return

        total_new_messages = 0

        for chan in channels:
            is_private = chan.get("is_private", False)
            handle = chan.get("channel_handle")
            peer_id = chan.get("telegram_peer_id")
            last_id = chan.get("last_scraped_id") or 0
            
            # Smart Target Resolution
            target_peer = None
            if is_private and peer_id:
                try:
                    target_peer = int(peer_id)
                except (ValueError, TypeError):
                    target_peer = peer_id
            else:
                target_peer = handle

            if not target_peer:
                logger.warning(f"Row {chan.get('id')} has invalid routing data (Private: {is_private}, Handle: {handle}, ID: {peer_id}). Skipping.")
                continue

            logger.info(f"Processing Target: {target_peer} (Private: {is_private}, Last Scraped ID: {last_id})")

            try:
                # Resolve the entity natively
                try:
                    entity = await client.get_entity(target_peer)
                except Exception as e:
                    # Self-healing fallback for legacy negative IDs
                    if isinstance(target_peer, int) and target_peer < 0 and not str(target_peer).startswith("-100"):
                        fallback_peer = int(f"-100{abs(target_peer)}")
                        logger.info(f"Failed to resolve legacy ID {target_peer}. Trying supergroup fallback ID: {fallback_peer}")
                        entity = await client.get_entity(fallback_peer)
                    else:
                        raise e

                # --- STEP A: SCRAPE MEMBER DIRECTORY ---
                members_data = []
                logger.info(f"Extracting member directory for {target_peer}...")
                try:
                    async for user in client.iter_participants(entity):
                        is_admin = False
                        if hasattr(user, 'participant'):
                            is_admin = isinstance(user.participant, (
                                ChannelParticipantAdmin, 
                                ChannelParticipantCreator, 
                                ChatParticipantAdmin, 
                                ChatParticipantCreator
                            ))
                        
                        members_data.append({
                            "user_id": user.id,
                            "username": user.username,
                            "first_name": user.first_name or "",
                            "last_name": user.last_name or "",
                            "status": type(user.status).__name__ if user.status else "Unknown",
                            "is_bot": user.bot or False,
                            "is_admin": is_admin
                        })
                    logger.info(f"Successfully extracted {len(members_data)} members.")
                except Exception as e:
                    logger.warning(f"Could not extract participants for {target_peer} (Bot API limits or restrictions): {e}")

                # --- STEP B: SCRAPE MESSAGE HISTORY ---
                new_posts = []
                current_highest_id = last_id

                fetch_args = {"limit": 150} # Slighly higher limit for active groups
                if last_id > 0:
                    fetch_args["min_id"] = last_id
                    logger.info(f"Incremental mode: Fetching messages newer than {last_id}")
                else:
                    logger.info("First run: Fetching the most recent messages.")

                async for message in client.iter_messages(entity, **fetch_args):
                    if not message.text and not message.photo:
                        continue

                    if message.id > current_highest_id:
                        current_highest_id = message.id

                    # Resolve Sender Identity
                    sender_id = message.sender_id
                    sender_username = None
                    sender_name = "Unknown"
                    
                    if message.sender:
                        sender_username = getattr(message.sender, 'username', None)
                        fname = getattr(message.sender, 'first_name', '') or ''
                        lname = getattr(message.sender, 'last_name', '') or ''
                        sender_name = f"{fname} {lname}".strip() or "Unknown"

                    new_posts.append({
                        "telegram_id": message.id,
                        "channel_handle": handle if handle else str(peer_id),
                        "full_text": message.text or "",
                        "image_url": "MEDIA_ATTACHED" if message.photo else None,
                        "telegram_timestamp": message.date.isoformat(),
                        "sender_id": sender_id,
                        "sender_username": sender_username,
                        "sender_name": sender_name,
                        "metadata": {
                            "source": "shadow_scraper", 
                            "is_private": is_private,
                            "peer_id": peer_id
                        }
                    })

                # --- STEP C: SYNC WAREHOUSE ---
                update_payload = {
                    "last_scraped_id": current_highest_id
                }
                
                # Only overwrite members if we successfully pulled them
                if members_data:
                    update_payload["members_data"] = members_data

                if new_posts:
                    logger.info(f"Found {len(new_posts)} new messages. Syncing Database...")
                    supabase.table("campus_feed").upsert(new_posts, on_conflict="channel_handle, telegram_id").execute()
                    
                    supabase.table("campus_channels").update(update_payload).eq("id", chan["id"]).execute()
                    total_new_messages += len(new_posts)
                else:
                    # Update member directory anyway even if no new messages
                    if members_data:
                        supabase.table("campus_channels").update(update_payload).eq("id", chan["id"]).execute()
                    logger.info(f"No new message content for {target_peer}.")

            except FloodWaitError as fwe:
                logger.warning(f"Rate limited by Telegram! Sleeping for {fwe.seconds} seconds...")
                await asyncio.sleep(fwe.seconds)
            except Exception as e:
                logger.error(f"Failed to scrape {target_peer}: {str(e)}")

            # Anti-flood buffer between heavy group extractions
            await asyncio.sleep(2)

        logger.info(f"Cycle Complete. Shadow Scraper ingested {total_new_messages} messages globally.")

if __name__ == "__main__":
    asyncio.run(run_scraper())