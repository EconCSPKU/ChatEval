from openai import AsyncOpenAI
import base64
import json
import os
import asyncio
from dotenv import load_dotenv
load_dotenv()

# OpenRouter Configuration
API_KEY = os.getenv("OPENROUTER_API_KEY")
BASE_URL = "https://openrouter.ai/api/v1"
MODEL_PATH = "google/gemini-3-flash-preview" # Fast & Multimodal

# System Prompt: Defines role and strict rules
System_Prompt = """You are a specialized OCR engine for chat screenshots.
Your task: Extract the dialogue history into a strict JSON list.

**CRITICAL SPEAKER IDENTIFICATION RULES:**
1. **Me**: Bubbles aligned to the **RIGHT** side. (Often Green/Blue/Dark)
2. **Them**: Bubbles aligned to the **LEFT** side. (Often White/Gray)
*Focus primarily on horizontal alignment (Left vs Right).*

**EXTRACTION RULES:**
- **Exact Text**: Transcribe the MAIN message content exactly as seen.
- **Stickers/Images**: Use "[Sticker]" or "[Image]" if no text is present.
- **Voice**: Use "[Voice Message]" for audio bubbles.
- **EXCLUDE (Strictly)**:
  - Timestamps (e.g., "10:30 AM", "Yesterday").
  - System notices ("You recalled a message").
  - Battery/Signal icons, App headers.
  - **Quoted/Reply Text**: Often smaller, gray text appearing immediately below the main message (e.g., "Replied to: ..."). IGNORE THIS.
  - **Auxiliary Text**: Small gray notes like "Translated by WeChat" or "Original Text". IGNORE THIS.

**OUTPUT FORMAT:**
Return raw JSON array ONLY. No markdown. No explanations.
Example:
[{"speaker": "Me", "message": "Hi"}, {"speaker": "Them", "message": "Hello"}]
"""

# Initialize client with OpenRouter specific headers
client = AsyncOpenAI(
    api_key=API_KEY, 
    base_url=BASE_URL,
    default_headers={
        "HTTP-Referer": "https://chateval.app", 
        "X-Title": "ChatEval"
    }
)

async def extract_chat_from_images(base64_images):
    if not base64_images:
        return None

    # Construct messages with System Prompt for better adherence
    messages = [
        {"role": "system", "content": System_Prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Extract chat from these images:"},
            ] +
            [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": img if img.startswith("data:") else f"data:image/webp;base64,{img}",
                    },
                } for img in base64_images
            ],
        }
    ]

    # Only try once
    for attempt in range(1):
        try:
            response = await client.chat.completions.create(
                model=MODEL_PATH,
                messages=messages,
                # temperature=0.1 helps with determinism for extraction tasks
                temperature=0.1, 
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

