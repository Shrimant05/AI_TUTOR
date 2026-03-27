"""
Auto-generate evaluation questions from PDF materials.
Creates JSONL format evaluation data from PDFs in test_data folder.
"""

import json
from pathlib import Path
from pypdf import PdfReader


def extract_pdf_text(pdf_path: Path) -> str:
    """Extract text from PDF."""
    try:
        reader = PdfReader(str(pdf_path))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        return text
    except Exception as e:
        print(f"Error reading {pdf_path.name}: {e}")
        return ""


def generate_questions_from_text(pdf_name: str, text: str) -> list:
    """
    Generate evaluation questions from extracted text.
    Returns list of question dicts.
    """
    questions = []
    
    # Extract key terms/phrases (basic heuristic)
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    
    # Create questions based on common patterns
    topic_name = pdf_name.replace('.pdf', '').strip()
    
    # Question 1: Definition/Concept
    q1 = {
        "id": f"{topic_name.lower().replace(' ', '_')}_q1",
        "question": f"Explain the key concepts of {topic_name}.",
        "expected_keywords": [topic_name.lower()],
        "gold_sources": [pdf_name],
        "requires_citation": True,
        "requires_question": True,
        "no_direct_answer": False,
    }
    questions.append(q1)
    
    # Question 2: Application
    q2 = {
        "id": f"{topic_name.lower().replace(' ', '_')}_q2",
        "question": f"What are the practical applications of {topic_name} in software development?",
        "expected_keywords": [topic_name.lower(), "application", "applications"],
        "gold_sources": [pdf_name],
        "requires_citation": True,
        "requires_question": True,
        "no_direct_answer": False,
    }
    questions.append(q2)
    
    # Question 3: Comparison/Analysis
    q3 = {
        "id": f"{topic_name.lower().replace(' ', '_')}_q3",
        "question": f"How would you use {topic_name} to solve a real-world problem? What are the steps?",
        "expected_keywords": [topic_name.lower()],
        "gold_sources": [pdf_name],
        "requires_citation": True,
        "requires_question": True,
        "no_direct_answer": True,
        "forbid_phrases": ["the answer is", "final answer"],
    }
    questions.append(q3)
    
    return questions


def main():
    test_data_dir = Path("test_data")
    output_file = Path("data/eval_set_generated.jsonl")
    
    if not test_data_dir.exists():
        print(f"❌ {test_data_dir} not found")
        return
    
    # Find all PDFs
    pdf_files = list(test_data_dir.glob("*.pdf"))
    print(f"📂 Found {len(pdf_files)} PDFs in {test_data_dir}")
    
    if not pdf_files:
        print("❌ No PDF files found")
        return
    
    # Generate questions
    all_questions = []
    for pdf_path in sorted(pdf_files):
        print(f"  📄 Processing: {pdf_path.name}")
        text = extract_pdf_text(pdf_path)
        if text:
            questions = generate_questions_from_text(pdf_path.name, text)
            all_questions.extend(questions)
            print(f"    ✅ Generated {len(questions)} questions")
        else:
            print(f"    ⚠️  No text extracted")
    
    # Write to JSONL
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with output_file.open("w", encoding="utf-8") as f:
        for q in all_questions:
            f.write(json.dumps(q) + "\n")
    
    print(f"\n✅ Generated {len(all_questions)} evaluation questions")
    print(f"📝 Saved to: {output_file}")
    
    # Print sample
    print(f"\n📋 Sample questions:")
    for q in all_questions[:3]:
        print(f"  • {q['question']}")


if __name__ == "__main__":
    main()
