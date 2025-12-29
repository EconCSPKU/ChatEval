from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import shutil
import os
import uuid
from datetime import datetime
from sqlalchemy.orm import Session

from database.models import Base, User, Conversation, Message, Feedback, SessionLocal, engine, init_db
from services.extraction import extract_chat_from_images
from services.scoring import calc_relevant

# Initialize DB
init_db()

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for dev, restrict in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Frontend
# We'll serve the 'frontend' directory at root
# But first, we need to handle the API routes, then catch-all for frontend or just '/'
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

@app.get("/")
async def read_index():
    return FileResponse("../frontend/index.html")

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic Models
class ChatTurn(BaseModel):
    speaker: str
    message: str
    relevance_score: Optional[float] = None

class ScoreRequest(BaseModel):
    chat_data: List[ChatTurn]

class SaveRequest(BaseModel):
    user_id: str
    chat_data: List[ChatTurn]
    title: Optional[str] = None

class FeedbackRequest(BaseModel):
    conversation_id: int
    rating: int
    comment: Optional[str] = None

@app.post("/api/extract")
async def extract_chat(images: List[UploadFile] = File(...)):
    temp_dir = "temp_uploads"
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)
        
    file_paths = []
    try:
        for image in images:
            file_path = os.path.join(temp_dir, f"{uuid.uuid4()}_{image.filename}")
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(image.file, buffer)
            file_paths.append(file_path)
            
        chat_data = await extract_chat_from_images(file_paths)
        
        if chat_data is None:
            raise HTTPException(status_code=500, detail="Failed to extract chat from images")
            
        return {"chat_data": chat_data}
    finally:
        # Cleanup
        for p in file_paths:
            if os.path.exists(p):
                os.remove(p)

@app.post("/api/score")
async def score_chat(request: ScoreRequest):
    data = [turn.dict() for turn in request.chat_data]
    try:
        scores = await calc_relevant(data)
        # Update scores
        for i, turn in enumerate(request.chat_data):
            turn.relevance_score = scores[i]
        return {"chat_data": request.chat_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/save")
async def save_chat(request: SaveRequest, db: Session = Depends(get_db)):
    # 1. Ensure User exists
    user = db.query(User).filter(User.id == request.user_id).first()
    if not user:
        user = User(id=request.user_id)
        db.add(user)
        db.commit()
    
    # 2. Always Create New Conversation (Fix: "Analyze should create new record")
    # Default title if not provided: First message content (truncated)
    title = request.title
    if not title and request.chat_data:
        first_msg = request.chat_data[0].message
        title = (first_msg[:30] + '..') if len(first_msg) > 30 else first_msg
    
    # Force UTC now for correct ordering
    conversation = Conversation(
        user_id=request.user_id, 
        title=title,
        created_at=datetime.utcnow() 
    )
    db.add(conversation)
    db.commit() # Commit to get ID
    
    # 3. Save Messages
    for i, turn in enumerate(request.chat_data):
        msg = Message(
            conversation_id=conversation.id,
            speaker=turn.speaker,
            content=turn.message,
            relevance_score=turn.relevance_score,
            sequence_num=i
        )
        db.add(msg)
    
    db.commit()
    return {"conversation_id": conversation.id, "success": True, "title": title}

@app.get("/api/history/{user_id}")
async def get_history(user_id: str, db: Session = Depends(get_db)):
    # Filter out deleted conversations (is_deleted != 1)
    conversations = db.query(Conversation).filter(
        Conversation.user_id == user_id, 
        (Conversation.is_deleted == 0) | (Conversation.is_deleted == None)
    ).order_by(Conversation.created_at.desc()).all()
    
    res = []
    for conv in conversations:
        # Get message count or preview?
        msg_count = db.query(Message).filter(Message.conversation_id == conv.id).count()
        res.append({
            "id": conv.id,
            "title": conv.title,
            "date": conv.created_at.isoformat(),
            "message_count": msg_count
        })
    return res

@app.delete("/api/conversation/{conversation_id}")
async def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    # Soft delete
    conv.is_deleted = 1
    db.commit()
    return {"success": True}

@app.get("/api/conversation/{conversation_id}")
async def get_conversation(conversation_id: int, db: Session = Depends(get_db)):
    # Note: We still allow loading deleted conversations if you have the ID, 
    # but the History list won't show them.
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    messages = db.query(Message).filter(Message.conversation_id == conversation_id).order_by(Message.sequence_num).all()
    
    return {
        "id": conv.id,
        "title": conv.title,
        "date": conv.created_at.isoformat(),
        "messages": [
            {"speaker": m.speaker, "message": m.content, "relevance_score": m.relevance_score} for m in messages
        ]
    }

@app.post("/api/feedback")
async def submit_feedback(request: FeedbackRequest, db: Session = Depends(get_db)):
    fb = Feedback(
        conversation_id=request.conversation_id,
        rating=request.rating,
        comment=request.comment
    )
    db.add(fb)
    db.commit()
    return {"success": True}

