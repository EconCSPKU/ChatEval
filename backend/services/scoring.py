import torch
import torch.nn as nn
import numpy as np
from openai import AsyncOpenAI
import asyncio
import os

# Configuration
API_KEY = os.getenv("VOLC_API_KEY", "4c79b992-4487-4fb9-baec-73715fbe9fef")
BASE_URL = os.getenv("VOLC_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
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

def proc_prompts(chat_data):
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
    
    # The first item has no context, but the logic in old code implies it might be skipped or handled?
    # Checking old logic: "for i in range(len(chat_data) - 1): ... res.append(None)" for first items usually?
    # Old code: 
    # new_data constructed by merging same speaker.
    # embeddings = proc_prompts(new_data) -> calls API for len(new_data)-1 items (since i > 0 condition).
    
    if not allprompts:
        return []

    return asyncio.run(get_api_embeddings(allprompts))

def calc_relevant(chat_data):
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
    # proc_prompts generates prompts for items 1 to N (skipping 0 as it has no context)
    embeddings = proc_prompts(new_data)
    
    if not embeddings or None in embeddings:
        print("Error: Failed to get embeddings")
        return [0.0] * len(chat_data)

    embedding_tensor = torch.tensor(embeddings, dtype=torch.float32)
    
    # 3. Load Model
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

    # 5. Map back to original messages
    # The scoring model gives scores for transitions. 
    # new_data[0] -> No score (start)
    # new_data[1] -> Score based on context(0) + response(1)
    # ...
    
    # Output array corresponds to new_data[1:]
    
    final_scores = []
    
    # Logic from old utils.py seems to be:
    # res = [None]
    # cnt = -1
    # for i in range(len(chat_data) - 1):
    #   if speaker change:
    #       cnt += 1
    #       res.append(output[cnt])
    #   else:
    #       res.append(None)
    # res.append(output[cnt])
    
    # Re-implementing mapping logic carefully
    
    # Map merged_index back to original indices
    # new_data[k] corresponds to a group of original messages.
    # The score output[k-1] corresponds to new_data[k].
    
    # Let's align with the old logic's intent: assign score to the *response* that triggered the evaluation.
    # If merged, the score applies to the whole block? Or the last message?
    # Old logic maps scores back to the *boundaries* where speaker changes.
    
    # Let's simplify:
    # Create a mapping from original index to merged index
    
    res = []
    
    # Pointer to the current score index in `output`
    # output has length len(new_data) - 1
    score_idx = 0
    
    # Pointer to new_data index
    # We start comparing from the second group because the first group has no context score
    current_merged_idx = 0 
    
    # Need to verify if the first group ever gets a score? No, usually not.
    
    # Re-reading old logic:
    # cnt = -1 (corresponds to output index)
    # Loop i from 0 to len-2:
    #   If chat_data[i] speaker != chat_data[i+1] speaker:
    #       # This implies a turn change.
    #       # The score at 'cnt' belongs to the PREVIOUS turn?
    #       if cnt >= 0: res.append(output[cnt])
    #       cnt += 1 
    #   else:
    #       res.append(None)
    
    # This old logic is slightly confusing. Let's stick to the behavior:
    # Assign score to the messages.
    
    # Simplified approach for this refactor:
    # 1. Assign scores to the `new_data` items (except the first).
    # 2. Propagate that score to all original messages composing that `new_data` item.
    
    # output array matches new_data[1:]
    
    scores_map = {} # merged_idx -> score
    for idx, score in enumerate(output):
        scores_map[idx + 1] = float(score) # idx 0 in output corresponds to new_data[1]
        
    # Now walk through original data and assign
    current_merged_idx = 0
    res = []
    
    # Determine merged boundaries again
    processed_count = 0
    for i in range(len(chat_data)):
        if i > 0 and chat_data[i]['speaker'] != chat_data[i-1]['speaker']:
            current_merged_idx += 1
        
        score = scores_map.get(current_merged_idx, 0.0) # Default to 0 or None if start
        
        # Scaling: Model returns [-5, 5]. Map to [0, 100]? 
        # Old code: return self.sigmoid(x) * 10 - 5.
        # Wait, the prompt says "0 to 100". The model output seems to be in a different scale?
        # Old prompt: "0 to 100".
        # Model output layer: Sigmoid * 10 - 5 -> Range (-5, 5).
        # This is inconsistent. 
        # However, `calc_relevant` returns `output` directly. 
        # If the user wants 0-100, I should probably normalize it.
        # -5 -> 0, 5 -> 100.
        # score_100 = (score + 5) * 10
        
        normalized_score = (score + 5) * 10
        normalized_score = max(0, min(100, normalized_score))
        
        # First turn usually has no score (contextless).
        if current_merged_idx == 0:
            res.append(None)
        else:
            res.append(normalized_score)
            
    return res
