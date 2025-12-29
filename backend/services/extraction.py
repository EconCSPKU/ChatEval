from openai import AsyncOpenAI
import base64
import json
import os
import asyncio

API_KEY = os.getenv("VOLC_API_KEY")
BASE_URL = os.getenv("VOLC_BASE_URL")
MODEL_PATH = "doubao-seed-1-6-lite-251015" # Model name for chat completion

Prompt_Template = """Please extract all conversational turns from the provided image. For each turn, identify the speaker (group by chat bubble color) and the full text of their message, including any descriptions of stickers or emojis if they convey meaning, ignoring the avatars. Present the extracted content as a list of dictionaries, where each dictionary represents a single chat turn. Each dictionary should have the following keys:

- "speaker": A string identifying the speaker (e.g., "Green Bubble", "White Bubble", "Gray Small Bubble").
- "message": A string containing the full text of the message, with sticker descriptions in parentheses (e.g., "Hello! (waving hand sticker)").

Example output format:

[
    {"speaker": "Green Bubble", "message": "Hi there!"},
    {"speaker": "White Bubble", "message": "How are you? (smiling face emoji)"},
    {"speaker": "Green Bubble", "message": "I'm good, thanks!"}
]
"""

client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)

def encode_image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

async def extract_chat_from_images(image_paths):
    base64s = []
    image_formats = []
    
    # Run blocking file IO in a thread if strictly necessary, but for small files it's ok.
    # Or better, use aiofiles, but standard open is fine for now as it's fast on SSD.
    # To be perfectly async safe:
    loop = asyncio.get_event_loop()
    
    for image_path in image_paths:
        try:
            # Offload file reading
            base64_image = await loop.run_in_executor(None, encode_image_to_base64, image_path)
            base64s.append(base64_image)
            image_formats.append(image_path.split('.')[-1])
        except Exception as e:
            print(f"Error encoding image {image_path}: {e}")
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
                        "url": f"data:image/{image_formats[i]};base64,{base64s[i]}",
                    },
                } for i in range(len(image_paths))
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
                        if "Green" in speaker or "Right" in speaker:
                            speaker_label = "Me"
                        elif "White" in speaker or "Left" in speaker:
                            speaker_label = "Them"
                        else:
                            speaker_label = speaker
                            
                        res.append({"speaker": speaker_label, "message": line.get('message', '')})
                    
                    if res:
                        return res
                except json.JSONDecodeError:
                    print(f"JSON Parse Error on attempt {attempt}: {chat_content[:100]}...")
        except Exception as e:
            print(f"API Error on attempt {attempt}: {e}")
            
    return None

