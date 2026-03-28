import requests
from .config import GEMINI_API_KEY, GEMINI_TEXT_MODEL

def _is_social_or_greeting(query):
    text = query.strip().lower()
    if not text:
        return False

    social_markers = {
        "hi",
        "hello",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
        "how are you",
        "thanks",
        "thank you",
        "ok",
        "okay",
        "nice",
    }

    return any(marker in text for marker in social_markers)


def _is_biographical_question(query):
    """Detect factual/biographical questions and non-course queries."""
    text = (query or "").strip().lower()
    if not text:
        return False
    
    # Patterns for biographical/factual queries
    biographical_markers = (
        "who is",
        "who was",
        "who are",
        "what year",
        "when was",
        "when did",
        "where is",
        "where was",
        "where did",
        "tell me about",
        "write a biography",
        "tell me who",
        "how old",
        "birthdate",
        "born in",
        "how much does",
        "how many people",
        "what is the capital",
        "what is the population",
    )
    
    # Also flag if it's asking about a proper noun (name) without course keywords nearby
    course_keywords = {"data mining", "data warehouse", "association", "pattern", "frequent", "support", "confidence", "algorithm", "clustering", "classification", "etl", "kdd", "oltp", "olap", "mean", "median", "mode", "distance", "similarity"}
    has_course_context = any(kw in text for kw in course_keywords)
    
    has_biographical_marker = any(marker in text for marker in biographical_markers)
    
    if has_biographical_marker:
        return True
    
    return False


def _is_direct_answer_request(query):
    text = (query or "").strip().lower()
    if not text:
        return False

    direct_answer_markers = (
        "direct answer",
        "give me the answer",
        "give me answer",
        "i want the answer",
        "just give answer",
        "just tell me",
        "tell me the answer",
        "final answer",
        "solve it for me",
        "just solve it",
    )

    return any(marker in text for marker in direct_answer_markers)

def classify_intent(query, history=None):
    if _is_direct_answer_request(query):
        return "SAFETY_VIOLATION"

    if _is_biographical_question(query):
        return "OFF_TOPIC"

    if _is_social_or_greeting(query):
        return "SOCIAL"

    text = (query or "").strip().lower()
    help_markers = {
        "no",
        "nah",
        "not really",
        "still confused",
        "confused",
        "idk",
        "i don't know",
        "dont know",
        "i am stuck",
        "i'm stuck",
        "stuck",
        "not sure",
        "no idea",
        "i don't understand",
        "dont understand",
        "can't answer",
        "cannot answer",
        "unable to answer",
    }
    if text in help_markers:
        return "HELP_REQUEST"

    # If the tutor just asked a question and the student gives a short non-answer,
    # treat it as a help signal so we explain the concept before continuing.
    short_non_answers = {"no", "idk", "not sure", "maybe", "hmm", "don't know", "dont know"}
    last_tutor_message = ""
    if history:
        for turn in reversed(history):
            if (turn.get("role") or "").lower() == "tutor":
                last_tutor_message = (turn.get("content") or "").strip().lower()
                break
    if text in short_non_answers and "?" in last_tutor_message:
        return "HELP_REQUEST"

    history_snippet = ""
    if history:
        recent_turns = history[-6:]
        history_snippet = "\n".join(
            f"{turn.get('role', 'student').title()}: {turn.get('content', '').strip()}"
            for turn in recent_turns
            if turn.get("content")
        )

    # Pass a small snippet of history so the LLM knows what "this" refers to
    prompt = f"""
Analyze this student response in a tutoring session: "{query}"
Recent conversation: {history_snippet or 'None'}

Categories:
- COURSE_RELATED: Asking technical questions OR providing technical definitions/explanations/answers.
- HELP_REQUEST: Saying "I don't know," "I'm stuck," or asking for clarification.
- SOCIAL: Simple greetings (hi), thanks, or very short conversational fillers (ok, yes).
- OFF_TOPIC: Discussion of topics unrelated to academics (movies, sports, etc.).
- SAFETY_VIOLATION: Asking for direct answers or harmful content.

Return ONLY the category name.
"""
    
    if not GEMINI_API_KEY:
        return "COURSE_RELATED"

    try:
        model_name = (GEMINI_TEXT_MODEL or "gemini-1.5-flash").replace("models/", "")
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.0
                }
            },
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        label = "".join(part.get("text", "") for part in parts).strip().upper()
    except Exception as e:
        print(f"Error calling Gemini: {e}")
        return "COURSE_RELATED"

    normalized = label.split()[0] if label else "COURSE_RELATED"
    valid_labels = {
        "COURSE_RELATED",
        "HELP_REQUEST",
        "SOCIAL",
        "OFF_TOPIC",
        "SAFETY_VIOLATION",
    }
    return normalized if normalized in valid_labels else "COURSE_RELATED"