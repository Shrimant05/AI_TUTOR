import json
import requests
import re
from typing import Set
from .router import classify_intent
from .config import OLLAMA_HOST, LLM_MODEL

def _call_llm(prompt, temperature=0.3, require_json=False):
    payload = {
        "model": LLM_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature
        }
    }
    if require_json:
        payload["format"] = "json"

    try:
        response = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json=payload,
            timeout=45
        )
        response.raise_for_status()
        text = response.json().get("response", "").strip()
        if require_json:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"reply": text, "citations": []}
        return text or None
    except Exception as e:
        print(f"Error calling LLM: {e}")
        return None if not require_json else {"reply": "Sorry, I am having trouble connecting to my models.", "citations": []}


def _fallback_socratic_reply(query, context_text, has_attempt=False, unable_to_answer=False):
    guidance = []
    if unable_to_answer:
        guidance.append("No problem, let's reset with one tiny step.")
    elif has_attempt:
        guidance.append("You're close, so let's use your setup and take the next small step.")
    else:
        guidance.append("Let's start from the core idea first.")

    fallback = " ".join(guidance)
    if context_text:
        fallback = f"{fallback}\n\n[Note: Please consider this context snippet:]\n\n{context_text[:500].strip()}..."
    return fallback


SYSTEM_PROMPT = """
You are a Socratic College Tutor. 
1. Use ONLY the provided context to help the student.
2. NEVER give the direct answer, final numeric result, final code, or full derivation.
3. Your motive is to make the student learn. Always explain the concept briefly and ask guiding questions that move them toward the final answer.
4. Always cite the sources utilized from the context.
5. If the student asks for the final answer directly, politely refuse and explicitly say your motive is helping them learn, then ask a guiding question.
6. CRITICAL: If the student provides an attempted answer or calculation, you MUST evaluate if it is correct or incorrect based on the context. If correct, confirm it explicitly. If incorrect, gently point out where the error might be.
7. Follow this hint ladder:
   - Level 1: Ask 1-2 guiding questions only.
   - Level 2: Give a small hint or a partial setup, still no final answer.
   - Level 3: Share the relevant relation, then ask the student to substitute values.
8. If the student's latest answer is correct, acknowledge it clearly and end the chat politely. Do not ask another follow-up question in that case.

OUTPUT INSTRUCTION:
Provide your response strictly in the following JSON format:
{
  "reply": "Your Socratic explanation and guiding question...",
  "citations": [
    {"file": "source_filename", "page": 1}
  ]
}
If no citations are used, provide an empty list [].
"""


def _format_recent_history(history, max_turns=8):
    recent = history[-max_turns:] if history else []
    lines = []
    for turn in recent:
        role = (turn.get("role") or "student").strip().lower()
        speaker = "Student" if role == "student" else "Tutor"
        content = (turn.get("content") or "").strip()
        if content:
            lines.append(f"{speaker}: {content}")
    return "\n".join(lines) if lines else "None"


def _student_attempted_solution(query, history):
    attempt_markers = ("i tried", "my steps", "is this right", "i got", "therefore", "so mode", "hence", "thus")
    math_symbols = ("=", "+", "-", "*", "/", "−", "×", "÷", "≈", ".")
    variable_keywords = ("mean", "median", "mode", "x", "y", "z")

    texts = [(query or "").lower()]
    texts.extend((turn.get("content") or "").lower() for turn in (history or []) if turn.get("role") == "student")

    for text in texts:
        if any(marker in text for marker in attempt_markers):
            return True
        # If it's purely a number (like "0.33"), count as attempt
        try:
            float(text.strip())
            return True
        except ValueError:
            pass
        if any(symbol in text for symbol in math_symbols) and any(ch.isdigit() for ch in text) and "find" not in text:
            return True
        if any(symbol in text for symbol in math_symbols) and any(var in text for var in variable_keywords) and "find" not in text:
            return True
    return False


