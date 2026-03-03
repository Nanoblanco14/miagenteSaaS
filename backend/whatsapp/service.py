"""
WhatsApp Cloud API service — send messages and parse incoming webhooks.
"""
import httpx
from typing import Optional
from backend.config import WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_API_VERSION

BASE_URL = f"https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages"


async def send_text_message(to: str, text: str) -> dict:
    """Send a text message via WhatsApp Cloud API."""
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": text},
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(BASE_URL, json=payload, headers=headers)
        return response.json()


async def send_image_message(to: str, image_url: str, caption: str = "") -> dict:
    """Send an image message via WhatsApp Cloud API."""
    headers = {
        "Authorization": f"Bearer {WHATSAPP_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "image",
        "image": {"link": image_url, "caption": caption},
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(BASE_URL, json=payload, headers=headers)
        return response.json()


def parse_incoming_message(body: dict) -> Optional[dict]:
    """
    Parse an incoming WhatsApp webhook payload.
    Returns dict with: from_number, message_text, message_type, media_id (if any).
    """
    try:
        entry = body.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})

        messages = value.get("messages", [])
        if not messages:
            return None

        msg = messages[0]
        contacts = value.get("contacts", [{}])
        contact_name = contacts[0].get("profile", {}).get("name", "") if contacts else ""

        result = {
            "from_number": msg.get("from", ""),
            "contact_name": contact_name,
            "message_type": msg.get("type", "text"),
            "message_text": "",
            "media_id": None,
        }

        if msg.get("type") == "text":
            result["message_text"] = msg.get("text", {}).get("body", "")
        elif msg.get("type") == "image":
            result["media_id"] = msg.get("image", {}).get("id")
            result["message_text"] = msg.get("image", {}).get("caption", "[Imagen recibida]")
        elif msg.get("type") == "document":
            result["media_id"] = msg.get("document", {}).get("id")
            result["message_text"] = msg.get("document", {}).get("caption", "[Documento recibido]")
        elif msg.get("type") == "audio":
            result["media_id"] = msg.get("audio", {}).get("id")
            result["message_text"] = "[Audio recibido]"
        else:
            result["message_text"] = f"[{msg.get('type', 'unknown')} message received]"

        return result

    except (IndexError, KeyError):
        return None
