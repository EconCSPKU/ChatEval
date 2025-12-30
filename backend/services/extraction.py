from openai import AsyncOpenAI
import base64
import json
import os
import asyncio
from dotenv import load_dotenv
load_dotenv()

API_KEY = os.getenv("VOLC_API_KEY")
BASE_URL = os.getenv("VOLC_BASE_URL")
MODEL_PATH = "doubao-seed-1-6-lite-251015" # Model name for chat completion

Prompt_Template = """Please extract the chat history from the provided image(s) into a JSON list.
1. Identify speakers by their bubble color or position (e.g., "Right/Green" is usually "Me", "Left/White/Gray" is "Them").
2. Ignore background wallpapers/images. Focus on the chat bubbles and text.
3. If a message is a sticker, emoji, or image without text, output "[Sticker]" or a brief description in brackets.
4. Ignore system messages (like timestamps, "Today", "read").

Note: The image might be compressed. Rely on the relative position (Left vs Right) as the primary indicator for speakers, and color as a secondary confirmation.

Return ONLY a valid JSON array of objects with "speaker" (mapped to "Me" or "Them" if possible, otherwise describe it) and "message".
Example:
[
  {"speaker": "Me", "message": "Hello"},
  {"speaker": "Them", "message": "Hi there!"},
  {"speaker": "Them", "message": "[Sticker]"}
]
"""

client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)

def process_image(image_path):
    """
    Reads the image file and encodes it to base64.
    Compression and resizing are now handled on the frontend.
    """
    try:
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
            
    except Exception as e:
        print(f"Error processing image {image_path}: {e}")
        return None

async def extract_chat_from_images(image_paths):
    base64s = []
    # We convert all to JPEG
    
    # Run blocking file IO in a thread if strictly necessary, but for small files it's ok.
    # Or better, use aiofiles, but standard open is fine for now as it's fast on SSD.
    # To be perfectly async safe:
    loop = asyncio.get_event_loop()
    
    for image_path in image_paths:
        try:
            # Offload file reading and processing
            base64_image = await loop.run_in_executor(None, process_image, image_path)
            if base64_image:
                base64s.append(base64_image)
        except Exception as e:
            print(f"Error encoding image {image_path}: {e}")
            continue
    
    if not base64s:
        return None

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": Prompt_Template},
            ] +
            [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}",
                    },
                } for base64_image in base64s
            ],
        }
    ]

    for attempt in range(3):
        try:
            response = await client.chat.completions.create(
                model=MODEL_PATH,
                messages=messages,
            )
            chat_content = response.choices[0].message.content
            if chat_content:
                # Cleaning markdown code blocks if present
                if "```json" in chat_content:
                    chat_content = chat_content.split("```json")[1].split("```")[0].strip()
                elif "```" in chat_content:
                    chat_content = chat_content.split("```")[1].strip()
                
                try:
                    parsed_json = json.loads(chat_content)
                    
                    res = []
                    for line in parsed_json:
                        speaker = line.get('speaker', 'Unknown')
                        # Simple heuristic normalization
                        if any(k in speaker.lower() for k in ["me", "right", "green", "blue", "self"]):
                            speaker_label = "Me"
                        elif any(k in speaker.lower() for k in ["them", "left", "white", "gray", "grey", "other"]):
                            speaker_label = "Them"
                        else:
                            speaker_label = speaker # Fallback
                            
                        res.append({"speaker": speaker_label, "message": line.get('message', '')})
                    
                    if res:
                        return res
                except json.JSONDecodeError:
                    print(f"JSON Parse Error on attempt {attempt}: {chat_content[:100]}...")
        except Exception as e:
            print(f"API Error on attempt {attempt}: {e}")
            
    return None

