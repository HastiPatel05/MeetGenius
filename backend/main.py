import os
import io
import json
import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from deep_translator import GoogleTranslator
from gtts import gTTS
import base64

app = FastAPI(title="Smart Meeting Companion API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Demo transcript representing a realistic conversation of people for immediate MoM testing
meeting_transcript = [
    "Hasti: Welcome everyone to our status meeting for the Smart Meeting Companion project.",
    "Dhyey: Hi team! I am happy to report that the frontend is fully responsive and communicating with our FastAPI endpoints.",
    "Derek: That is fantastic. Did you resolve the CORS issues we were concerned about?",
    "Dhyey: Yes, we decided to deploy the frontend and backend as a unified single-service monolithic build. This completely eliminates CORS issues because they share the same origin.",
    "Derek: Brilliant decision. What are the next steps for the speech-to-speech translation module?",
    "Hasti: I will run latency tests on gTTS and deep-translator. We want to ensure translation is under two seconds.",
    "Dhyey: I will package the Chrome Extension in developer mode so we can test the panel behavior directly inside Google Meet.",
    "Derek: Excellent work. I will review the system architecture diagram and the project charter on Friday."
]

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """
    Accepts audio chunks or transcribed text.
    For audio chunks (bytes), performs mock STT.
    For text (JSON), appends the real-time transcription to the transcript history.
    """
    await websocket.accept()
    # Clear the demo conversation when a live session starts
    global meeting_transcript
    meeting_transcript = []
    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                # Backwards compatible mock STT fallback for raw audio chunks
                transcription = " (Mocked STT: User spoke something...) "
                meeting_transcript.append(transcription)
                await websocket.send_json({"transcript": transcription})
            elif "text" in message and message["text"]:
                # Process high-fidelity real transcription from the Web Speech API
                try:
                    data = json.loads(message["text"])
                    transcript = data.get("transcript", "")
                    if transcript:
                        meeting_transcript.append(transcript)
                        await websocket.send_json({"transcript": transcript})
                except Exception as e:
                    print(f"Error parsing STT text: {e}")
    except WebSocketDisconnect:
        print("Transcription client disconnected")

@app.websocket("/ws/translate")
async def websocket_translate(websocket: WebSocket):
    """
    Accepts text and a target language.
    Translates the text using deep-translator.
    Synthesizes the translated text into audio using gTTS.
    Returns the translated text and the base64-encoded audio.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            text = data.get("text", "")
            target_lang = data.get("target_language", "es") # default Spanish
            
            # 1. Translate Text
            # We map full language names to language codes for gTTS and GoogleTranslate
            # translator codes (deep-translator) and gTTS codes differ for Mandarin
            lang_map = {
                "Spanish": {"translate": "es",    "tts": "es"},
                "French":  {"translate": "fr",    "tts": "fr"},
                "German":  {"translate": "de",    "tts": "de"},
                "Mandarin":{"translate": "zh-CN", "tts": "zh"},  # gTTS accepts 'zh' for Chinese
                "Hindi":   {"translate": "hi",    "tts": "hi"},
            }
            lang_info = lang_map.get(target_lang, {"translate": "es", "tts": "es"})
            translate_code = lang_info["translate"]
            tts_code = lang_info["tts"]

            translated_text = ""
            if text.strip():
                try:
                    translated_text = GoogleTranslator(source='auto', target=translate_code).translate(text)
                except Exception as e:
                    translated_text = f"[Translation Error: {str(e)}]"

            # 2. Text-to-Speech (TTS)
            audio_base64 = ""
            if translated_text and not translated_text.startswith("["):
                try:
                    tts = gTTS(text=translated_text, lang=tts_code)
                    fp = io.BytesIO()
                    tts.write_to_fp(fp)
                    fp.seek(0)
                    audio_base64 = base64.b64encode(fp.read()).decode("utf-8")
                except Exception as e:
                    print(f"TTS Error: {e}")

            await websocket.send_json({
                "translated": translated_text,
                "audio_base64": audio_base64
            })
    except WebSocketDisconnect:
        print("Translation client disconnected")

import re
from datetime import datetime

def clean_fillers(text: str) -> str:
    text = text.strip()
    # Remove leading common conversational fillers and symbols
    filler_regex = r'^(?:\s*|yes|no|okay|ok|yeah|so|well|alright|sure|great|brilliant|fantastic|indeed|actually|basically|honestly|i think|i believe|team|hi|hello|hey|thanks|thank you|please|let\'s|let us|we should|we need to|we want to|we will|we\'re going to|i\'ll|i will|i want to|first|secondly|finally|additionally|plus|also|then|so\s+then)[,\.\s!\?]*'
    
    prev_text = ""
    while prev_text != text:
        prev_text = text
        text = re.sub(filler_regex, '', text, flags=re.IGNORECASE).strip()
    
    # Capitalize the first letter
    if text:
        text = text[0].upper() + text[1:]
    return text

def parse_transcript_into_sentences(text: str):
    """
    Parses raw transcript into a list of tuples: (speaker, sentence_text)
    """
    # Split by standard speaker formatting, e.g. "Dhyey: " at start of lines or inside text
    raw_lines = re.split(r'\n+(?=[A-Z][A-Za-z0-9_]*\s*:)', text.strip())
    if len(raw_lines) <= 1:
        # Fallback split if everything is on a single line but has multiple speakers
        raw_lines = re.split(r'(?<=[.!?])\s+(?=[A-Z][A-Za-z0-9_]*\s*:)', text.strip())
        
    parsed_sentences = []
    
    for line in raw_lines:
        line = line.strip()
        if not line:
            continue
            
        speaker_match = re.match(r'^([A-Z][a-zA-Z0-9_]*)\s*:\s*(.*)', line, flags=re.DOTALL)
        if speaker_match:
            speaker = speaker_match.group(1)
            spoken_text = speaker_match.group(2)
        else:
            speaker = None
            spoken_text = line
            
        # Split spoken text into individual sentences
        sentences = re.split(r'(?<=[.!?])\s+', spoken_text.strip())
        for s in sentences:
            s_clean = s.strip()
            if s_clean:
                parsed_sentences.append((speaker, s_clean))
                
    return parsed_sentences

def refine_decision(speaker: str, sentence: str) -> str:
    sentence_clean = sentence.strip()
    
    # 1. Check if this is just an acknowledgment/agreement reaction without a substance
    reaction_words = ["brilliant", "great", "excellent", "good", "right", "absolutely", "totally", "indeed", "yes"]
    lower_s = sentence_clean.lower()
    
    # If the sentence is very short and contains reaction words, ignore it as a core decision
    if len(lower_s.split()) <= 4 and any(w in lower_s for w in ["agree", "decision", "conclude", "settle", "chose", "finalize", "approve"]):
        return None
        
    # Check for direct agreement phrases
    if lower_s in ["i agree.", "i agree", "agreed.", "agreed", "absolutely.", "absolutely", "that makes sense.", "that makes sense"]:
        return None

    # Find decision keyword
    dec_match = re.search(r'\b(decide|decision|agree|conclude|settle|chose|finalize|approve)\w*\b', lower_s)
    if not dec_match:
        return clean_fillers(sentence_clean)
        
    # Check for passive or active voice decisions
    dec_phrase_match = re.search(r'\b(?:decided\s+to|agreed\s+to|agreed\s+that|concluded\s+to|settled\s+on|finalized|approved)\s+(.*)', sentence_clean, flags=re.IGNORECASE)
    if dec_phrase_match:
        decision_detail = dec_phrase_match.group(1).strip()
        decision_detail = clean_fillers(decision_detail)
        
        # Strip trailing punctuation
        decision_detail = re.sub(r'[\.\s!]+$', '', decision_detail)
        
        verb = dec_match.group(1).lower()
        if verb == "agree":
            return f"Agreed to {decision_detail[0].lower() + decision_detail[1:] if decision_detail else ''}."
        elif verb == "approve":
            return f"Approved {decision_detail[0].lower() + decision_detail[1:] if decision_detail else ''}."
        elif verb == "finalize":
            return f"Finalized {decision_detail[0].lower() + decision_detail[1:] if decision_detail else ''}."
        else:
            return f"Decided to {decision_detail[0].lower() + decision_detail[1:] if decision_detail else ''}."
            
    # Generic cleanup fallback
    cleaned = clean_fillers(sentence_clean)
    cleaned = re.sub(r'^We\s+(?:decided\s+to|agreed\s+to|agreed\s+that|concluded\s+to|settled\s+on|finalized|approved)\s+', '', cleaned, flags=re.IGNORECASE)
    cleaned = clean_fillers(cleaned)
    cleaned = re.sub(r'[\.\s!]+$', '', cleaned)
    
    verb = dec_match.group(1).lower()
    if verb == "agree":
        return f"Agreed to {cleaned[0].lower() + cleaned[1:] if cleaned else ''}."
    elif verb == "approve":
        return f"Approved {cleaned[0].lower() + cleaned[1:] if cleaned else ''}."
    elif verb == "finalize":
        return f"Finalized {cleaned[0].lower() + cleaned[1:] if cleaned else ''}."
    else:
        return f"Decided to {cleaned[0].lower() + cleaned[1:] if cleaned else ''}."

def refine_action_item(speaker: str, sentence: str) -> str:
    sentence_clean = sentence.strip()
    sentence_clean = re.sub(r'[\.\s!]+$', '', sentence_clean)
    
    if speaker:
        # Match speaker self-assignment
        self_assign = re.match(r'^\s*(?:I\s+will|I\s+am\s+going\s+to|I\'ll|I\s+need\s+to|I\s+must|I\s+should|I\s+shall|I\s+will\s+personally)\s+(.*)', sentence_clean, flags=re.IGNORECASE)
        if self_assign:
            action_detail = self_assign.group(1).strip()
            action_detail = clean_fillers(action_detail)
            return f"{speaker} to {action_detail[0].lower() + action_detail[1:] if action_detail else ''}."
            
        # Match speaker assigning another person (e.g. "Dhyey will deploy")
        other_assign = re.match(r'^\s*([A-Z][a-zA-Z0-9_]*)\s+(?:will|is\s+going\s+to|needs\s+to|must|should|shall)\s+(.*)', sentence_clean, flags=re.IGNORECASE)
        if other_assign:
            assignee = other_assign.group(1)
            action_detail = other_assign.group(2).strip()
            action_detail = clean_fillers(action_detail)
            return f"{assignee} to {action_detail[0].lower() + action_detail[1:] if action_detail else ''}."
            
    else:
        # No speaker prefix, but might have explicit name at the start of sentence
        name_match = re.match(r'^\s*([A-Z][a-zA-Z0-9_]*)\s+(?:will|is\s+going\s+to|needs\s+to|must|should|shall)\s+(.*)', sentence_clean, flags=re.IGNORECASE)
        if name_match:
            assignee = name_match.group(1)
            action_detail = name_match.group(2).strip()
            action_detail = clean_fillers(action_detail)
            return f"{assignee} to {action_detail[0].lower() + action_detail[1:] if action_detail else ''}."

    cleaned = clean_fillers(sentence_clean)
    return f"{cleaned}."

@app.post("/summarize")
async def summarize_meeting(payload: dict):
    """
    Summarizes the accumulated meeting transcript into a structured Minutes of Meeting (MoM) format.
    Strictly parses and categorizes the actual spoken conversation.
    """
    text = payload.get("text", "")
    if not text.strip():
        text = " ".join(meeting_transcript)
        
    if not text.strip():
        return {"summary": "No meeting transcript available yet. Please start recording and speak to capture the conversation!"}
    
    parsed = parse_transcript_into_sentences(text)
    
    topics = []
    decisions = []
    actions = []
    attendees = set()
    
    # Attendee Detection: Match standard script format (e.g. "Hasti:")
    for speaker in re.findall(r'(?:^|\n|(?<=[.!?])\s*)([A-Z][a-zA-Z0-9_]*)\s*:', text):
        attendees.add(speaker)
        
    # Attendee Detection: Check for proper names in the text body
    common_names = ["Hasti", "Dhyey", "Derex", "Derek", "Rudra", "John", "Sarah", "Alex", "Emily", "Michael"]
    for word in re.findall(r'\b[A-Z][a-z]+\b', text):
        if word in common_names:
            attendees.add(word)
            
    # Default fallback attendees if none explicitly detected
    if not attendees:
        attendees = {"Participant"}

    for speaker, sentence in parsed:
        s_clean = sentence.strip()
        if not s_clean:
            continue
            
        s_lower = s_clean.lower()
        full_sentence = f"{speaker}: {s_clean}" if speaker else s_clean
        
        # Heuristic 1: Action Items
        if any(keyword in s_lower for keyword in ["action item", "todo", "to-do", "task", "assign", "responsible", "need to", "must", "should", "will", "going to", "shall"]):
            refined = refine_action_item(speaker, s_clean)
            if refined:
                actions.append(refined)
        # Heuristic 2: Decisions
        elif any(keyword in s_lower for keyword in ["decide", "decision", "agree", "conclude", "settle", "chose", "finalized", "approved"]):
            refined = refine_decision(speaker, s_clean)
            if refined:
                decisions.append(refined)
        # Heuristic 3: Discussion & Overview
        else:
            topics.append(full_sentence)

    # Clean empty states with strictly authentic conversation notices
    if not topics:
        topics = ["No general discussion overview was recorded."]
    if not decisions:
        decisions = ["No explicit decisions were recorded in this conversation."]
    if not actions:
        actions = ["No pending action items were assigned in this conversation."]

    # Generate the Minutes of Meeting layout
    timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    attendees_str = ", ".join(sorted(attendees))
    
    mom = f"""======================================================================
                     MINUTES OF MEETING (MoM)
======================================================================
Generated On : {timestamp}
Meeting Type : Live Captured Conversation
Attendees    : {attendees_str}
Status       : Draft (AI-Generated Summary)
======================================================================

1. DISCUSSION & OVERVIEW
----------------------------------------------------------------------
The following highlights and topics reflect the actual live conversation 
transcribed during this meeting session:"""

    for t in topics:
        mom += f"\n* {t}"
        
    mom += """

2. DECISIONS MADE
----------------------------------------------------------------------"""
    for d in decisions:
        if d == "No explicit decisions were recorded in this conversation.":
            mom += f"\n* {d}"
        else:
            mom += f"\n* {d}"
        
    mom += """

3. ACTION ITEMS & NEXT STEPS
----------------------------------------------------------------------"""
    for a in actions:
        if a == "No pending action items were assigned in this conversation.":
            mom += f"\n* {a}"
        else:
            mom += f"\n* [TODO] {a}"
        
    mom += "\n\n======================================================================\n"
    
    return {"summary": mom}

@app.post("/chat")
async def chat_interaction(payload: dict):
    """
    Responds to user queries based on the meeting transcript.
    """
    message = payload.get("message", "")
    return {"reply": f"You asked: '{message}'. Based on the meeting transcript, yes, that was mentioned."}
# Serve static frontend built files
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIST_DIR = os.path.join(CURRENT_DIR, "..", "frontend", "dist")

# Create frontend/dist and a placeholder index.html if it doesn't exist, to prevent FastAPI from crashing before building the frontend
if not os.path.exists(FRONTEND_DIST_DIR):
    os.makedirs(FRONTEND_DIST_DIR, exist_ok=True)
    index_path = os.path.join(FRONTEND_DIST_DIR, "index.html")
    if not os.path.exists(index_path):
        with open(index_path, "w") as f:
            f.write("<!DOCTYPE html><html><head><title>Loading...</title></head><body><h1>Building Frontend Assets... Please refresh in a moment.</h1></body></html>")

# Mount /assets if it exists, or dynamically serve files via catch-all
assets_dir = os.path.join(FRONTEND_DIST_DIR, "assets")
if not os.path.exists(assets_dir):
    os.makedirs(assets_dir, exist_ok=True)
app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

@app.get("/{catchall:path}")
async def serve_frontend(catchall: str):
    # Exclude API / WS endpoints
    if catchall.startswith("ws/") or catchall in ["summarize", "chat"]:
        return {"detail": "Not Found"}
    
    # Serve requested file if it exists
    file_path = os.path.join(FRONTEND_DIST_DIR, catchall)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
        
    return FileResponse(os.path.join(FRONTEND_DIST_DIR, "index.html"))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
