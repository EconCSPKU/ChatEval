from openai import AsyncOpenAI
import base64
import json
import os
import asyncio
import io
from PIL import Image
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

Return ONLY a valid JSON array of objects with "speaker" (mapped to "Me" or "Them" if possible, otherwise describe it) and "message".
Example:
[
  {"speaker": "Me", "message": "Hello"},
  {"speaker": "Them", "message": "Hi there!"},
  {"speaker": "Them", "message": "[Sticker]"}
]
"""

client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)

def stitch_images(image_paths):
    """
    Stitches multiple images vertically into one, resizes to max width 1024,
    and returns base64 string.
    """
    images = []
    try:
        for p in image_paths:
            img = Image.open(p)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            images.append(img)
        
        if not images:
            return None
            
        max_width = 1024
        resized_imgs = []
        
        for img in images:
            w, h = img.size
            scale = max_width / w
            new_h = int(h * scale)
            resized_imgs.append(img.resize((max_width, new_h)))
            
        total_height = sum(img.size[1] for img in resized_imgs)
        
        new_img = Image.new('RGB', (max_width, total_height))
        y_offset = 0
        for img in resized_imgs:
            new_img.paste(img, (0, y_offset))
            y_offset += img.size[1]
            
        buffer = io.BytesIO()
        new_img.save(buffer, format="JPEG", quality=85)
        return base64.b64encode(buffer.getvalue()).decode('utf-8')
    except Exception as e:
        print(f"Error stitching images: {e}")
        return None
    finally:
        for img in images:
            try:
                img.close()
            except:
                pass

async def extract_chat_from_images(image_paths):
    all_results = []
    # Batch size 5 stitched into 1 image is safer and reduces API requests
    batch_size = 5
    loop = asyncio.get_event_loop()
    
    # Process images in batches
    for i in range(0, len(image_paths), batch_size):
        batch_paths = image_paths[i : i + batch_size]
        
        print(f"Processing batch {i//batch_size + 1}/{(len(image_paths) + batch_size - 1)//batch_size} (stitching {len(batch_paths)} images)...")

        # Stitch images in this batch into a SINGLE base64 image
        base64_image = None
        try:
            base64_image = await loop.run_in_executor(None, stitch_images, batch_paths)
        except Exception as e:
            print(f"Error stitching batch {i}: {e}")
            continue

        if not base64_image:
            continue

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": Prompt_Template},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}",
                        },
                    }
                ],
            }
        ]

        batch_success = False
        for attempt in range(3):
            try:
                response = await client.chat.completions.create(
                    model=MODEL_PATH,
                    messages=messages,
                )
                chat_content = response.choices[0].message.content
                if chat_content:
                    if "```json" in chat_content:
                        chat_content = chat_content.split("```json")[1].split("```")[0].strip()
                    elif "```" in chat_content:
                        chat_content = chat_content.split("```")[1].strip()
                    
                    try:
                        parsed_json = json.loads(chat_content)
                        
                        batch_res = []
                        for line in parsed_json:
                            speaker = line.get('speaker', 'Unknown')
                            # Simple heuristic normalization
                            if any(k in speaker.lower() for k in ["me", "right", "green", "blue", "self"]):
                                speaker_label = "Me"
                            elif any(k in speaker.lower() for k in ["them", "left", "white", "gray", "grey", "other"]):
                                speaker_label = "Them"
                            else:
                                speaker_label = speaker # Fallback
                                
                            batch_res.append({"speaker": speaker_label, "message": line.get('message', '')})
                        
                        if batch_res:
                            all_results.extend(batch_res)
                            batch_success = True
                            break # Success, exit retry loop
                    except json.JSONDecodeError:
                        print(f"JSON Parse Error on batch {i} attempt {attempt}: {chat_content[:100]}...")
            except Exception as e:
                print(f"API Error on batch {i} attempt {attempt}: {e}")
                await asyncio.sleep(1) # Small delay between retries
        
        if not batch_success:
            print(f"Failed to extract from batch starting at index {i}")
            
    return all_results if all_results else None
