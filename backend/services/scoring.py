import torch
import torch.nn as nn
import numpy as np
from openai import AsyncOpenAI
import asyncio
import os
from dotenv import load_dotenv
load_dotenv()

# Configuration
API_KEY = os.getenv("VOLC_API_KEY")
BASE_URL = os.getenv("VOLC_BASE_URL")
MODEL_NAME = "doubao-embedding-large-text-250515"

# Path to the PyTorch model
# Assuming running from root or backend directory, adjust relative path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, 'models', 'best_scorer_doubao-embedding-large-text-250515_en.pth')

PROMPT_TEMPLATE_EN = """
Score the following response given the corresponding dialogue context on a continuous scale from 0 to 100, where a score of zero means ‘disengaging’ and a score of 100 means ‘very engaging’. Assume the response immediately follows the dialogue context.
Dialogue context:
{context}
Response:
{response}
Score:
"""

class ScoringNetwork(nn.Module):
    def __init__(self, input_size: int):
        super(ScoringNetwork, self).__init__()
        self.layer1 = nn.Linear(input_size, input_size // 2)
        self.relu1 = nn.PReLU()
        self.layer2 = nn.Linear(input_size // 2, input_size // 4)
        self.relu2 = nn.PReLU()
        self.layer3 = nn.Linear(input_size // 4, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.layer1(x)
        x = self.relu1(x)
        x = self.layer2(x)
        x = self.relu2(x)
        x = self.layer3(x)
        return self.sigmoid(x) * 10 - 5

async def get_api_embeddings(batch_sentences):
    try:
        aclient = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)
        response = await aclient.embeddings.create(
            model=MODEL_NAME,
            input=batch_sentences,
        )
        return [data.embedding for data in response.data]
    except Exception as e:
        print(f"Error calling embedding API: {e}")
        return [None] * len(batch_sentences)
        
async def proc_prompts(chat_data):
    context = ""
    allprompts = []
    
    # Pre-validation
    validated_data = []
    for turn in chat_data:
        if isinstance(turn, dict) and 'speaker' in turn and 'message' in turn:
            validated_data.append(turn)
    
    if not validated_data:
        return []

    for i in range(len(validated_data)):
        response = f"{validated_data[i]['speaker']}:{validated_data[i]['message']}"
        
        if i > 0:
            allprompts.append(PROMPT_TEMPLATE_EN.format(context=context, response=response))
            context += "\n"
        context += response
    
    if not allprompts:
        return []

    return await get_api_embeddings(allprompts)
# 修改前：def calc_relevant(chat_data):
async def calc_relevant(chat_data):
    # 1. Preprocess: Merge consecutive messages from same speaker
    if not chat_data:
        return []
        
    new_data = [chat_data[0]]
    for i in range(1, len(chat_data)):
        if chat_data[i]['speaker'] == new_data[-1]['speaker']:
            new_data[-1]['message'] += ". " + chat_data[i]['message']
        else:
            new_data.append({
                "speaker": chat_data[i]['speaker'],
                "message": chat_data[i]['message']
            })
            
    # 2. Get embeddings
    # 修改前：embeddings = proc_prompts(new_data)
    # 修改后：添加 await
    embeddings = await proc_prompts(new_data)
    
    if not embeddings or None in embeddings:
        print("Error: Failed to get embeddings")
        return [0.0] * len(chat_data)

    embedding_tensor = torch.tensor(embeddings, dtype=torch.float32)
    
    # 3. Load Model (Load logic remains same...)
    try:
        model = ScoringNetwork(input_size=embedding_tensor.shape[-1])
        model.load_state_dict(torch.load(MODEL_PATH, map_location='cpu'))
        model.eval()
    except Exception as e:
        print(f"Error loading model from {MODEL_PATH}: {e}")
        return [0.0] * len(chat_data)
    
    # 4. Inference
    with torch.no_grad():
        output = model(embedding_tensor)
    
    output = output.squeeze().numpy()
    if output.ndim == 0:
        output = [float(output)]
    else:
        output = output.tolist()

    # 5. Map back to original messages (Logic remains same...)
    scores_map = {} 
    for idx, score in enumerate(output):
        scores_map[idx + 1] = float(score)
        
    current_merged_idx = 0
    res = []
    
    for i in range(len(chat_data)):
        if i > 0 and chat_data[i]['speaker'] != chat_data[i-1]['speaker']:
            current_merged_idx += 1
        
        score = scores_map.get(current_merged_idx, 0.0)
        
        # normalized_score = (score + 5) * 10
        # normalized_score = max(0, min(100, normalized_score))
        
        if current_merged_idx == 0:
            res.append(None)
        else:
            res.append(score)
            
    return res