def _direct_answer_refusal(history):
    templates = [
        "I cannot provide the final answer directly because my motive is to help you learn the method. Which relation links these terms?",
        "I will not give the final answer directly, because my motive is to make you learn step by step. Can you list the given values first?",
        "I cannot solve it for you directly. My motive is helping you learn, so set up the standard relation and I will check your next step.",
    ]
    direct_requests = sum(1 for turn in history or [] if turn.get("role") == "student" and any(p in (turn.get("content") or "").strip().lower() for p in ("direct answer", "give me the answer")))
    return templates[direct_requests % len(templates)]


def _looks_like_direct_answer_request(query: str) -> bool:
    text = (query or "").strip().lower()
    if not text:
        return False
    markers = (
        "final answer",
        "direct answer",
        "just answer",
        "just give answer",
        "give me the answer",
        "only answer",
        "no steps",
        "no explanation",
        "solve and give",
        "just solve",
    )
    return any(marker in text for marker in markers)


def _build_effective_query(query, history):
    if not history: return query
    short_tokens = {"no", "yes", "a", "b", "ok", "okay", "hmm", "idk", "dont know", "still confused"}
    normalized = (query or "").strip().lower()
    is_short = len(normalized.split()) <= 2

    if not any(ch.isdigit() for ch in normalized):
        if any(cue in normalized for cue in ("if ", "then", "so ", "therefore")):
            for turn in reversed(history):
                if turn.get("role") == "student" and any(ch.isdigit() for ch in (turn.get("content") or "")):
                    return f"{(turn.get('content') or '').strip()} | Follow-up: {query}"

    if not is_short and normalized not in short_tokens: return query

    for turn in reversed(history):
        if turn.get("role") == "student":
            prev = (turn.get("content") or "").strip()
            if prev.lower() != normalized and len(prev.split()) > 3:
                return f"{prev} | Follow-up: {query}"
    
    return query


def _is_unable_text(text):
    return any(marker in (text or "").strip().lower() for marker in ("i don't know", "dont know", "idk", "not sure", "confused", "stuck", "cannot answer"))


def _student_unable_to_answer(query, history):
    if _is_unable_text(query): return True
    if (query or "").strip().lower() in {"no", "idk", "not sure", "maybe", "hmm", "don't know"}:
        for turn in reversed(history or []):
            if (turn.get("role") or "").lower() == "tutor":
                return "?" in (turn.get("content") or "")
    return False


def _consecutive_unable_attempts(query, history):
    count = 1 if _student_unable_to_answer(query, history) else 0
    for turn in reversed(history or []):
        if (turn.get("role") or "").lower() != "student": continue
        if _is_unable_text(turn.get("content")): count += 1
        else: break
    return count


def _student_showing_understanding(query):
    text = (query or "").strip().lower()
    if not text: return False
    return any(m in text for m in ("i think", "i got", "therefore", "thus", "hence", "because", "which means", "is correct")) or ("=" in text and any(ch.isdigit() for ch in text))


def _tokenize_text(text: str) -> Set[str]:
    tokens = re.findall(r"[a-z0-9]+", (text or "").lower())
    stop = {
        "the", "a", "an", "of", "in", "on", "to", "for", "and", "or", "is", "are", "was", "were",
        "what", "which", "how", "why", "when", "where", "who", "with", "from", "that", "this", "it",
        "find", "explain", "define", "about", "give", "tell", "me", "my", "your", "their",
    }
    return {t for t in tokens if len(t) >= 3 and t not in stop}


def _is_retrieval_relevant(query: str, results, min_overlap: float = 0.22) -> bool:
    query_tokens = _tokenize_text(query)
    if not query_tokens:
        return True

    best_overlap = 0.0
    for row in results or []:
        content = (row.get("content") or "")[:1600]
        content_tokens = _tokenize_text(content)
        if not content_tokens:
            continue
        overlap = len(query_tokens & content_tokens) / max(1, len(query_tokens))
        if overlap > best_overlap:
            best_overlap = overlap

    return best_overlap >= min_overlap


def socratic_agent(query, retriever, history=None, user_id="faculty", allowed_sources=None):
    history = history or []
    normalized_allowed_sources = None
    if allowed_sources is not None:
        normalized_allowed_sources = {str(name).strip().lower() for name in allowed_sources}

    def _filter_allowed(rows):
        if normalized_allowed_sources is None:
            return rows
        filtered = []
        for row in rows:
            src = str((row.get("metadata") or {}).get("source_file", "")).strip().lower()
            if src in normalized_allowed_sources:
                filtered.append(row)
        return filtered

    intent = classify_intent(query, history=history)

    # Safety reinforcement in case router intent misses direct-answer phrasing.
    if _looks_like_direct_answer_request(query):
        intent = "SAFETY_VIOLATION"
    
    validation_search = _filter_allowed(retriever.retrieve(query, top_k=1))
    if intent == "SOCIAL" and validation_search and len(query.split()) > 2:
        intent = "COURSE_RELATED"

    if intent == "SOCIAL":
        return {"reply": "Good to hear from you. I am ready to help. Which topic from your notes should we work on now?", "citations": []}
    if intent == "OFF_TOPIC":
        return {"reply": "Happy to chat briefly, and let's keep this session focused on your course notes. What concept are you working on?", "citations": []}
    if intent == "SAFETY_VIOLATION":
        return {"reply": _direct_answer_refusal(history), "citations": []}

    effective_query = _build_effective_query(query, history)
    
    # 2. Retrieve
    results = _filter_allowed(retriever.retrieve(effective_query, top_k=3, score_threshold=0.95))
    
    # Rejection Logic: Out of Scope
    if not results:
        return {"reply": "This is outside the provided course material. I am restricted to the course context.", "citations": []}

    # Reject weak lexical matches that often cause repetitive, irrelevant replies.
    if not _is_retrieval_relevant(query, results):
        return {"reply": "This looks outside the current classroom material. Please ask from the uploaded course notes.", "citations": []}

    # 3. Build Context
    context = ""
    citations_data = []
    # Use a set to keep track of citations added to avoid duplication
    seen_citations = set()
    for res in results:
        meta = res.get('metadata', {})
        src = meta.get('source_file', 'Unknown')
        pg = meta.get('page', 0)
        cite_key = f"{src}-{pg}"
        if cite_key not in seen_citations:
            citations_data.append({"file": src, "page": pg})
            seen_citations.add(cite_key)
        context += f"\n[Source: {src}, Page: {pg}]\n{res['content']}\n"

    # CASE 1: Student is stuck
    if intent == "HELP_REQUEST" or _student_unable_to_answer(query, history):
        instruction = "They are stuck. Using ONLY this context, briefly explain the concept in 2 sentences, then ask a simple 'Yes/No' or 'A/B' choice question."
        if _consecutive_unable_attempts(query, history) >= 2:
            instruction = "They have been unable to answer consecutive guiding questions. Give one tiny worked setup step (no final numeric answer), then ask one simple check question."

        scaffold_prompt = f"""{SYSTEM_PROMPT}
The student says: "{query}"
{instruction}
Context: {context}
Recent dialogue: {_format_recent_history(history)}
"""
        response_data = _call_llm(scaffold_prompt, temperature=0.3, require_json=True)
        if response_data:
                response_data["citations"] = citations_data
                return response_data
        return {"reply": _fallback_socratic_reply(query, context), "citations": citations_data}

    # 4. Socratic Generation
    is_attempt = _student_attempted_solution(query, history)
    guidance = "Level 2 (Evaluate their attempt first, then provide next hint)" if is_attempt else "Level 1"
    
    full_prompt = f"""{SYSTEM_PROMPT}

Current required hint level: {guidance}
Recent conversation:
{_format_recent_history(history)}

Context:
{context}

Student: {query}

Respond exactly adhering to the JSON schema.
"""
    
    response_data = _call_llm(full_prompt, temperature=0.3, require_json=True)
    if response_data:
        # Always keep citations grounded to retrieved chunks from the current classroom.
        response_data["citations"] = citations_data
        return response_data

    return {"reply": _fallback_socratic_reply(query, context), "citations": citations_data}